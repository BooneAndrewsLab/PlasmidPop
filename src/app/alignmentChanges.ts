import { complement } from '@/core';

import {
  Change,
  codonSpan,
  residueOf,
  type CodonColumns,
  type Residue,
  type ResidueFrame,
} from './alignmentResidues';
import type { Stack } from './alignmentStack';

/**
 * Residue numbers and the changes a sample makes, as the stacked alignment
 * names them (#261): one short notation (`R240S`, `E244*`, `*250K`) for the
 * view's tags and hover and the Differences table, the ticks of the
 * reference's protein ruler, which of the tags fit, and what a pointer over a
 * residue says. All of it is plain data, so the drawing only paints it.
 */

/** A residue as the reference has it with its number in the CDS: `R240`. */
export function residueLabel(codon: CodonColumns): string {
  return `${codon.reference}${codon.index + 1}`;
}

/**
 * The name of a change of residue, `R240S`, `E244*` or `*250K`; null when the
 * residue is the same, silent, or not a clean substitution (an indel in the
 * codon is marked, not named).
 */
export function residueChangeText(codon: CodonColumns, residue: Residue): string | null {
  const label = residueLabel(codon);
  if (residue.change === Change.Nonsense) return `${label}*`;
  if (residue.change === Change.Missense || residue.change === Change.StopLost)
    return `${label}${residue.letter}`;
  return null;
}

/** One sample's named change of one codon. */
export interface ResidueChange {
  readonly frame: ResidueFrame;
  readonly codon: CodonColumns;
  readonly residue: Residue;
  readonly text: string;
  /** The columns the codon spans, `[start, end)`. */
  readonly start: number;
  readonly end: number;
}

/** Every named change a sample makes in `frames`, in no particular order across frames. */
export function sampleChanges(
  frames: readonly ResidueFrame[],
  row: Stack['rows'][number],
): ResidueChange[] {
  const out: ResidueChange[] = [];
  for (const frame of frames) {
    for (const codon of frame.codons) {
      const residue = residueOf(frame, codon, row);
      const text = residueChangeText(codon, residue);
      if (text === null) continue;
      const { start, end } = codonSpan(codon);
      out.push({ frame, codon, residue, text, start, end });
    }
  }
  return out;
}

/** A residue number on the protein ruler, over the codon's columns. */
export interface RulerTick {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

/**
 * The ruler's numbers for a frame: the residue number at every `every`th
 * codon, counted from the CDS's first codon. A reverse-strand frame's codons
 * run right to left, so its numbers do too.
 */
export function rulerTicks(frame: ResidueFrame, every = 10): RulerTick[] {
  const ticks: RulerTick[] = [];
  for (const codon of frame.codons) {
    const n = codon.index + 1;
    if (n % every !== 0) continue;
    const { start, end } = codonSpan(codon);
    ticks.push({ number: n, start, end });
  }
  return ticks;
}

/** How a tag is drawn in the place-or-drop pass: its centre, text width and rank in pixels. */
export interface TagBox {
  readonly centre: number;
  readonly width: number;
  /** Lower is kept first. */
  readonly rank: number;
}

/** The rank a change is kept by: nonsense, then stop lost, then missense. */
export function tagRank(change: Residue['change']): number {
  if (change === Change.Nonsense) return 0;
  if (change === Change.StopLost) return 1;
  return 2;
}

/**
 * Which tags are drawn: candidates are taken by rank, then left to right, and
 * one is kept when it clears every kept one by `gap` pixels, else dropped (its
 * residue keeps its tint and the hover still names it). Returns a flag per box.
 */
export function placeTags(boxes: readonly TagBox[], gap: number): boolean[] {
  const kept = boxes.map(() => false);
  const order = boxes
    .map((box, i) => ({ box, i }))
    .sort((p, q) => p.box.rank - q.box.rank || p.box.centre - q.box.centre || p.i - q.i);
  const placed: TagBox[] = [];
  for (const { box, i } of order) {
    const clear = placed.every(
      (other) => Math.abs(other.centre - box.centre) >= (other.width + box.width) / 2 + gap,
    );
    if (!clear) continue;
    placed.push(box);
    kept[i] = true;
  }
  return kept;
}

/** The frame and codon whose columns hold `column`, null outside every CDS. */
export function codonAtColumn(
  frames: readonly ResidueFrame[],
  column: number,
): { frame: ResidueFrame; codon: CodonColumns } | null {
  for (const frame of frames) {
    if (column < frame.start || column >= frame.end) continue;
    for (const codon of frame.codons) {
      const { start, end } = codonSpan(codon);
      if (column >= start && column < end) return { frame, codon };
    }
  }
  return null;
}

/** A codon's three bases in reading order, read from `bases` (complemented on the reverse strand). */
function codonBases(frame: ResidueFrame, codon: CodonColumns, bases: string): string {
  return codon.columns
    .map((c) => {
      const ch = bases.charAt(c);
      return frame.strand === 'reverse' ? complement(ch) : ch;
    })
    .join('');
}

/**
 * What the pointer says over the residue at `column`: `R240 · bla` over the
 * reference's or an unchanged one, `R240S · CGT→AGT · bla` over a sample's
 * changed one. `row` is the sample's index in the stack, null for the
 * reference. Null outside a CDS, or where the sample does not cover the codon.
 */
export function residueTitle(
  frames: readonly ResidueFrame[],
  stack: Stack,
  row: number | null,
  column: number,
): string | null {
  const hit = codonAtColumn(frames, column);
  if (hit === null) return null;
  const { frame, codon } = hit;
  const sample = row === null ? undefined : stack.rows[row];
  if (row !== null && sample === undefined) return null;
  if (sample === undefined) return `${residueLabel(codon)} · ${frame.name}`;
  const residue = residueOf(frame, codon, sample);
  if (residue.change === Change.Blank) return null;
  const text = residueChangeText(codon, residue);
  if (text === null) return `${residueLabel(codon)} · ${frame.name}`;
  const was = codonBases(frame, codon, stack.reference);
  const now = codonBases(frame, codon, sample.bases);
  return `${text} · ${was}→${now} · ${frame.name}`;
}
