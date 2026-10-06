import type { SeqDocument } from '@/core';

import { type ResidueFrame, Change, residueOf } from './alignmentResidues';
import {
  Cell,
  columnPosition,
  type DifferenceRegion,
  isDifference,
  type Stack,
  type StackRow,
} from './alignmentStack';
import { ColumnClass, columnsOfIndex, spansOf, type TrackAnnotation } from './alignmentTrack';

/**
 * The alignment's differences as a table (#121): one row per difference
 * region, with where it is in the document, what changed, which samples
 * carry it, what it falls in, how good the read was and, inside a CDS, what
 * it does to the protein. Everything is read off the stack's columns and the
 * codon frames the Amino acids option already builds.
 *
 * Positions are 1-based, as numbered on screen (and as GenBank writes
 * them); columns are 0-based. On a circular document a position is taken
 * modulo its length, so a read through the origin counts on from 1 again.
 */

/** What a difference does to a CDS's protein, for one sample. */
export interface ProteinEffect {
  readonly kind: 'silent' | 'missense' | 'nonsense' | 'stop-lost' | 'frameshift' | 'in-frame';
  /** "silent", "p.K42R", "p.K42*", "p.*42K", "frameshift" or "in-frame indel". */
  readonly text: string;
}

export interface DifferenceCarrier {
  /** Index into the stack's rows. */
  readonly row: number;
  readonly name: string;
  /** The sample's bases over the region, gaps left out; '-' when it has none. */
  readonly bases: string;
  /** The lowest read quality over the sample's differing columns, null without qualities. */
  readonly quality: number | null;
  /** Null outside a CDS. */
  readonly effect: ProteinEffect | null;
}

export type FeatureKind = 'cds' | 'feature' | 'none';

export interface DifferenceRow {
  /** Index into the difference regions. */
  readonly index: number;
  /** Columns `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /** First and last reference base touched, 1-based; an insertion is put after the base before it. Null when the reference is not in the region at all. */
  readonly position: number | null;
  readonly endPosition: number | null;
  /** The reference's bases over the region, gaps left out; '-' when none. */
  readonly reference: string;
  readonly carriers: readonly DifferenceCarrier[];
  readonly featureKind: FeatureKind;
  /** Two or more samples at good quality carry different bases in a column of the region (#124). */
  readonly disagree: boolean;
  /** The names of the annotations of the highest class the region touches. */
  readonly feature: string;
}

function columnsOf(region: DifferenceRegion): number[] {
  return Array.from({ length: region.end - region.start }, (_, i) => region.start + i);
}

/** Bases with gaps and blanks dropped, '-' when nothing is left. */
function basesOf(text: string): string {
  const bases = text.replace(/[- ]/g, '');
  return bases === '' ? '-' : bases;
}

function sliceOf(text: string, start: number, end: number): string {
  return text.slice(start, end);
}

/** A long run of bases cut to its ends and its length, for a cell. */
export function abbreviateBases(bases: string, keep = 8): string {
  if (bases.length <= keep * 2 + 4) return bases;
  return `${bases.slice(0, keep)}…${bases.slice(-keep)} (${bases.length.toLocaleString()})`;
}

/** The lowest finite quality of `row` over `columns`, null when there is none. */
function lowestQuality(qualities: Float32Array | null, columns: readonly number[]): number | null {
  if (qualities === null) return null;
  let lowest: number | null = null;
  for (const c of columns) {
    const q = qualities[c];
    if (q === undefined || Number.isNaN(q)) continue;
    if (lowest === null || q < lowest) lowest = q;
  }
  return lowest;
}

/** The effect of one sample's cells in `[start, end)` on one frame, null if the region is outside it. */
function effectOnFrame(
  frame: ResidueFrame,
  stack: Stack,
  rowIndex: number,
  start: number,
  end: number,
): ProteinEffect | null {
  const row = stack.rows[rowIndex];
  if (row === undefined || end <= frame.start || start >= frame.end) return null;
  let inserted = 0;
  let deleted = 0;
  for (let c = start; c < end; c++) {
    const cell = row.cells[c];
    if (cell === Cell.Insertion) inserted++;
    else if (cell === Cell.Deletion) deleted++;
  }
  if (inserted + deleted > 0) {
    return (inserted - deleted) % 3 === 0
      ? { kind: 'in-frame', text: 'in-frame indel' }
      : { kind: 'frameshift', text: 'frameshift' };
  }
  const notes: ProteinEffect[] = [];
  let silent = false;
  for (const codon of frame.codons) {
    const first = Math.min(...codon.columns);
    const last = Math.max(...codon.columns);
    if (last < start || first >= end) continue;
    const residue = residueOf(frame, codon, row);
    const n = codon.index + 1;
    if (residue.change === Change.Synonymous) silent = true;
    else if (residue.change === Change.Missense)
      notes.push({ kind: 'missense', text: `p.${codon.reference}${n}${residue.letter}` });
    else if (residue.change === Change.Nonsense)
      notes.push({ kind: 'nonsense', text: `p.${codon.reference}${n}*` });
    else if (residue.change === Change.StopLost)
      notes.push({ kind: 'stop-lost', text: `p.*${n}${residue.letter}` });
  }
  const worst = notes.find((n) => n.kind === 'nonsense') ?? notes[0];
  if (worst === undefined) return silent ? { kind: 'silent', text: 'silent' } : null;
  return { kind: worst.kind, text: notes.map((n) => n.text).join(', ') };
}

/** The sample's effect over all the frames the region touches; a frame is named only when there are several. */
function effectOf(
  frames: readonly ResidueFrame[],
  stack: Stack,
  rowIndex: number,
  region: DifferenceRegion,
): ProteinEffect | null {
  const found = frames.flatMap((frame) => {
    const effect = effectOnFrame(frame, stack, rowIndex, region.start, region.end);
    return effect === null ? [] : [{ frame, effect }];
  });
  const first = found[0];
  if (first === undefined) return null;
  if (found.length === 1) return first.effect;
  const texts = [...new Set(found.map((f) => `${f.frame.name}: ${f.effect.text}`))];
  const severe = found.find((f) => f.effect.kind !== 'silent') ?? first;
  return { kind: severe.effect.kind, text: texts.join('; ') };
}

/** The region's copy across a circle's origin where `row` differs, or null. */
function twinRegion(
  stack: Stack,
  row: StackRow,
  region: DifferenceRegion,
): DifferenceRegion | null {
  const columns = columnsOf(region)
    .map((c) => stack.twin[c] ?? -1)
    .filter((t) => t >= 0 && isDifference(row.cells[t] ?? 0));
  if (columns.length === 0) return null;
  return { start: Math.min(...columns), end: Math.max(...columns) + 1 };
}

/** Position of the region's first and last reference base. */
function positionsOf(
  stack: Stack,
  region: DifferenceRegion,
): { position: number | null; endPosition: number | null } {
  let position: number | null = null;
  let endPosition: number | null = null;
  for (let c = region.start; c < region.end; c++) {
    const p = columnPosition(stack, c);
    if (p === null) continue;
    position ??= p;
    endPosition = p;
  }
  if (position !== null) return { position, endPosition };
  // Only inserted columns: put it after the base before, else before the one after.
  for (let c = region.start - 1; c >= 0; c--) {
    const p = columnPosition(stack, c);
    if (p !== null) return { position: p, endPosition: p };
  }
  for (let c = region.end; c < stack.columns; c++) {
    const p = columnPosition(stack, c);
    if (p !== null) return { position: p, endPosition: p };
  }
  return { position: null, endPosition: null };
}

/** The class of feature the region touches and the names at that class. */
function featureOf(
  stack: Stack,
  annotations: readonly TrackAnnotation[],
  period: number,
  region: DifferenceRegion,
): { kind: FeatureKind; name: string } {
  const columns = columnsOfIndex(stack);
  const hits = annotations.filter((a) =>
    spansOf(stack, columns, a.ranges, period).some(
      (s) => s.start < region.end && region.start < s.end,
    ),
  );
  const rank = (a: TrackAnnotation): number =>
    a.orf || a.type === 'CDS' ? ColumnClass.Cds : ColumnClass.Feature;
  const top = hits.reduce((m, a) => Math.max(m, rank(a)), 0);
  if (hits.length === 0) return { kind: 'none', name: '' };
  const named = hits.filter((a) => rank(a) === top);
  // A CDS before the ORFs that overlap it.
  const preferred = named.some((a) => !a.orf) ? named.filter((a) => !a.orf) : named;
  const name = [...new Set(preferred.map((a) => a.name))].join(', ');
  return { kind: top === ColumnClass.Cds ? 'cds' : 'feature', name };
}

/**
 * The rows of the table. `source` and `annotations` are the document and
 * its features and ORFs (as `annotationsOf` makes them); `frames` come from
 * `buildFrames`. Without a document there is no feature or effect.
 */
export function differenceRows(
  stack: Stack,
  regions: readonly DifferenceRegion[],
  annotations: readonly TrackAnnotation[],
  frames: readonly ResidueFrame[],
  source: SeqDocument | null,
  disagreeing: readonly number[] = [],
): DifferenceRow[] {
  const disagreeingSet = new Set(disagreeing);
  const period = source?.isCircular === true ? source.length : 0;
  return regions.map((region, index) => {
    const { position, endPosition } = positionsOf(stack, region);
    const carriers: DifferenceCarrier[] = [];
    stack.rows.forEach((row, r) => {
      // The columns this row differs in: the region's, or where the base's
      // copy across a circle's origin is, when that is where the row is.
      const own = columnsOf(region).filter((c) => isDifference(row.cells[c] ?? 0));
      const there = own.length > 0 ? null : twinRegion(stack, row, region);
      const where = there ?? region;
      const differing = there === null ? own : columnsOf(there);
      if (differing.length === 0) return;
      carriers.push({
        row: r,
        name: row.name,
        bases: basesOf(sliceOf(row.bases, where.start, where.end)),
        quality: lowestQuality(row.qualities, differing),
        effect: source === null ? null : effectOf(frames, stack, r, where),
      });
    });
    const { kind, name } =
      source === null
        ? { kind: 'none' as const, name: '' }
        : featureOf(stack, annotations, period, region);
    return {
      index,
      start: region.start,
      end: region.end,
      position,
      endPosition,
      reference: basesOf(sliceOf(stack.reference, region.start, region.end)),
      carriers,
      featureKind: kind,
      disagree: columnsOf(region).some((c) => disagreeingSet.has(c)),
      feature: name,
    };
  });
}

/** "42" or "42–45"; '' when the reference is not in the region. */
export function positionText(row: DifferenceRow): string {
  if (row.position === null) return '';
  const end = row.endPosition ?? row.position;
  return end === row.position ? `${row.position}` : `${row.position}–${end}`;
}

/** Each distinct "ref→sample" once, the samples that share it not repeated. */
export function changeText(row: DifferenceRow): string {
  const ref = abbreviateBases(row.reference);
  return [...new Set(row.carriers.map((c) => `${ref}→${abbreviateBases(c.bases)}`))].join(', ');
}

/** The samples carrying it, by name. */
export function samplesText(row: DifferenceRow): string {
  return row.carriers.map((c) => c.name).join(', ');
}

/** "CDS lacZ", "feature promoter", or "none"; ORF names already say so. */
export function featureText(row: DifferenceRow): string {
  if (row.featureKind === 'none') return 'none';
  if (row.featureKind === 'cds')
    return row.feature.startsWith('ORF') ? row.feature : `CDS ${row.feature}`;
  return row.feature;
}

/** "Q37", the lowest over the carriers; '' when no sample had qualities. */
export function qualityText(row: DifferenceRow): string {
  const values = row.carriers.flatMap((c) => (c.quality === null ? [] : [c.quality]));
  if (values.length === 0) return '';
  return `Q${Math.round(Math.min(...values))}`;
}

/** The protein effect: one text when every carrier agrees, else each named. '' outside a CDS. */
export function effectText(row: DifferenceRow): string {
  const effects = row.carriers.flatMap((c) => (c.effect === null ? [] : [{ c, e: c.effect }]));
  if (effects.length === 0) return '';
  const distinct = new Set(effects.map((x) => x.e.text));
  if (distinct.size === 1 && effects.length === row.carriers.length)
    return effects[0]?.e.text ?? '';
  return effects.map((x) => `${x.c.name}: ${x.e.text}`).join('; ');
}

/**
 * "samples disagree" when samples at good quality carry different bases in
 * the region, "samples agree" when two or more carry the same change and
 * none disagrees, else ''. Agreement is what makes a difference credible.
 * A difference marked in the large view (#123) adds "reviewed" or "taken".
 */
export function noteText(row: DifferenceRow, mark?: 'reviewed' | 'taken'): string {
  const changes = new Set(row.carriers.map((c) => c.bases));
  const note = row.disagree
    ? 'samples disagree'
    : row.carriers.length >= 2 && changes.size === 1
      ? 'samples agree'
      : '';
  const marked =
    mark === undefined ? '' : mark === 'taken' ? 'taken into the document' : 'reviewed';
  return [note, marked].filter((t) => t !== '').join('; ');
}

const HEADER = [
  'Position',
  'Change',
  'Samples',
  'Feature',
  'Quality',
  'Protein effect',
  'Note',
] as const;

/**
 * The table as tab-separated text with a header, for pasting into a notebook
 * or spreadsheet. `marks` are the large view's, by region index (#123).
 */
export function differencesTsv(
  rows: readonly DifferenceRow[],
  marks: ReadonlyMap<number, 'reviewed' | 'taken'> = new Map(),
): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ');
  const lines = rows.map((r) =>
    [
      positionText(r),
      changeText(r),
      samplesText(r),
      featureText(r),
      qualityText(r),
      effectText(r),
      noteText(r, marks.get(r.index)),
    ]
      .map(clean)
      .join('\t'),
  );
  return [HEADER.join('\t'), ...lines].join('\n');
}
