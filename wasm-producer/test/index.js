import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instantiate } from '../build/release.js';

const bytes = await readFile(
  new URL('../build/release.wasm', import.meta.url),
);

const producer = await instantiate(
  await WebAssembly.compile(bytes),
  {
    env: {
      abort: (_message, _fileName, line, column) => {
        throw new Error(`Wasm aborted at ${line}:${column}`);
      },
    },
  },
);

producer.initialize(5, 42);
const first = producer.generateBatch(100);

assert.equal(first.length, 700);

for (let offset = 0; offset < first.length; offset += 7) {
  const [id, price, quantity, bid, ask, bidQty, askQty] =
    first.slice(offset, offset + 7);

  assert.ok(id >= 0 && id < 5);
  assert.ok(bid > 0 && ask > bid);
  assert.ok(price === bid || price === ask);
  assert.ok(quantity > 0);
  assert.ok(bidQty >= 0 && askQty >= 0);
}

// Повторная инициализация должна воспроизвести результат.
producer.initialize(5, 42);
assert.deepEqual(producer.generateBatch(100), first);

// Разбиение на батчи не должно менять последовательность.
producer.initialize(5, 42);
const part1 = producer.generateBatch(40);
const part2 = producer.generateBatch(60);

assert.deepEqual(
  new Int32Array([...part1, ...part2]),
  first,
);

console.log('Generator tests passed');
