import { handleSaveRequest } from '@/workers/save.worker';
import { SaveClient } from '@/workers/saveClient';
import type { SaveRequest, SaveResponse } from '@/workers/saveProtocol';

/**
 * A stand-in for the save worker (#272) that does what the real one does:
 * it takes a structured clone of each request, as `postMessage` would, runs
 * the worker's own handler on it and answers with a clone of the answer.
 * With `auto` it answers on the next task; otherwise each request waits
 * until the test releases it, so a test can hold a save in flight.
 */
export class CloneSaveWorker {
  onmessage: ((ev: MessageEvent<SaveResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  readonly held: SaveRequest[] = [];
  readonly received: SaveRequest[] = [];
  terminated = false;

  constructor(private readonly auto: boolean) {}

  postMessage(req: SaveRequest): void {
    const copy = structuredClone(req);
    this.received.push(copy);
    if (this.auto) {
      setTimeout(() => {
        this.answer(copy);
      }, 0);
    } else this.held.push(copy);
  }

  /** Answers the oldest held request (or all of them), as the worker would, in order. */
  release(count = this.held.length): void {
    for (const req of this.held.splice(0, count)) this.answer(req);
  }

  /** The worker dying, as an uncaught error in it would. */
  fail(): void {
    this.onerror?.({ message: 'boom' } as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }

  private answer(req: SaveRequest): void {
    if (this.terminated) return;
    const res = structuredClone(handleSaveRequest(req));
    this.onmessage?.({ data: res } as MessageEvent<SaveResponse>);
  }
}

/** A `SaveClient` over `CloneSaveWorker`s, sending every document to them (no size threshold). */
export function cloneSaveClient(options: { auto?: boolean; timeoutMs?: number } = {}): {
  client: SaveClient;
  workers: CloneSaveWorker[];
} {
  const workers: CloneSaveWorker[] = [];
  const client = new SaveClient(
    () => {
      const w = new CloneSaveWorker(options.auto ?? true);
      workers.push(w);
      return w as unknown as Worker;
    },
    options.timeoutMs,
    0,
  );
  return { client, workers };
}
