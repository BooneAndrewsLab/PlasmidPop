import { expect, it } from 'vitest';

/**
 * Whether timing budgets are asserted. Under a mutation run (`npm run
 * mutate`, which sets PLASMIDPOP_MUTATION=1) Stryker instruments the code and
 * it runs many times slower, so a budget measured there means nothing and
 * would fail the run before it starts. Everywhere else — locally and in CI —
 * the budget holds.
 */
export const TIMING_ASSERTED = process.env['PLASMIDPOP_MUTATION'] !== '1';

/** `expect(ms).toBeLessThan(budget)`, except under a mutation run. */
export function expectWithin(ms: number, budget: number): void {
  if (TIMING_ASSERTED) expect(ms).toBeLessThan(budget);
}

/**
 * The median wall-clock time of `fn` over `runs` calls, in ms. A budget on a
 * mean lets one run that a busy CI runner stalled fail the test (#148); the
 * median ignores it, while a real slowdown moves every run and so the median
 * with it.
 */
export function medianMs(runs: number, fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mid = times.length >> 1;
  const at = (i: number): number => times[i] ?? 0;
  return times.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
}

/**
 * `it` for a test whose point is how long something takes. Under a mutation
 * run it is skipped outright: instrumented code can take longer than any
 * timeout before the budget is even reached, and a speed test says nothing
 * about whether a mutant is caught.
 */
export function itTimed(name: string, fn: () => void | Promise<void>, timeout?: number): void {
  if (TIMING_ASSERTED) it(name, fn, timeout);
  else it.skip(name, fn, timeout);
}
