import { type EnzymeSet } from '@/core';

import { AnalysisClient, analysisClient } from './analysisClient';

/** The most workers a batch run starts: past this the plate's rows gain little and the page loses its cores. */
export const MAX_POOL_WORKERS = 4;

/** How many workers a batch gets on a machine with `cores` logical cores (#423): all of them, up to four, at least one. */
export function poolSize(cores: number | undefined): number {
  if (cores === undefined || !Number.isFinite(cores)) return 1;
  return Math.max(1, Math.min(MAX_POOL_WORKERS, Math.floor(cores)));
}

/**
 * A few analysis clients for batch runs (#423, item 142). `analysisClient`
 * stays one worker, because everything else on the page shares its queue and
 * a cancel replaces it; a batch of rows that each take 200 ms gets its own
 * workers here, one per lane of the run, so a cancel in the batch cannot
 * disturb the editor's scans. The workers start on their first request and
 * are stopped by `release()` when the run is over.
 */
export class AnalysisPool {
  readonly clients: readonly AnalysisClient[];
  private enzymeSet: EnzymeSet | null = null;

  constructor(size: number, createWorker: (() => Worker) | null = poolWorkerFactory) {
    this.clients = Array.from({ length: size }, () => new AnalysisClient(createWorker));
  }

  /**
   * The imported enzyme set, for the workers to scan with. Applied to every
   * client, whose workers each keep their own copy.
   */
  useEnzymes(set: EnzymeSet | null): void {
    this.enzymeSet = set;
    for (const c of this.clients) c.useEnzymes(set);
  }

  /** Stops the workers; the next request starts them again, with the enzyme set. */
  release(): void {
    for (const c of this.clients) c.dispose();
  }

  get enzymes(): EnzymeSet | null {
    return this.enzymeSet;
  }
}

function poolWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') throw new Error('Workers unavailable');
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * The pool batch runs use. Without workers (tests, old runtimes) it is one
 * client running on the calling thread, so there is nothing to spread.
 */
export const batchPool = new AnalysisPool(
  typeof Worker === 'undefined'
    ? 1
    : poolSize((globalThis.navigator as Navigator | undefined)?.hardwareConcurrency),
  typeof Worker === 'undefined' ? null : poolWorkerFactory,
);

/**
 * The clients a batch run takes its lanes from: the pool's, or where there
 * are no workers the page's own client, which runs on this thread whatever
 * is asked of it, so a second one would only be a second queue.
 */
export function batchLanes(): readonly AnalysisClient[] {
  return typeof Worker === 'undefined' ? [analysisClient] : batchPool.clients;
}
