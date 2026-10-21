/**
 * The page's default number format, made once. `n.toLocaleString()` is the
 * same formatter made afresh on every call, which in Chromium is 14 µs a
 * call against 0.7 µs here (docs/perf-notes.md, #271): an enzyme list of a
 * few dozen rows with a dozen positions each was paying 25 ms a render for
 * its thousands separators.
 */
const integers = new Intl.NumberFormat();

/** `1,234`: an integer with the locale's grouping, as `toLocaleString()` gives it. */
export function formatInt(n: number): string {
  return integers.format(n);
}
