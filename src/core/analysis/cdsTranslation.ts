import { type SeqDocument } from '../document';
import {
  type Feature,
  type FeatureId,
  type FeatureLocation,
  type Strand,
  firstQualifier,
  parseLocatedValue,
  qualifierValues,
} from '../features';
import { type Range, range, rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import {
  DEFAULT_TABLE,
  STOP,
  type TranslationTable,
  UNKNOWN_AA,
  isStartCodon,
  isTranslationTable,
  translateCodon,
} from './codons';

/** One codon of a coding feature, placed on the forward strand. */
export interface Codon {
  /** Codon number in the protein, 0-based. */
  readonly index: number;
  /**
   * Forward-strand positions (`0 <= p < length`) of the three bases in
   * reading order. Ascending for forward-strand features, descending for
   * reverse-strand ones; not necessarily contiguous across a join or the
   * origin of a circular sequence.
   */
  readonly positions: readonly [number, number, number];
  /** One-letter amino acid, `*` for a stop, `X` when it cannot be determined. */
  readonly aminoAcid: string;
}

export interface CdsTranslation {
  readonly codons: readonly Codon[];
  /** Strand the feature is read from; the codons' positions descend when reverse. */
  readonly strand: Strand;
  /** The codons' amino acids concatenated (stops included as `*`). */
  readonly protein: string;
  /** The genetic code it was read with. */
  readonly table: TranslationTable;
  /**
   * The `/transl_table` value when it names no genetic code we have — NCBI
   * withdrew 7, 8 and 17–20 — and null otherwise. Such a feature is read
   * with the standard code, which is a guess, so it is said rather than
   * silently done.
   */
  readonly unknownTable: string | null;
  /** Reading frame offset from `/codon_start` (1, 2 or 3). */
  readonly codonStart: 1 | 2 | 3;
  /**
   * `/transl_except` values that could not be applied, verbatim: not in the
   * `(pos:…,aa:…)` form, naming an amino acid we do not know, or not on a
   * codon of this feature. The codon they meant is read with the genetic
   * code, which may be the very thing the exception was there to overrule.
   */
  readonly unusedExceptions: readonly string[];
}

/** Features whose translation is shown under the sequence. */
export function isCodingFeature(feature: Feature): boolean {
  return feature.type === 'CDS' && feature.segments.some((s) => s.kind === 'range');
}

function codonStartOf(feature: Feature): 1 | 2 | 3 {
  const value = firstQualifier(feature, 'codon_start');
  return value === '2' ? 2 : value === '3' ? 3 : 1;
}

/** The genetic code named by `/transl_table`, and what it said if we have no such code. */
function tableOf(feature: Feature): { table: TranslationTable; unknownTable: string | null } {
  const raw = firstQualifier(feature, 'transl_table')?.trim();
  if (raw === undefined || raw === '') return { table: DEFAULT_TABLE, unknownTable: null };
  const id = Number.parseInt(raw, 10);
  if (isTranslationTable(id)) return { table: id, unknownTable: null };
  return { table: DEFAULT_TABLE, unknownTable: raw };
}

/**
 * INSDC's three-letter amino acid abbreviations (Feature Table, appendix
 * "Amino acid abbreviations"), with `TERM` for a stop and `OTHER` for
 * anything else, as `/transl_except` writes them.
 */
const AMINO_ACIDS: Readonly<Record<string, string>> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  ASX: 'B',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLX: 'Z',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  XLE: 'J',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  PYL: 'O',
  SEC: 'U',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
  XAA: UNKNOWN_AA,
  OTHER: UNKNOWN_AA,
  TERM: STOP,
};

/** The one-letter residue a `/transl_except`'s `aa:` names, or null. */
function exceptionResidue(rest: string): string | null {
  const m = /^aa:([A-Za-z]+)$/.exec(rest);
  return m === null ? null : (AMINO_ACIDS[(m[1] ?? '').toUpperCase()] ?? null);
}

/** A location's forward-strand positions in reading order. */
function readingPositions(location: FeatureLocation, length: number): number[] {
  const positions: number[] = [];
  for (const seg of location.segments) {
    if (seg.kind !== 'range') continue;
    for (const piece of rangePieces(seg, length)) {
      for (let p = piece.start; p < piece.end; p++) positions.push(p);
    }
  }
  if (location.strand === 'reverse') positions.reverse();
  return positions;
}

/**
 * Applies the feature's `/transl_except` qualifiers to its codons, in place,
 * and returns the values that could not be. An exception names the three
 * bases of one codon, in the record's coordinates, and the residue to read
 * there: selenocysteine at a UGA, most often. One of fewer than three bases
 * saying `TERM` completes a stop codon past the annotated bases (the
 * poly(A) tail finishes it in the mRNA); there is no codon of ours for it to
 * change, which is right, since the terminal stop is not a residue.
 */
function applyExceptions(doc: SeqDocument, feature: Feature, codons: Codon[]): string[] {
  const values = qualifierValues(feature, 'transl_except');
  if (values.length === 0) return [];
  const byFirstBase = new Map<number, number>();
  for (const [i, codon] of codons.entries()) byFirstBase.set(codon.positions[0], i);
  const unused: string[] = [];
  for (const value of values) {
    const parsed = parseLocatedValue(value, doc);
    const residue = parsed === null ? null : exceptionResidue(parsed.rest);
    if (parsed === null || residue === null) {
      unused.push(value);
      continue;
    }
    const bases = readingPositions(parsed.location, doc.length);
    if (bases.length < 3 && residue === STOP) continue;
    const i = bases.length === 3 ? byFirstBase.get(bases[0] ?? -1) : undefined;
    const codon = i === undefined ? undefined : codons[i];
    if (
      i === undefined ||
      codon === undefined ||
      codon.positions[1] !== bases[1] ||
      codon.positions[2] !== bases[2]
    ) {
      unused.push(value);
      continue;
    }
    codons[i] = { ...codon, aminoAcid: residue };
  }
  return unused;
}

/** Whether the biological 5' end of the feature is marked partial (`<` or `>` in GenBank). */
function fivePrimePartial(feature: Feature): boolean {
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  if (feature.strand === 'reverse') return ranges[ranges.length - 1]?.partialEnd ?? false;
  return ranges[0]?.partialStart ?? false;
}

/**
 * Conceptual translation of a coding feature, codon by codon, computed from
 * the current sequence rather than a stored `/translation`. Range segments
 * are read in order (reverse-complemented for reverse-strand features),
 * `/codon_start` skips leading bases, and the first full codon is shown as
 * `M` when it is a start codon of the feature's `/transl_table` and the 5'
 * end is not partial. Trailing bases that do not fill a codon are dropped.
 *
 * Every NCBI genetic code is understood; a `/transl_table` that names none of
 * them falls back to the standard code and says so in `unknownTable`.
 * `/transl_except` overrules the code at the codons it names, the start
 * codon included.
 */
export function translateCds(doc: SeqDocument, feature: Feature): CdsTranslation {
  const length = doc.length;
  const positions: number[] = [];
  let text = '';
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') continue;
    for (const piece of rangePieces(seg, length)) {
      text += doc.sequence.slice(piece.start, piece.end);
      for (let p = piece.start; p < piece.end; p++) positions.push(p);
    }
  }
  if (feature.strand === 'reverse') {
    text = reverseComplement(text);
    positions.reverse();
  }

  const codonStart = codonStartOf(feature);
  const { table, unknownTable } = tableOf(feature);
  const partial = fivePrimePartial(feature);
  const codons: Codon[] = [];
  let index = 0;
  for (let i = codonStart - 1; i + 3 <= text.length; i += 3, index++) {
    const codon = text.slice(i, i + 3);
    let aminoAcid = translateCodon(codon, table);
    if (index === 0 && !partial && isStartCodon(codon, table)) aminoAcid = 'M';
    const a = positions[i];
    const b = positions[i + 1];
    const c = positions[i + 2];
    if (a === undefined || b === undefined || c === undefined) break;
    codons.push({ index, positions: [a, b, c], aminoAcid });
  }
  const unusedExceptions = applyExceptions(doc, feature, codons);
  const protein = codons.map((codon) => codon.aminoAcid).join('');
  return {
    codons,
    protein,
    strand: feature.strand,
    table,
    unknownTable,
    codonStart,
    unusedExceptions,
  };
}

/**
 * Lazily computed translations of one document's coding features. Build a
 * new instance per document version: features keep their identity across
 * edits elsewhere in the sequence, so a per-feature cache must not outlive
 * the sequence it was computed from.
 */
export class CdsTranslations {
  private readonly cache = new Map<FeatureId, CdsTranslation>();

  constructor(readonly doc: SeqDocument) {}

  get(feature: Feature): CdsTranslation {
    let t = this.cache.get(feature.id);
    if (t === undefined) {
      t = translateCds(this.doc, feature);
      this.cache.set(feature.id, t);
    }
    return t;
  }
}

/**
 * Index of the codon holding forward-strand position `position`, or -1 when
 * no codon does: the position may be in an intron of a `join(...)`, in the
 * bases `/codon_start` skips, or in a trailing part-codon.
 */
export function codonIndexAt(t: CdsTranslation, position: number): number {
  return t.codons.findIndex((codon) => codon.positions.includes(position));
}

/**
 * Forward-strand range covering codons `from` through `to` (given in either
 * order), or `null` if either index is out of range. The span runs from the
 * first base of the earlier codon in reading order to the last base of the
 * later one, so it is mirrored for a reverse-strand feature, wraps the origin
 * when the codons do, and covers the intervening bases when the codons sit on
 * either side of a `join(...)` boundary.
 */
export function codonSpan(
  t: CdsTranslation,
  from: number,
  to: number,
  seqLength: number,
): Range | null {
  const first = t.codons[Math.min(from, to)];
  const last = t.codons[Math.max(from, to)];
  if (first === undefined || last === undefined) return null;
  const start = t.strand === 'reverse' ? last.positions[2] : first.positions[0];
  const lastBase = t.strand === 'reverse' ? first.positions[0] : last.positions[2];
  let span = lastBase + 1 - start;
  if (span <= 0) span += seqLength; // the span crosses the origin
  return range(start, start + span);
}
