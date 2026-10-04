import type { MarketMetrics } from '../market/market-metrics';
import type { ProducerSettings } from './producer-settings.interface';

export interface ActiveRun {
  id: number;
  settings: ProducerSettings;
  metrics: MarketMetrics;
  paused: boolean;
}