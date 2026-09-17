/**
 * Immutable text storage for the sequence. Every mutator returns a new value
 * and leaves the receiver untouched, so old document versions stay valid for
 * undo without copying the whole sequence.
 */
export interface SequenceText {
  readonly length: number;
  /** Character at `index`, or '' when out of range. */
  charAt(index: number): string;
  /** Substring `[start, end)`; `end` defaults to `length`. Clamped like String#slice for in-range args. */
  slice(start: number, end?: number): string;
  insert(position: number, text: string): SequenceText;
  remove(start: number, end: number): SequenceText;
  toString(): string;
}
