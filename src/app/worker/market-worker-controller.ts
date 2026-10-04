import { instantiate } from '../../../wasm-producer/build/release.js';
import { MarketMetrics } from '../market/market-metrics';
import { validateProducerSettings } from '../market/producer-settings';
import { decodeBatch } from './decode-batch';import { interval } from 'rxjs';

import type { Subscription } from 'rxjs';
import type { ActiveRun } from '../interfaces/active-run.interface';
import type { ProducerSettings } from '../interfaces/producer-settings.interface';
import type { WorkerCommand, WorkerEvent } from './worker-protocol';

type Producer = Awaited<ReturnType<typeof instantiate>>;
const MAX_UINT32 = 0xFFFFFFFF;

class MarketWorkerController {
  private producer: Producer | null = null;
  private initializing = false;
  private activeRun: ActiveRun | null = null;
  private timerSubscription: Subscription | null = null;

  handleCommand(data: WorkerCommand): void {
    if (data.type === 'init') {
      void this.initialize(data.wasmUrl);
      return;
    }

    try {
      switch (data.type) {
        case 'start': {
          this.startRun(data.runId, data.settings, data.seed);
          break;
        }

        case 'pause': {
          const run = this.activeRun;

          if (!run || run.id !== data.runId) return;

          this.stopTimer();
          run.paused = true;

          this.send({
            type: 'status',
            runId: run.id,
            status: 'paused',
          });

          break;
        }

        case 'resume': {
          const run = this.activeRun;

          if (!run || run.id !== data.runId || !run.paused) {
            return;
          }

          run.paused = false;

          this.send({
            type: 'status',
            runId: run.id,
            status: 'running',
          });

          this.startTimer();
          break;
        }
      }
    } catch (error) {
      this.reportError(error, data.runId);
    }
  }

  private send(event: WorkerEvent): void {
    postMessage(event);
  }

  private stopTimer(): void {
    this.timerSubscription?.unsubscribe();
    this.timerSubscription = null;
  }

  private reportError(error: unknown, runId: number | null): void {
    this.send({
      type: 'error',
      runId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private async initialize(wasmUrl: string): Promise<void> {
    if (this.initializing || this.producer !== null) return;

    this.initializing = true;

    try {
      const response = await fetch(wasmUrl);

      if (!response.ok) {
        throw new Error(`Failed to load Wasm: HTTP ${response.status}`);
      }

      const bytes = await response.arrayBuffer();
      const module = await WebAssembly.compile(bytes);

      this.producer = await instantiate(module, {
        env: {
          abort: (
            _message: number,
            _fileName: number,
            line: number,
            column: number,
          ): never => {
            throw new Error(`Wasm aborted at ${line}:${column}`);
          },
        },
      });

      this.send({ type: 'ready' });
    } catch (error) {
      this.reportError(error, null);
    } finally {
      this.initializing = false;
    }
  }

  private startTimer(): void {
    const run = this.activeRun;

    if (!run || run.paused || this.timerSubscription !== null) {
      return;
    }

    this.timerSubscription = interval(
      run.settings.batchIntervalMs,
    ).subscribe(() => {
      if (this.activeRun !== run || run.paused) {
        return;
      }

      this.generateNextBatch(run);
    });
  }

  private generateNextBatch(run: ActiveRun): void {
    if (!this.producer) return;

    try {
      const batch: Int32Array<ArrayBufferLike> = this.producer.generateBatch(
        run.settings.updatesPerBatch,
      );

      run.metrics.applyBatch(decodeBatch(batch));

      this.send({
        type: 'snapshot',
        runId: run.id,
        rows: run.metrics.snapshot(),
      });
    } catch (error) {
      run.paused = true;

      this.stopTimer();
      this.reportError(error, run.id);
    }
  }

  private startRun(
    runId: number,
    settings: ProducerSettings,
    seed: number,
  ): void {
    if (!this.producer) {
      throw new Error('Wasm producer is not ready');
    }

    validateProducerSettings(settings);

    if (
      !Number.isInteger(seed) ||
      seed < 0 ||
      seed > MAX_UINT32
    ) {
      throw new Error('Seed must be an unsigned 32-bit integer');
    }

    this.stopTimer();
    this.activeRun = null;

    this.producer.initialize(settings.instrumentCount, seed);

    const run: ActiveRun = {
      id: runId,
      settings: { ...settings },
      metrics: new MarketMetrics(settings.instrumentCount),
      paused: false,
    };

    this.activeRun = run;

    this.send({
      type: 'snapshot',
      runId,
      rows: run.metrics.snapshot(),
    });

    this.send({
      type: 'status',
      runId,
      status: 'running',
    });

    this.startTimer();
  }
}

const controller = new MarketWorkerController();

addEventListener(
  'message',
  ({ data }: MessageEvent<WorkerCommand>) => {
    controller.handleCommand(data);
  },
);
