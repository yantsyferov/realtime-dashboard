import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import type { InstrumentMetrics } from '../interfaces/instrument-metrics.interface';
import type { MarketState } from '../interfaces/market-state.interface';
import type { WorkerCommand, WorkerEvent } from '../worker/worker-protocol';
import { MarketService } from './market.service';

class MockWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn<(command: WorkerCommand) => void>();
  readonly terminate = vi.fn<() => void>();

  emit(event: WorkerEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>);
  }

  emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  commandsOfType<T extends WorkerCommand['type']>(type: T): Array<Extract<WorkerCommand, { type: T }>> {
    return this.postMessage.mock.calls
      .map(([cmd]) => cmd)
      .filter((cmd): cmd is Extract<WorkerCommand, { type: T }> => cmd.type === type);
  }
}

const workers: MockWorker[] = [];
let originalWorker: typeof Worker;
let workerCtor: MockInstance;

function latestWorker(): MockWorker {
  return workers[workers.length - 1]!;
}

function row(instrumentId: number, overrides: Partial<InstrumentMetrics> = {}): InstrumentMetrics {
  return {
    instrumentId,
    lastPriceCents: 10_000,
    spreadCents: 4,
    volume: 100,
    vwapCents: 10_000,
    imbalance: 0.2,
    ...overrides,
  };
}

function createService(): { service: MarketService; injector: EnvironmentInjector } {
  const parent = TestBed.inject(EnvironmentInjector);
  const injector = createEnvironmentInjector([MarketService], parent, 'market-test');
  const service = injector.get(MarketService);
  return { service, injector };
}

async function latestState(service: MarketService): Promise<MarketState> {
  return firstValueFrom(service.state$);
}

/** Boot a service with a ready worker and the default run already running. */
async function bootRunning(): Promise<{ service: MarketService; worker: MockWorker; injector: EnvironmentInjector }> {
  const { service, injector } = createService();
  const worker = latestWorker();
  worker.emit({ type: 'ready' });
  // startDefaultRun triggered — service is in 'starting', send 'start' command.
  worker.emit({ type: 'status', runId: firstStartRunId(worker), status: 'running' });
  return { service, worker, injector };
}

function firstStartRunId(worker: MockWorker): number {
  const starts = worker.commandsOfType('start');
  if (!starts[0]) throw new Error('expected a start command');
  return starts[0].runId;
}

describe('MarketService', () => {
  beforeEach(() => {
    workers.length = 0;
    originalWorker = globalThis.Worker;
    workerCtor = vi.fn(function (this: unknown) {
      const w = new MockWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    globalThis.Worker = workerCtor as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    TestBed.resetTestingModule();
  });

  describe('initialization', () => {
    it('creates exactly one Worker when the service is injected', () => {
      createService();
      expect(workerCtor).toHaveBeenCalledTimes(1);
    });

    it('posts init with the Wasm URL', () => {
      createService();
      const inits = latestWorker().commandsOfType('init');
      expect(inits).toHaveLength(1);
      expect(inits[0]!.wasmUrl).toMatch(/wasm\/release\.wasm$/);
    });

    it('surfaces constructor failures as an error state', async () => {
      globalThis.Worker = vi.fn(() => {
        throw new Error('no workers in this JSDOM');
      }) as unknown as typeof Worker;

      const { service } = createService();
      const state = await latestState(service);
      expect(state.status).toBe('error');
      expect(state.error).toMatch(/no workers/);
    });

    it('surfaces worker.onerror into state', async () => {
      const { service } = createService();
      latestWorker().emitError('boom');
      const state = await latestState(service);
      expect(state.status).toBe('error');
      expect(state.error).toBe('boom');
    });

    it('terminates the worker when the service is destroyed', () => {
      const { injector } = createService();
      const worker = latestWorker();
      injector.destroy();
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('starts the default run only after the worker reports ready', () => {
      createService();
      const worker = latestWorker();
      expect(worker.commandsOfType('start')).toHaveLength(0);
      worker.emit({ type: 'ready' });
      expect(worker.commandsOfType('start')).toHaveLength(1);
      expect(worker.commandsOfType('start')[0]!.settings).toMatchObject({
        instrumentCount: 5,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });
    });
  });

  describe('applySettings', () => {
    it('is rejected before the service transitions out of initializing', () => {
      const { service } = createService();
      expect(service.applySettings({
        instrumentCount: 10,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      })).toBe(false);
    });

    it('starts a fresh run on top of a running one', async () => {
      const { service, worker } = await bootRunning();
      const result = service.applySettings({
        instrumentCount: 7,
        updatesPerBatch: 250,
        batchIntervalMs: 1000,
      });
      expect(result).toBe(true);

      const starts = worker.commandsOfType('start');
      expect(starts).toHaveLength(2);
      expect(starts[1]!.runId).toBeGreaterThan(starts[0]!.runId);
      expect(starts[1]!.settings).toEqual({
        instrumentCount: 7,
        updatesPerBatch: 250,
        batchIntervalMs: 1000,
      });

      const state = await latestState(service);
      expect(state.status).toBe('starting');
      expect(state.settings).toEqual({
        instrumentCount: 7,
        updatesPerBatch: 250,
        batchIntervalMs: 1000,
      });
    });

    it('resets all metrics to the unavailable state for the new run', async () => {
      const { service, worker } = await bootRunning();
      // Simulate accumulated metrics from the previous run.
      const prevRunId = firstStartRunId(worker);
      worker.emit({
        type: 'snapshot',
        runId: prevRunId,
        rows: [row(0, { volume: 999 }), row(1, { volume: 500 })],
      });
      expect((await latestState(service)).rows[0]!.volume).toBe(999);

      service.applySettings({
        instrumentCount: 3,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });

      const state = await latestState(service);
      expect(state.rows).toHaveLength(3);
      for (const r of state.rows) {
        expect(r.volume).toBe(0);
        expect(r.lastPriceCents).toBeNull();
        expect(r.spreadCents).toBeNull();
        expect(r.vwapCents).toBeNull();
        expect(r.imbalance).toBeNull();
      }
    });

    it('starts generation when applied from the paused state', async () => {
      const { service, worker } = await bootRunning();
      const prevRunId = firstStartRunId(worker);
      service.pause();
      worker.emit({ type: 'status', runId: prevRunId, status: 'paused' });

      const ok = service.applySettings({
        instrumentCount: 2,
        updatesPerBatch: 50,
        batchIntervalMs: 200,
      });
      expect(ok).toBe(true);

      const starts = worker.commandsOfType('start');
      expect(starts).toHaveLength(2);
      expect(starts[1]!.runId).toBeGreaterThan(prevRunId);
    });

    it('does not create parallel runs when Apply is pressed again before the worker responds', async () => {
      const { service, worker } = await bootRunning();
      const first = service.applySettings({
        instrumentCount: 7,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });
      const second = service.applySettings({
        instrumentCount: 8,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      // 2 total starts: default run + the single successful apply.
      expect(worker.commandsOfType('start')).toHaveLength(2);
    });

    it('rejects invalid settings and surfaces an error in state', async () => {
      const { service } = await bootRunning();
      const ok = service.applySettings({
        instrumentCount: 0,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });
      expect(ok).toBe(false);
      const state = await latestState(service);
      expect(state.error).toMatch(/Instrument count/);
    });
  });

  describe('pause and resume', () => {
    it('posts pause when running and transitions through pausing to paused', async () => {
      const { service, worker } = await bootRunning();
      const runId = firstStartRunId(worker);

      service.pause();
      expect((await latestState(service)).status).toBe('pausing');
      expect(worker.commandsOfType('pause')).toEqual([{ type: 'pause', runId }]);

      worker.emit({ type: 'status', runId, status: 'paused' });
      expect((await latestState(service)).status).toBe('paused');
    });

    it('ignores pause when not running', async () => {
      const { service, worker } = await bootRunning();
      service.pause();
      service.pause(); // second call during pausing is a no-op
      expect(worker.commandsOfType('pause')).toHaveLength(1);
    });

    it('posts resume when paused and transitions back to running', async () => {
      const { service, worker } = await bootRunning();
      const runId = firstStartRunId(worker);
      service.pause();
      worker.emit({ type: 'status', runId, status: 'paused' });

      service.resume();
      expect((await latestState(service)).status).toBe('resuming');
      expect(worker.commandsOfType('resume')).toEqual([{ type: 'resume', runId }]);

      worker.emit({ type: 'status', runId, status: 'running' });
      expect((await latestState(service)).status).toBe('running');
    });

    it('ignores resume when not paused', async () => {
      const { service, worker } = await bootRunning();
      service.resume();
      expect(worker.commandsOfType('resume')).toHaveLength(0);
    });

    it('does not emit duplicate pause/resume commands on repeated calls', async () => {
      const { service, worker } = await bootRunning();
      const runId = firstStartRunId(worker);

      service.pause();
      service.pause();
      service.pause();
      expect(worker.commandsOfType('pause')).toHaveLength(1);

      worker.emit({ type: 'status', runId, status: 'paused' });
      service.resume();
      service.resume();
      expect(worker.commandsOfType('resume')).toHaveLength(1);
    });

    it('preserves accumulated metrics across pause', async () => {
      const { service, worker } = await bootRunning();
      const runId = firstStartRunId(worker);

      worker.emit({
        type: 'snapshot',
        runId,
        rows: [row(0, { volume: 42, lastPriceCents: 10_500 })],
      });
      service.pause();
      worker.emit({ type: 'status', runId, status: 'paused' });

      const state = await latestState(service);
      expect(state.rows[0]!.volume).toBe(42);
      expect(state.rows[0]!.lastPriceCents).toBe(10_500);
    });
  });

  describe('message filtering by runId', () => {
    it('ignores snapshots that arrive late from a previous run', async () => {
      const { service, worker } = await bootRunning();
      const oldRunId = firstStartRunId(worker);

      service.applySettings({
        instrumentCount: 3,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });

      worker.emit({
        type: 'snapshot',
        runId: oldRunId,
        rows: [row(0, { volume: 999 }), row(1), row(2)],
      });

      const state = await latestState(service);
      expect(state.rows).toHaveLength(3);
      expect(state.rows[0]!.volume).toBe(0); // still the fresh-run default
    });

    it('ignores status messages for a previous run', async () => {
      const { service, worker } = await bootRunning();
      const oldRunId = firstStartRunId(worker);
      service.applySettings({
        instrumentCount: 3,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });

      worker.emit({ type: 'status', runId: oldRunId, status: 'paused' });
      const state = await latestState(service);
      expect(state.status).toBe('starting');
    });

    it('ignores errors for a previous run but still accepts global errors (runId=null)', async () => {
      const { service, worker } = await bootRunning();
      const oldRunId = firstStartRunId(worker);
      service.applySettings({
        instrumentCount: 3,
        updatesPerBatch: 100,
        batchIntervalMs: 500,
      });

      worker.emit({ type: 'error', runId: oldRunId, message: 'stale' });
      expect((await latestState(service)).error).toBeNull();

      worker.emit({ type: 'error', runId: null, message: 'fatal' });
      const state = await latestState(service);
      expect(state.status).toBe('error');
      expect(state.error).toBe('fatal');
    });
  });

  describe('component lifecycle (navigation)', () => {
    it('reuses the same Worker across the lifetime of the service', async () => {
      const { service } = await bootRunning();
      // Access state from multiple hypothetical consumers; nothing recreates the worker.
      await latestState(service);
      await latestState(service);
      expect(workerCtor).toHaveBeenCalledTimes(1);
    });

    it('keeps running when a page component is destroyed (service outlives routes)', async () => {
      const { service, worker, injector } = await bootRunning();
      const runId = firstStartRunId(worker);

      // Simulate dashboard being destroyed but the root service staying alive.
      // The service injector is independent, so destroying another injector should not affect it.
      const transient = createEnvironmentInjector([], injector, 'route-view');
      transient.destroy();

      // Worker should NOT be terminated.
      expect(worker.terminate).not.toHaveBeenCalled();

      // Metrics continue to flow and update the state.
      worker.emit({
        type: 'snapshot',
        runId,
        rows: [row(0, { volume: 10 })],
      });
      const state = await latestState(service);
      expect(state.rows[0]!.volume).toBe(10);
    });
  });
});
