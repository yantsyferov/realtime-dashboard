export interface InstrumentMetrics {
  instrumentId: number;
  lastPriceCents: number | null;
  spreadCents: number | null;
  volume: number;
  vwapCents: number | null;
  imbalance: number | null;
}

export interface InstrumentState {
  metrics: InstrumentMetrics;
  tradedValueCents: number;
}