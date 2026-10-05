import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import type { ProducerSettings } from '../interfaces/producer-settings.interface';
import type { Producer, ProducerFactory } from '../interfaces/worker-producer.interface';
import { MarketWorkerController } from './market-worker-controller';
import type { WorkerEvent } from './worker-protocol';

const UPDATE_SIZE = 7;

interface MockProducerHandle {
  readonly producer: Producer;
  readonly generateBatch: Mock;
  readonly initialize: Mock;
  readonly loadProducer: ProducerFactory;
}

function constantBatch(instrumentId: number, updateCount: number): Int32Array {
  const batch = new Int32Array(updateCount * UPDATE_SIZE);
  for (let i = 0; i < updateCount; i++) {
    const o = i * UPDATE_SIZE;
    batch[o] = instrumentId;
    batch[o + 1] = 10_000;       // tradePriceCents
    batch[o + 2] = 10;            // tradeQuantity
    batch[o + 3] = 9_996;         // bidCents
    batch[o + 4] = 10_000;        // askCents
    batch[o + 5] = 600;           // bidQuantity
    batch[o + 6] = 400;           // askQuantity
  }
  return batch;
}

function createMockProducer(): MockProducerHandle {
  const initialize = vi.fn<(instrumentCount: number, seed: number) => void>();
  const generateBatch = vi.fn<(updateCount: number) => Int32Array>(
    updateCount => constantBatch(0, updateCount),
  );
  const producer = { initialize, generateBatch } as unknown as Producer;
  const loadProducer = vi.fn<ProducerFactory>(async () => producer);
  return { producer, generateBatch, initialize, loadProducer };
}

async function createReadyController(
  mock: MockProducerHandle = createMockProducer(),
) {
  const post = vi.fn<(event: WorkerEvent) => void>();
  const controller = new MarketWorkerController({ post, loadProducer: mock.loadProducer });
  controller.handleCommand({ type: 'init', wasmUrl: 'test:/release.wasm' });
  // The initialize() promise resolves before anything is scheduled.
  await Promise.resolve();
  await Promise.resolve();
  expect(post.mock.calls.some(([e]) => e.type === 'ready')).toBe(true);
  return { controller, post, mock };
}

const defaultSettings: ProducerSettings = {
  instrumentCount: 3,
  updatesPerBatch: 10,
  batchIntervalMs: 100,
};

function eventsOfType<T extends WorkerEvent['type']>(
  post: Mock,
  type: T,
): Array<Extract<WorkerEvent, { type: T }>> {
  return post.mock.calls
    .map(([e]) => e as WorkerEvent)
    .filter((e): e is Extract<WorkerEvent, { type: T }> => e.type === type);
}

describe('MarketWorkerController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('startRun', () => {
    it('fails cleanly if start is received before init', () => {
      const post = vi.fn();
      const controller = new MarketWorkerController({
        post,
        loadProducer: vi.fn(),
      });
      controller.handleCommand({
        type: 'start',
        runId: 1,
        settings: defaultSettings,
        seed: 42,
      });

      const errors = eventsOfType(post, 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toMatch(/not ready/i);
    });

    it('rejects invalid settings without starting a timer', async () => {
      const { controller, post, mock } = await createReadyController();
      controller.handleCommand({
        type: 'start',
        runId: 1,
        settings: { instrumentCount: 0, updatesPerBatch: 10, batchIntervalMs: 100 },
        seed: 42,
      });
      expect(mock.generateBatch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(mock.generateBatch).not.toHaveBeenCalled();
      expect(eventsOfType(post, 'error')).toHaveLength(1);
    });

    it('rejects a non-uint32 seed', async () => {
      const { controller, post } = await createReadyController();
      controller.handleCommand({
        type: 'start',
        runId: 1,
        settings: defaultSettings,
        seed: -1,
      });
      expect(eventsOfType(post, 'error')).toHaveLength(1);
    });

    it('initializes the producer and emits initial snapshot + status=running', async () => {
      const { controller, post, mock } = await createReadyController();
      controller.handleCommand({
        type: 'start',
        runId: 7,
        settings: defaultSettings,
        seed: 42,
      });
      expect(mock.initialize).toHaveBeenCalledWith(3, 42);
      const snapshots = eventsOfType(post, 'snapshot');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.runId).toBe(7);
      expect(snapshots[0]!.rows[0]!.volume).toBe(0);

      const statuses = eventsOfType(post, 'status');
      expect(statuses).toContainEqual({ type: 'status', runId: 7, status: 'running' });
    });
  });

  describe('generation timer', () => {
    it('generates one batch per batchIntervalMs tick', async () => {
      const { controller, post, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });

      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(300);
      expect(mock.generateBatch).toHaveBeenCalledTimes(4);

      const snapshots = eventsOfType(post, 'snapshot');
      // 1 initial + 4 generated
      expect(snapshots).toHaveLength(5);
    });

    it('stops generating during pause', async () => {
      const { controller, mock, post } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });

      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);

      controller.handleCommand({ type: 'pause', runId: 1 });
      vi.advanceTimersByTime(500);
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
      expect(eventsOfType(post, 'status')).toContainEqual({
        type: 'status', runId: 1, status: 'paused',
      });
    });

    it('resumes generation from the paused state', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(100);
      controller.handleCommand({ type: 'pause', runId: 1 });
      vi.advanceTimersByTime(500);
      controller.handleCommand({ type: 'resume', runId: 1 });
      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(2);
    });

    it('preserves accumulated volume across pause/resume', async () => {
      const { controller, post } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(300);
      const snapshotsBeforePause = eventsOfType(post, 'snapshot');
      const volumeBeforePause = snapshotsBeforePause.at(-1)!.rows[0]!.volume;
      expect(volumeBeforePause).toBe(300); // 3 ticks × 10 updates × 10 qty

      controller.handleCommand({ type: 'pause', runId: 1 });
      vi.advanceTimersByTime(500);

      controller.handleCommand({ type: 'resume', runId: 1 });
      vi.advanceTimersByTime(100);

      const snapshots = eventsOfType(post, 'snapshot');
      const last = snapshots.at(-1)!;
      expect(last.rows[0]!.volume).toBe(400); // + 1 more tick
    });

    it('ignores pause for a stale runId', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(100);
      controller.handleCommand({ type: 'pause', runId: 999 });
      vi.advanceTimersByTime(100);
      // Still generating.
      expect(mock.generateBatch).toHaveBeenCalledTimes(2);
    });

    it('ignores resume for a stale runId', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      controller.handleCommand({ type: 'pause', runId: 1 });
      controller.handleCommand({ type: 'resume', runId: 999 });
      vi.advanceTimersByTime(500);
      expect(mock.generateBatch).not.toHaveBeenCalled();
    });

    it('does not create a second timer when resume is sent while already running', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      // Resume while running (not paused): worker ignores it, no extra subscription.
      controller.handleCommand({ type: 'resume', runId: 1 });
      controller.handleCommand({ type: 'resume', runId: 1 });
      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
    });

    it('does not create a second timer when start is sent twice for the same run', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      controller.handleCommand({ type: 'start', runId: 2, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(100);
      // Only one batch per tick regardless of how many starts were sent.
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
    });

    it('cancels the previous run timer on restart', async () => {
      const { controller, mock } = await createReadyController();
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);

      controller.handleCommand({
        type: 'start',
        runId: 2,
        settings: { ...defaultSettings, batchIntervalMs: 200 },
        seed: 42,
      });
      vi.advanceTimersByTime(100);
      // Not yet — new interval is 200.
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(mock.generateBatch).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('surfaces generation errors and stops the timer', async () => {
      const mock = createMockProducer();
      mock.generateBatch.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      const { controller, post } = await createReadyController(mock);
      controller.handleCommand({ type: 'start', runId: 1, settings: defaultSettings, seed: 42 });
      vi.advanceTimersByTime(100);

      const errors = eventsOfType(post, 'error');
      expect(errors.at(-1)).toEqual({ type: 'error', runId: 1, message: 'boom' });

      vi.advanceTimersByTime(500);
      // Timer stopped — no new generation attempts.
      expect(mock.generateBatch).toHaveBeenCalledTimes(1);
    });

    it('reports loader failures with runId=null', async () => {
      const post = vi.fn();
      const loadProducer = vi.fn<ProducerFactory>(async () => {
        throw new Error('cannot load wasm');
      });
      const controller = new MarketWorkerController({ post, loadProducer });
      controller.handleCommand({ type: 'init', wasmUrl: 'test:/release.wasm' });
      await Promise.resolve();
      await Promise.resolve();
      const errors = eventsOfType(post, 'error');
      expect(errors[0]).toEqual({ type: 'error', runId: null, message: 'cannot load wasm' });
    });
  });
});
