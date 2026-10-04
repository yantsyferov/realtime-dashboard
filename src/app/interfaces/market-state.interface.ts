import type { InstrumentMetrics } from './instrument-metrics.interface';
import type { ProducerSettings } from './producer-settings.interface';

export type MarketStatus =
  | 'initializing'
  | 'starting'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'resuming'
  | 'error';

export interface MarketState {
  readonly rows: readonly Readonly<InstrumentMetrics>[];
  readonly settings: Readonly<ProducerSettings>;
  readonly status: MarketStatus;
  readonly error: string | null;
}