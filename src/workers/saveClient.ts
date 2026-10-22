import type { SeqDocument } from '@/core';
import { writeGenBank } from '@/io';

import { type SaveRequest, type SaveResponse, snapshotOf } from './saveProtocol';

/**
 * From this many residues on, the autosave's GenBank text is written in the
 * save worker (#272). Below it `writeGenBank` is about 2 ms on the main
 * thread and the round trip would only put the save a beat later; past it
 * the text is 10 ms at 300 kb, 30 ms at 1 Mb and 110 ms at a genome, where
 * what the main thread pays to send the document is a tenth of that
 * (`docs/perf-notes.md`). The same line as the checksum's (#270).
 */
export const WORKER_GENBANK_FROM = 50_000;

/**
 * How long an answer may take before the worker is given up on and the
 * text written here. A genome's text is about 0.2 s in the worker; this is
 * only there so a worker that hangs cannot hold the autosave up for good.
 */
export const SAVE_TIMEOUT_MS = 20_000;

interface Pending {
  readonly docs: readonly SeqDocument[];
  readonly resolve: (texts: string[]) => void;
  readonly reject: (e: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Answers a request by writing its texts here; what throws here would have thrown anyway. */
function writeHere(p: Pending): void {
  clearTimeout(p.timer);
  try {
    p.resolve(inline(p.docs));
  } catch (e) {
    p.reject(e);
  }
}

/**
 * Talks to the save worker. One method: the GenBank text of each document,
 * as `writeGenBank` writes it. Whatever goes wrong on the way — no `Worker`
 * (tests, old runtimes), a worker that fails to start or dies, an error
 * answer — the text is written here instead, so a save is never lost to the
 * worker; it is only slower.
 */
export class SaveClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly createWorker: (() => Worker) | null = defaultWorkerFactory,
    private readonly timeoutMs: number = SAVE_TIMEOUT_MS,
    /** `WORKER_GENBANK_FROM`; a test sends every document to its worker with 0. */
    private readonly workerFrom: number = WORKER_GENBANK_FROM,
  ) {}

  private ensureWorker(): Worker | null {
    if (this.worker !== null || this.createWorker === null) return this.worker;
    try {
      this.worker = this.createWorker();
    } catch {
      return null;
    }
    this.worker.onmessage = (ev: MessageEvent<SaveResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (p === undefined) return;
      this.pending.delete(ev.data.id);
      if (ev.data.kind === 'genbank') {
        clearTimeout(p.timer);
        p.resolve([...ev.data.texts]);
      } else writeHere(p);
    };
    this.worker.onerror = () => {
      this.giveUp();
    };
    return this.worker;
  }

  /** Ends the worker and writes here whatever was waiting on it; the next save starts a new one. */
  private giveUp(): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const p of waiting) writeHere(p);
  }

  /**
   * The GenBank text of each document, in the worker when the largest is
   * past `WORKER_GENBANK_FROM`. Answers come back in the order asked, since
   * the worker takes one request at a time.
   */
  genBank(docs: readonly SeqDocument[]): Promise<string[]> {
    const worker = docs.some((d) => d.length >= this.workerFrom) ? this.ensureWorker() : null;
    return new Promise((resolve, reject) => {
      const p: Pending = { docs, resolve, reject };
      if (worker === null) {
        writeHere(p);
        return;
      }
      const req: SaveRequest = { id: this.nextId++, kind: 'genbank', docs: docs.map(snapshotOf) };
      this.pending.set(req.id, p);
      try {
        worker.postMessage(req);
      } catch {
        this.pending.delete(req.id);
        writeHere(p);
        return;
      }
      p.timer = setTimeout(() => {
        if (this.pending.has(req.id)) this.giveUp();
      }, this.timeoutMs);
    });
  }

  dispose(): void {
    this.giveUp();
  }
}

function inline(docs: readonly SeqDocument[]): string[] {
  return docs.map((d) => writeGenBank(d));
}

function defaultWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') throw new Error('Workers unavailable');
  return new Worker(new URL('./save.worker.ts', import.meta.url), { type: 'module' });
}

export const saveClient = new SaveClient(
  typeof Worker === 'undefined' ? null : defaultWorkerFactory,
);
