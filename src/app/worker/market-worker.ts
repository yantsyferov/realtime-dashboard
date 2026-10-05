import { MarketWorkerController } from './market-worker-controller';

import type {
  WorkerCommand,
  WorkerEvent,
} from './worker-protocol';

const controller = new MarketWorkerController({
  post: (event: WorkerEvent) => self.postMessage(event),
});

self.addEventListener(
  'message',
  ({ data }: MessageEvent<WorkerCommand>) => {
    controller.handleCommand(data);
  },
);
