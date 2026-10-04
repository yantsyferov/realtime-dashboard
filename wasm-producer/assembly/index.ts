const UPDATE_SIZE: i32 = 7;

const INSTRUMENT_ID: i32 = 0;
const TRADE_PRICE: i32 = 1;
const TRADE_QUANTITY: i32 = 2;
const BID_PRICE: i32 = 3;
const ASK_PRICE: i32 = 4;
const BID_QUANTITY: i32 = 5;
const ASK_QUANTITY: i32 = 6;

const INITIAL_MIN_PRICE_CENTS: i32 = 5_000;
const INITIAL_MAX_PRICE_CENTS: i32 = 20_000;

const MIN_PRICE_CENTS: i32 = 100;
const MAX_PRICE_CENTS: i32 = 1_000_000;
const MAX_PRICE_CHANGE_CENTS: i32 = 10;

let referencePricesCents = new Int32Array(0);

let randomState: u32 = 1;

export function initialize(
  instrumentCount: i32,
  seed: u32,
): void {
  assert(
    instrumentCount >= 1 && instrumentCount <= 50,
    "Instrument count must be between 1 and 50",
  );

  // xorshift32 state should not be zero
  randomState = seed == 0 ? 1 : seed;

  referencePricesCents = new Int32Array(instrumentCount);

  for (let instrumentId = 0; instrumentId < instrumentCount; instrumentId++) {
    referencePricesCents[instrumentId] = randomInt(
      INITIAL_MIN_PRICE_CENTS,
      INITIAL_MAX_PRICE_CENTS,
    );
  }
}

export function generateBatch(updateCount: i32): Int32Array {
  assert(
    referencePricesCents.length > 0,
    "Generator is not initialized",
  );

  assert(
    updateCount >= 1 && updateCount <= 1000,
    "Update count must be between 1 and 1000",
  );

  const batch = new Int32Array(updateCount * UPDATE_SIZE);

  for (let updateIndex = 0; updateIndex < updateCount; updateIndex++) {
    const offset = updateIndex * UPDATE_SIZE;

    generateUpdateIntoBatch(batch, offset);
  }

  return batch;
}

function generateUpdateIntoBatch(
  batch: Int32Array,
  offset: i32,
): void {
  // select a random instrument
  const instrumentId = randomInt(
    0,
    referencePricesCents.length - 1,
  );

  // change the reference price
  const referencePriceCents = updateReferencePrice(instrumentId);

  // generating buy\sell prices based on the reference price
  const bidPriceCents = referencePriceCents - randomInt(1, 5);
  const askPriceCents = referencePriceCents + randomInt(1, 5);

  // trade imitation
  const tradeAtBid = randomInt(0, 1) == 0;

  const tradePriceCents = tradeAtBid
    ? bidPriceCents
    : askPriceCents;

  const tradeQuantity = randomInt(1, 100);

  // volume generation
  const bidQuantity = randomInt(0, 1000);
  const askQuantity = randomInt(0, 1000);


  batch[offset + INSTRUMENT_ID] = instrumentId;
  batch[offset + TRADE_PRICE] = tradePriceCents;
  batch[offset + TRADE_QUANTITY] = tradeQuantity;
  batch[offset + BID_PRICE] = bidPriceCents;
  batch[offset + ASK_PRICE] = askPriceCents;
  batch[offset + BID_QUANTITY] = bidQuantity;
  batch[offset + ASK_QUANTITY] = askQuantity;
}

function updateReferencePrice(instrumentId: i32): i32 {
  const previousPriceCents = referencePricesCents[instrumentId];

  const priceChangeCents = randomInt(
    -MAX_PRICE_CHANGE_CENTS,
    MAX_PRICE_CHANGE_CENTS,
  );

  const nextPriceCents = clampPrice(
    previousPriceCents + priceChangeCents,
  );

  referencePricesCents[instrumentId] = nextPriceCents;

  return nextPriceCents;
}

function clampPrice(priceCents: i32): i32 {
  if (priceCents < MIN_PRICE_CENTS) {
    return MIN_PRICE_CENTS;
  }

  if (priceCents > MAX_PRICE_CENTS) {
    return MAX_PRICE_CENTS;
  }

  return priceCents;
}

function randomInt(min: i32, max: i32): i32 {
  const rangeSize = <u32>(max - min + 1);
  const randomOffset = <i32>(nextRandom() % rangeSize);

  return min + randomOffset;
}

// xorshift32
function nextRandom(): u32 {
  let value = randomState;

  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;

  randomState = value;

  return value;
}
