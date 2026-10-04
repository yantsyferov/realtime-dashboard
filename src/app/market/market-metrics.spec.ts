import { describe, expect, it } from 'vitest';
import { MarketMetrics } from './market-metrics';
import type { MarketUpdate } from '../interfaces/market-update.interface';

function trade(overrides: Partial<MarketUpdate> = {}): MarketUpdate {
  return {
    instrumentId: 0,
    priceCents: 10000,
    tradeQuantity: 10,
    bidCents: 9996,
    askCents: 10000,
    bidQuantity: 600,
    askQuantity: 400,
    ...overrides,
  };
}

describe('MarketMetrics', () => {
  it('starts with unavailable metrics and zero volume', () => {
    const metrics = new MarketMetrics(1);
    expect(metrics.snapshot()[0]).toEqual({
      instrumentId: 0,
      lastPriceCents: null,
      spreadCents: null,
      volume: 0,
      vwapCents: null,
      imbalance: null,
    });
  });

  it('calculates the worked example across multiple batches', () => {
    const metrics = new MarketMetrics(1);
    metrics.applyBatch([trade()]);
    metrics.applyBatch([trade({
      priceCents: 10200,
      tradeQuantity: 30,
      bidCents: 10196,
      askCents: 10200,
    })]);
    expect(metrics.snapshot()[0]).toEqual({
      instrumentId: 0,
      lastPriceCents: 10200,
      spreadCents: 4,
      volume: 40,
      vwapCents: 10150,
      imbalance: 0.2,
    });
  });

  it('handles zero denominators', () => {
    const metrics = new MarketMetrics(1);
    // Defensive test: the real generator produces positive quantities.
    metrics.applyBatch([trade({
      tradeQuantity: 0,
      bidQuantity: 0,
      askQuantity: 0,
    })]);
    const [row] = metrics.snapshot();
    expect(row!.vwapCents).toBeNull();
    expect(row!.imbalance).toBeNull();
    expect(row!.volume).toBe(0);
  });

  it('keeps instruments independent', () => {
    const metrics = new MarketMetrics(2);
    metrics.applyBatch([
      trade(),
      trade({
        instrumentId: 1,
        priceCents: 20000,
        tradeQuantity: 3,
        bidCents: 19996,
        askCents: 20000,
      }),
    ]);
    const [first, second] = metrics.snapshot();
    expect(first!.volume).toBe(10);
    expect(first!.vwapCents).toBe(10000);
    expect(second!.volume).toBe(3);
    expect(second!.vwapCents).toBe(20000);
  });
});
