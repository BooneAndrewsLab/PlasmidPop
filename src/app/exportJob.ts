/**
 * What a long export shares, whatever it writes (#247, #248, item 94): how
 * it reports progress, how it is stopped, and how a loop over pages gives
 * the browser its turns. The dialog shows the progress and owns the stop;
 * the PNG, ZIP and PDF paths all take an `ExportJobOptions`.
 */

/** Drawing is rasterising or laying pages out on the main thread; writing is the file being assembled. */
export type ExportStage = 'drawing' | 'writing';

export interface ExportProgress {
  readonly stage: ExportStage;
  /** Pages done, of `total`; `done` reaches `total` when the stage is finished. */
  readonly done: number;
  readonly total: number;
}

export interface ExportJobOptions {
  /** Aborting it stops the work: nothing more is drawn or written, and nothing is downloaded. */
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((progress: ExportProgress) => void) | undefined;
}

/** The rejection of an export its signal stopped. */
export class ExportCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'ExportCancelledError';
  }
}

export const isCancelled = (e: unknown): boolean => e instanceof ExportCancelledError;

/** Throws the cancellation when the signal has been aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new ExportCancelledError();
}

/**
 * How long a stretch of pages may run before the browser is given a turn:
 * a yield costs about as much as one vector page (#246), so it is not
 * taken after every page.
 */
export const YIELD_AFTER_MS = 100;

/** Lets the browser paint and handle input before the next page. */
export const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Runs `step` over `items` in turn, as one stage of an export: progress is
 * reported before the first and after each item, the signal is looked at
 * between items, and the browser gets a turn after any stretch that took
 * over `YIELD_AFTER_MS`. The steps run one at a time, so one page's canvas
 * is all the memory a page costs.
 */
export async function eachPage<T, R>(
  items: readonly T[],
  stage: ExportStage,
  options: ExportJobOptions,
  step: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const { signal, onProgress } = options;
  const total = items.length;
  throwIfCancelled(signal);
  onProgress?.({ stage, done: 0, total });
  const results: R[] = [];
  let lastYield = performance.now();
  for (const [i, item] of items.entries()) {
    results.push(await step(item, i));
    onProgress?.({ stage, done: i + 1, total });
    // Looked at after the report, so a stop asked for while the page was
    // drawn (or in answer to the report) starts no further page.
    throwIfCancelled(signal);
    if (i + 1 < total && performance.now() - lastYield > YIELD_AFTER_MS) {
      await yieldToBrowser();
      throwIfCancelled(signal);
      lastYield = performance.now();
    }
  }
  return results;
}
