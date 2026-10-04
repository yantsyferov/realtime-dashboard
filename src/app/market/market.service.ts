import { DestroyRef, Service, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import type { InstrumentMetrics } from '../interfaces/instrument-metrics.interface';
import type { MarketState } from '../interfaces/market-state.interface';
import type { ProducerSettings } from '../interfaces/producer-settings.interface';
import { DEFAULT_SETTINGS } from '../worker/worker-protocol';
import type { WorkerCommand, WorkerEvent } from '../worker/worker-protocol';
import { validateProducerSettings } from './producer-settings';

@Service()
export class MarketService {
  private readonly destroyRef = inject(DestroyRef);
  private worker: Worker | null = null;
  private activeRunId = 0;

  private readonly stateSubject = new BehaviorSubject<MarketState>({
    rows: Array.from(
      { length: DEFAULT_SETTINGS.instrumentCount },
      (_, instrumentId) => ({
        instrumentId,
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      }),
    ),
    settings: { ...DEFAULT_SETTINGS },
    status: 'initializing',
    error: null,
  });

  readonly state$ = this.stateSubject.asObservable();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.worker?.terminate();
      this.worker = null;
      this.stateSubject.complete();
    });

    try {
      this.worker = new Worker(
        new URL('../worker/market-worker-controller.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
        this.handleEvent(data);
      };
      this.worker.onerror = event => {
        this.fail(event.message || 'Worker execution failed');
      };
      this.worker.onmessageerror = () => {
        this.fail('Failed to deserialize a Worker message');
      };
      this.send({
        type: 'init',
        wasmUrl: new URL('wasm/release.wasm', document.baseURI).href,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  get currentSettings(): ProducerSettings {
    return { ...this.stateSubject.value.settings };
  }

  applySettings(settings: ProducerSettings): boolean {
    const status = this.stateSubject.value.status;
    if (status !== 'running' && status !== 'paused') return false;

    try {
      validateProducerSettings(settings);
    } catch (error) {
      this.patchState({
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    this.startRun(settings);
    return this.worker !== null;
  }

  pause(): void {
    if (this.stateSubject.value.status !== 'running') return;
    this.patchState({ status: 'pausing' });
    this.send({ type: 'pause', runId: this.activeRunId });
  }

  resume(): void {
    if (this.stateSubject.value.status !== 'paused') return;
    this.patchState({ status: 'resuming' });
    this.send({ type: 'resume', runId: this.activeRunId });
  }

  private startDefaultRun(): void {
    this.startRun(DEFAULT_SETTINGS);
  }

  private startRun(settings: Readonly<ProducerSettings>): void {
    this.activeRunId += 1;
    const rows: InstrumentMetrics[] = Array.from(
      { length: settings.instrumentCount },
      (_, instrumentId) => ({
        instrumentId,
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      }),
    );
    this.patchState({
      rows,
      settings: { ...settings },
      status: 'starting',
      error: null,
    });
    this.send({
      type: 'start',
      runId: this.activeRunId,
      settings: { ...settings },
      seed: 42,
    });
  }

  private handleEvent(event: WorkerEvent): void {
    if (!this.worker) return;
    if (event.type === 'ready') {
      if (this.stateSubject.value.status === 'initializing') {
        this.startDefaultRun();
      }
      return;
    }
    if (event.type === 'error' && event.runId === null) {
      this.fail(event.message);
      return;
    }
    if (event.runId !== this.activeRunId) return;

    switch (event.type) {
      case 'snapshot':
        this.patchState({ rows: event.rows });
        break;
      case 'status':
        this.patchState({ status: event.status });
        break;
      case 'error':
        this.fail(event.message);
        break;
    }
  }

  private patchState(patch: Partial<MarketState>): void {
    this.stateSubject.next({ ...this.stateSubject.value, ...patch });
  }

  private send(command: WorkerCommand): void {
    if (!this.worker) return;
    try {
      this.worker.postMessage(command);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  private fail(message: string): void {
    this.worker?.terminate();
    this.worker = null;
    this.patchState({ status: 'error', error: message });
  }
}
