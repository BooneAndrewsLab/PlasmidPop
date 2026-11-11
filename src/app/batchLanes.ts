import { AnalysisCancelledError } from '@/workers/analysisClient';

export interface LaneHooks<R> {
  /** Told each row as it is done, in the rows' order. */
  readonly onRow?: (row: R) => void;
  /** Told the fraction of the whole batch done. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

export interface LaneOutcome<R> {
  /** The rows done before a cancel, or all of them: always a prefix, in the rows' order. */
  readonly rows: readonly R[];
  readonly cancelled: boolean;
}

/**
 * Runs `count` rows over `lanes` at once (#423), a lane being one worker. A
 * free lane takes the next row, so the rows start in order; the results are
 * handed to `onRow` in order whichever finishes first, and progress is the
 * mean of the rows' own. `task` gives a row's result and turns a failure into
 * a failed row itself; only an `AnalysisCancelledError` it lets through (or an
 * aborted signal) stops the run. A cancel keeps the rows done in order before
 * the first one that was cut short, as the serial run did. With one lane this
 * is that serial run.
 */
export async function runInLanes<R>(
  count: number,
  lanes: number,
  task: (index: number, lane: number, onProgress: (fraction: number) => void) => Promise<R>,
  { onRow, onProgress, signal }: LaneHooks<R> = {},
): Promise<LaneOutcome<R>> {
  const results: (R | undefined)[] = new Array<R | undefined>(count).fill(undefined);
  const fractions: number[] = new Array<number>(count).fill(0);
  const done: R[] = [];
  let next = 0;
  let cancelled = false;

  const flush = (): void => {
    for (let r = results[done.length]; r !== undefined; r = results[done.length]) {
      done.push(r);
      onRow?.(r);
    }
  };
  const report = (): void => {
    onProgress?.(fractions.reduce((a, b) => a + b, 0) / count);
  };

  const lane = async (laneIndex: number): Promise<void> => {
    while (!cancelled) {
      const index = next++;
      if (index >= count) return;
      if (signal?.aborted === true) {
        cancelled = true;
        return;
      }
      let result: R;
      try {
        result = await task(index, laneIndex, (f) => {
          fractions[index] = f;
          report();
        });
      } catch (e: unknown) {
        if (e instanceof AnalysisCancelledError) {
          cancelled = true;
          return;
        }
        throw e;
      }
      results[index] = result;
      fractions[index] = 1;
      flush();
      report();
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, lanes) }, (_, i) => lane(i)));
  return { rows: done, cancelled };
}
