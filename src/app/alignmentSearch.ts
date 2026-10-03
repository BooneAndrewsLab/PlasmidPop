import { findSequenceMatches, looksLikeSequence } from '@/core';

import type { Stack } from './alignmentStack';

/**
 * Go to a position and find a motif in the stacked alignment's large view
 * (#125). Both answer in columns, which is what the view scrolls and marks;
 * the reference row's gaps (another sample's insertion) are why a position is
 * not a column.
 */

/** Fewest bases a motif may have, as the editor's Find takes a query as a sequence from three. */
export const MIN_MOTIF = 3;

export type PositionResult =
  | { readonly kind: 'column'; readonly column: number }
  | { readonly kind: 'invalid' }
  /** Beyond the end of a circular document, or of the reference when it is not a circle. */
  | { readonly kind: 'past-end'; readonly last: number }
  /** In the document but not in the stretch the alignment covers. */
  | { readonly kind: 'outside'; readonly first: number; readonly last: number };

/**
 * The column of a 1-based position along the reference's numbering, the
 * inverse of `columnPosition`. On a circle a position the aligned reference
 * reaches twice (a read that runs through the origin repeats the start) goes
 * to the first.
 */
export function columnOfPosition(stack: Stack, position: number): PositionResult {
  if (!Number.isInteger(position) || position < 1) return { kind: 'invalid' };
  let bases = 0;
  const column = new Map<number, number>();
  stack.refIndex.forEach((i, c) => {
    if (i < 0) return;
    column.set(i, c);
    if (i + 1 > bases) bases = i + 1;
  });
  if (bases === 0) return { kind: 'invalid' };
  if (stack.wrap !== null) {
    if (position > stack.wrap) return { kind: 'past-end', last: stack.wrap };
    const i = (((position - 1 - stack.offset) % stack.wrap) + stack.wrap) % stack.wrap;
    const c = column.get(i) ?? column.get(i + stack.wrap);
    if (c !== undefined) return { kind: 'column', column: c };
    return { kind: 'outside', first: stack.offset + 1, last: stack.offset + bases };
  }
  const first = stack.offset + 1;
  const last = stack.offset + bases;
  if (position > last) return { kind: 'past-end', last };
  const c = column.get(position - 1 - stack.offset);
  return c === undefined ? { kind: 'outside', first, last } : { kind: 'column', column: c };
}

/** What to tell the user when a position has no column. */
export function positionMessage(result: PositionResult): string {
  switch (result.kind) {
    case 'column':
      return '';
    case 'invalid':
      return 'Enter a position, a whole number from 1.';
    case 'past-end':
      return `Past the end: the last position is ${result.last.toLocaleString()}.`;
    case 'outside':
      return `Not in the aligned stretch, which is positions ${result.first.toLocaleString()} to ${result.last.toLocaleString()}.`;
  }
}

export interface MotifMatch {
  /** Columns `[start, end)` from the match's first base to its last. */
  readonly start: number;
  readonly end: number;
  readonly strand: 'forward' | 'reverse';
}

export type MotifSearch =
  | { readonly kind: 'matches'; readonly matches: readonly MotifMatch[] }
  | { readonly kind: 'empty' }
  | { readonly kind: 'short' }
  | { readonly kind: 'invalid' };

/** The query as the editor's Find reads one: no spaces, upper case. */
export function cleanMotif(query: string): string {
  return query.replace(/\s+/g, '').toUpperCase();
}

/**
 * Where an IUPAC motif is in one row, on both strands, as columns. The
 * search is on the row's own bases with the gap columns taken out, so a
 * motif is found across a deletion (and, in the reference, across another
 * sample's insertion), and its columns include the gaps it spans. `row` is
 * an index into `stack.rows`, or null for the reference. A match through a
 * circle's origin is found only when the reference runs on past it, as it
 * does when a sample reads through.
 */
export function findMotif(stack: Stack, row: number | null, query: string): MotifSearch {
  const motif = cleanMotif(query);
  if (motif === '') return { kind: 'empty' };
  if (!looksLikeSequence(motif)) return { kind: 'invalid' };
  if (motif.length < MIN_MOTIF) return { kind: 'short' };
  const chars = row === null ? stack.reference : (stack.rows[row]?.bases ?? '');
  const columns: number[] = [];
  let bases = '';
  for (let c = 0; c < chars.length; c++) {
    const ch = chars.charAt(c);
    if (ch === '-' || ch === ' ') continue;
    columns.push(c);
    bases += ch;
  }
  const matches: MotifMatch[] = [];
  const seen = new Set<string>();
  for (const m of findSequenceMatches(bases, 'linear', motif)) {
    const start = columns[m.range.start];
    const last = columns[m.range.end - 1];
    if (start === undefined || last === undefined) continue;
    // A read through the origin repeats the reference's start: the same bases twice.
    const at = stack.wrap !== null && row === null ? m.range.start % stack.wrap : m.range.start;
    const key = `${at}${m.strand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ start, end: last + 1, strand: m.strand });
  }
  return { kind: 'matches', matches };
}

/**
 * The match to step to from `column` (a match starting after it, or before
 * it going back, wrapping round); its index, or null when there are none.
 * A match starting at the column itself is not stepped to, as with
 * `nextDifference`, so Next from a found match goes on.
 */
export function stepMatch(
  matches: readonly MotifMatch[],
  column: number,
  backwards: boolean,
): number | null {
  if (matches.length === 0) return null;
  if (!backwards) {
    const i = matches.findIndex((m) => m.start > column);
    return i < 0 ? 0 : i;
  }
  for (let i = matches.length - 1; i >= 0; i--) if ((matches[i]?.start ?? 0) < column) return i;
  return matches.length - 1;
}

/** The first match at or after `column`, wrapping round: where a new query lands. */
export function firstMatchFrom(matches: readonly MotifMatch[], column: number): number | null {
  if (matches.length === 0) return null;
  const i = matches.findIndex((m) => m.start >= column);
  return i < 0 ? 0 : i;
}
