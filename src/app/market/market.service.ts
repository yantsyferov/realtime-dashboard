import { DestroyRef, Service, inject } from '@angular/core';

@Service()
export class MarketService {
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    const worker = new Worker(
      new URL('./market.worker', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = ({ data }) => {
      console.log('Worker Answer:', data);
    };

    worker.onerror = (event) => {
      console.error('Worker Error:', event.message);
    };

    worker.postMessage({
      type: 'init',
      wasmUrl: new URL('wasm/release.wasm', document.baseURI).href,
    });

    this.destroyRef.onDestroy(() => worker.terminate());
  }
}
