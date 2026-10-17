import { ExportCancelledError, type ExportJobOptions } from '@/app/exportJob';
import type { ZipEntry } from '@/io';

import { handleExportRequest } from './export.worker';
import {
  type ExportRequest,
  type ExportResponse,
  type PngPage,
  transferablesOf,
} from './exportProtocol';

interface Pending {
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (e: Error) => void;
  readonly onProgress: ExportJobOptions['onProgress'];
}

/** Omit that distributes over the union, so each request kind keeps its own fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<ExportRequest, 'id'>;

/**
 * Talks to the export worker (#247, #248). One job runs at a time, which is
 * what the dialog allows; a job's signal aborting terminates the worker,
 * so the work really stops, and the next job starts a new one. Where
 * `Worker` does not exist (tests, old runtimes) the same code runs on the
 * calling thread, so callers never need to care.
 */
export class ExportClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly createWorker: (() => Worker) | null = defaultWorkerFactory) {}

  /** The pages (or any files) as one deflated ZIP, as `writeZip` writes it. */
  zip(entries: readonly ZipEntry[], options: ExportJobOptions = {}): Promise<Uint8Array> {
    return this.send({ kind: 'zip', entries }, options);
  }

  /** One PDF of the PNG pages, each placed at its own size (`writeRasterPdf`). */
  rasterPdf(
    pages: readonly PngPage[],
    title: string,
    options: ExportJobOptions = {},
  ): Promise<Uint8Array> {
    return this.send({ kind: 'rasterPdf', pages, title }, options);
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== null || this.createWorker === null) return this.worker;
    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch {
      return null;
    }
    worker.onmessage = (ev: MessageEvent<ExportResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (p === undefined) return;
      if (ev.data.kind === 'progress') {
        p.onProgress?.({ stage: 'writing', done: ev.data.done, total: ev.data.total });
        return;
      }
      this.pending.delete(ev.data.id);
      if (ev.data.kind === 'done') p.resolve(ev.data.bytes);
      else p.reject(new Error(ev.data.message));
    };
    worker.onerror = () => {
      this.failAll(new Error('The export worker failed.'));
      this.stopWorker();
    };
    this.worker = worker;
    return worker;
  }

  private stopWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private failAll(error: Error): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private send(body: RequestBody, options: ExportJobOptions): Promise<Uint8Array> {
    const { signal, onProgress } = options;
    if (signal?.aborted === true) return Promise.reject(new ExportCancelledError());
    const id = this.nextId++;
    const req: ExportRequest = { ...body, id };
    const worker = this.ensureWorker();
    if (worker === null) return handleExportRequest(req, options);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return; // already answered
          // The worker is in the middle of this job and nothing else: end it.
          this.stopWorker();
          reject(new ExportCancelledError());
        },
        { once: true },
      );
      worker.postMessage(req, transferablesOf(req));
    });
  }
}

function defaultWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') throw new Error('Workers unavailable');
  return new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
}

export const exportClient = new ExportClient(
  typeof Worker === 'undefined' ? null : defaultWorkerFactory,
);
