import { type SeqDocument } from '../document';
import { type Feature, type FeatureId, firstQualifier } from '../features';
import { rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import { type TranslationTable, isStartCodon, translateCodon } from './codons';

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
  /** The codons' amino acids concatenated (stops included as `*`). */
  readonly protein: string;
  readonly table: TranslationTable;
  /** Reading frame offset from `/codon_start` (1, 2 or 3). */
  readonly codonStart: 1 | 2 | 3;
}

/** Features whose translation is shown under the sequence. */
export function isCodingFeature(feature: Feature): boolean {
  return feature.type === 'CDS' && feature.segments.some((s) => s.kind === 'range');
}

function codonStartOf(feature: Feature): 1 | 2 | 3 {
  const value = firstQualifier(feature, 'codon_start');
  return value === '2' ? 2 : value === '3' ? 3 : 1;
}

function tableOf(feature: Feature): TranslationTable {
  return firstQualifier(feature, 'transl_table')?.trim() === '11' ? 11 : 1;
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
  const table = tableOf(feature);
  const partial = fivePrimePartial(feature);
  const codons: Codon[] = [];
  let protein = '';
  let index = 0;
  for (let i = codonStart - 1; i + 3 <= text.length; i += 3, index++) {
    const codon = text.slice(i, i + 3);
    let aminoAcid = translateCodon(codon);
    if (index === 0 && !partial && isStartCodon(codon, table)) aminoAcid = 'M';
    const a = positions[i];
    const b = positions[i + 1];
    const c = positions[i + 2];
    if (a === undefined || b === undefined || c === undefined) break;
    codons.push({ index, positions: [a, b, c], aminoAcid });
    protein += aminoAcid;
  }
  return { codons, protein, table, codonStart };
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
