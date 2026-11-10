import { expect } from 'vitest';

/**
 * Fails when a `NaN` is anywhere in `value`, an object or an array (#434):
 * what a position folded onto a sequence of no length comes out as, which
 * must reach no range, segment or drawn coordinate. `JSON.stringify` would
 * write it as `null` and hide it, so it is spelt out first.
 */
export function expectNoNaN(value: object): void {
  const text = JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'number' && Number.isNaN(v) ? '<NaN>' : v,
  );
  expect(text).not.toContain('<NaN>');
}
