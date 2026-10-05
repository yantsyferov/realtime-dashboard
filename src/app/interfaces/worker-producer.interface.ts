import { instantiate } from '../../../wasm-producer/build/release.js';
import { WorkerEvent } from '../worker/worker-protocol';

export type Producer = Awaited<ReturnType<typeof instantiate>>;
export type ProducerFactory = (wasmUrl: string) => Promise<Producer>;
export type PostMessageFn = (event: WorkerEvent) => void;

export interface MarketWorkerControllerDeps {
  readonly post: PostMessageFn;
  readonly loadProducer?: ProducerFactory;
}
