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
 * `it` for a test whose point is how long something takes. Under a mutation
 * run it is skipped outright: instrumented code can take longer than any
 * timeout before the budget is even reached, and a speed test says nothing
 * about whether a mutant is caught.
 */
export function itTimed(name: string, fn: () => void, timeout?: number): void {
  if (TIMING_ASSERTED) it(name, fn, timeout);
  else it.skip(name, fn, timeout);
}
