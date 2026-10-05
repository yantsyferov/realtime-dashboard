import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { instantiate } from '../../../wasm-producer/build/release.js';

type Producer = Awaited<ReturnType<typeof instantiate>>;
const UPDATE_SIZE = 7;
const SEED = 0xDEADBEEF >>> 0;

let producer: Producer;

async function loadProducer(): Promise<Producer> {
  const bytes = await readFile(
    resolve(process.cwd(), 'wasm-producer/build/release.wasm'),
  );
  const module = await WebAssembly.compile(bytes);
  return instantiate(module, {
    env: {
      abort: (_m: number, _f: number, line: number, column: number): never => {
        throw new Error(`Wasm aborted at ${line}:${column}`);
      },
    },
  });
}

beforeAll(async () => {
  producer = await loadProducer();
});

interface Update {
  readonly instrumentId: number;
  readonly tradePriceCents: number;
  readonly tradeQuantity: number;
  readonly bidPriceCents: number;
  readonly askPriceCents: number;
  readonly bidQuantity: number;
  readonly askQuantity: number;
}

function parse(batch: Int32Array): Update[] {
  const updates: Update[] = [];
  for (let o = 0; o < batch.length; o += UPDATE_SIZE) {
    updates.push({
      instrumentId: batch[o]!,
      tradePriceCents: batch[o + 1]!,
      tradeQuantity: batch[o + 2]!,
      bidPriceCents: batch[o + 3]!,
      askPriceCents: batch[o + 4]!,
      bidQuantity: batch[o + 5]!,
      askQuantity: batch[o + 6]!,
    });
  }
  return updates;
}

describe('wasm producer (real module)', () => {
  describe('batch length', () => {
    it.each([1, 100, 1000])('yields updateCount × 7 integers for size %i', updateCount => {
      producer.initialize(5, SEED);
      const batch = producer.generateBatch(updateCount);
      expect(batch).toBeInstanceOf(Int32Array);
      expect(batch.length).toBe(updateCount * UPDATE_SIZE);
    });
  });

  describe('update invariants', () => {
    const instrumentCount = 7;

    it('respects every invariant across a dense batch', () => {
      producer.initialize(instrumentCount, SEED);
      const updates = parse(producer.generateBatch(1000));
      expect(updates).toHaveLength(1000);

      for (const u of updates) {
        expect(u.instrumentId).toBeGreaterThanOrEqual(0);
        expect(u.instrumentId).toBeLessThan(instrumentCount);
        expect(u.bidPriceCents).toBeGreaterThan(0);
        expect(u.askPriceCents).toBeGreaterThan(u.bidPriceCents);
        expect(
          u.tradePriceCents === u.bidPriceCents ||
          u.tradePriceCents === u.askPriceCents,
        ).toBe(true);
        expect(u.tradeQuantity).toBeGreaterThan(0);
        expect(u.bidQuantity).toBeGreaterThanOrEqual(0);
        expect(u.askQuantity).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('state continuity', () => {
    it('persists state across consecutive generateBatch calls', () => {
      producer.initialize(5, SEED);
      const first = Array.from(producer.generateBatch(50));
      const second = Array.from(producer.generateBatch(50));

      producer.initialize(5, SEED);
      const combined = Array.from(producer.generateBatch(100));

      expect(first.length).toBe(50 * UPDATE_SIZE);
      expect(second.length).toBe(50 * UPDATE_SIZE);
      expect([...first, ...second]).toEqual(combined);
    });

    it('reproduces the sequence when initialize is called with the same arguments', () => {
      producer.initialize(5, SEED);
      const sequenceA = Array.from(producer.generateBatch(200));

      producer.initialize(5, SEED);
      const sequenceB = Array.from(producer.generateBatch(200));

      expect(sequenceA).toEqual(sequenceB);
    });

    it('produces different sequences for different seeds', () => {
      producer.initialize(5, SEED);
      const a = Array.from(producer.generateBatch(100));
      producer.initialize(5, (SEED + 1) >>> 0);
      const b = Array.from(producer.generateBatch(100));
      expect(a).not.toEqual(b);
    });
  });
});
