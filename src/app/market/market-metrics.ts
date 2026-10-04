import type {
  InstrumentMetrics,
  InstrumentState,
} from '../interfaces/instrument-metrics.interface';
import type { MarketUpdate } from '../interfaces/market-update.interface';

export class MarketMetrics {
  private readonly instruments: InstrumentState[];

  constructor(instrumentCount: number) {
    this.instruments = Array.from(
      { length: instrumentCount },
      (_, instrumentId) => ({
        metrics: {
          instrumentId,
          lastPriceCents: null,
          spreadCents: null,
          volume: 0,
          vwapCents: null,
          imbalance: null,
        },
        tradedValueCents: 0,
      }),
    );
  }

  applyBatch(updates: readonly MarketUpdate[]): void {
    for (const update of updates) {
      this.applyUpdate(update);
    }
  }

  snapshot(): InstrumentMetrics[] {
    return this.instruments.map(({ metrics }) => ({ ...metrics }));
  }

  private applyUpdate(update: MarketUpdate): void {
    const state = this.instruments[update.instrumentId];
    if (!state) {
      throw new Error(`Unknown instrument: ${update.instrumentId}`);
    }

    const metrics = state.metrics;
    metrics.lastPriceCents = update.priceCents;
    metrics.spreadCents = update.askCents - update.bidCents;
    metrics.volume += update.tradeQuantity;
    state.tradedValueCents += update.priceCents * update.tradeQuantity;
    metrics.vwapCents = metrics.volume === 0
      ? null
      : state.tradedValueCents / metrics.volume;

    const bookQuantity = update.bidQuantity + update.askQuantity;
    metrics.imbalance = bookQuantity === 0
      ? null
      : (update.bidQuantity - update.askQuantity) / bookQuantity;
  }
}
