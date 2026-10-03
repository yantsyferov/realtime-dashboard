interface InitMessage {
  type: 'init';
  wasmUrl: string;
}

addEventListener('message', async ({ data }: MessageEvent<InitMessage>) => {
  if (data.type !== 'init') return;

  try {
    const response = await fetch(data.wasmUrl);

    if (!response.ok) {
      throw new Error(`Error while loading Wasm: HTTP ${response.status}`);
    }

    const bytes = await response.arrayBuffer();

    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        abort: () => {
          throw new Error('Running Wasm is interrupted');
        },
      },
    });

    const add = instance.exports['add'] as (
      a: number,
      b: number,
    ) => number;

    const result = add(2, 3);

    postMessage({ type: 'result', result });
  } catch (error) {
    postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
