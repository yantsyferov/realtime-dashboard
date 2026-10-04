import type { InstrumentMetrics } from '../interfaces/instrument-metrics.interface';
import type { ProducerSettings } from '../interfaces/producer-settings.interface';

export const DEFAULT_SETTINGS: Readonly<ProducerSettings> = {
  instrumentCount: 5,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};

export type WorkerCommand =
  | { type: 'init'; wasmUrl: string }
  | {
      type: 'start';
      runId: number;
      settings: ProducerSettings;
      seed: number;
    }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number };

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'snapshot'; runId: number; rows: InstrumentMetrics[] }
  | { type: 'status'; runId: number; status: 'running' | 'paused' }
  | { type: 'error'; runId: number | null; message: string };
