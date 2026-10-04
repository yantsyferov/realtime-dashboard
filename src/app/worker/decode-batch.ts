import type { MarketUpdate } from '../interfaces/market-update.interface';

const UPDATE_SIZE = 7;

export function decodeBatch(batch: Int32Array): MarketUpdate[] {
  if (batch.length % UPDATE_SIZE !== 0) {
    throw new Error(
      `Invalid batch length: ${batch.length}. Expected a multiple of ${UPDATE_SIZE}.`,
    );
  }

  const updates: MarketUpdate[] = [];
  for (let offset = 0; offset < batch.length; offset += UPDATE_SIZE) {
    updates.push({
      instrumentId: batch[offset]!,
      priceCents: batch[offset + 1]!,
      tradeQuantity: batch[offset + 2]!,
      bidCents: batch[offset + 3]!,
      askCents: batch[offset + 4]!,
      bidQuantity: batch[offset + 5]!,
      askQuantity: batch[offset + 6]!,
    });
  }
  return updates;
}
