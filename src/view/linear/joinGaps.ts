import { type Feature, type Range, type Topology, oneBasedEnd, rangePieces } from '@/core';

/**
 * The stretch between two consecutive range segments of a `join(...)` (#319):
 * what the sequence view marks at both ends and names with a chip, so a
 * reader sees why a feature (and a codon in it) is cut and how much lies
 * between the pieces. Display only; nothing here touches the document.
 *
 * Positions are 0-based boundaries on the forward strand, whatever the
 * feature's strand: on the reverse strand the pieces read in the other
 * order, but the stretch between two consecutive pieces is the same bases.
 */
export interface JoinGap {
  /** Which gap of the feature: between its range segments `index` and `index + 1`. */
  readonly index: number;
  /**
   * The boundary after the earlier segment's last base, in `(0, seqLength]`
   * (`seqLength` when that base is the sequence's last). The gap's first
   * base is this folded onto the circle.
   */
  readonly end: number;
  /** The boundary before the later segment's first base: that base's index. */
  readonly start: number;
  /** Bases between the segments; 0 when they touch, negative when they overlap. */
  readonly length: number;
}

/**
 * The gaps of a feature in several pieces. None for a single segment, and
 * none for `order(...)`: its pieces are listed together but nothing reads
 * across them, so there is no cut to explain. Site segments are skipped.
 *
 * On a circle a later segment that starts before the earlier one is past
 * the origin, and the gap wraps; one that starts inside the earlier segment
 * overlaps it (a programmed frameshift), and the gap is negative.
 */
export function joinGaps(feature: Feature, seqLength: number, topology: Topology): JoinGap[] {
  if (feature.joining === 'order') return [];
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  const out: JoinGap[] = [];
  for (let i = 0; i + 1 < ranges.length; i++) {
    const a = ranges[i];
    const b = ranges[i + 1];
    if (a === undefined || b === undefined) break;
    const e = a.end;
    const s = b.start;
    let end = e;
    let length = s - e;
    if (topology === 'circular' && seqLength > 0) {
      if (e > seqLength) {
        // The earlier segment wrapped past the origin; the later one lies after it on the same lap.
        end = e - seqLength;
        length = s - end;
      } else if (s < e && s < a.start) {
        length = s - e + seqLength;
      }
    }
    out.push({ index: i, end, start: s, length });
  }
  return out;
}

/** The unrolled stretch a positive gap covers: `[first base, end)`, wrapping as a range does. */
export function gapRange(gap: JoinGap, seqLength: number): Range {
  const from = gap.end === seqLength ? 0 : gap.end;
  return { start: from, end: from + gap.length };
}

/** The bases a positive gap covers as real pieces, in forward order, none for a gap of no bases. */
export function gapPieces(gap: JoinGap, seqLength: number): readonly Range[] {
  if (gap.length <= 0) return [];
  return rangePieces(gapRange(gap, seqLength), seqLength);
}

/** Feature types whose join pieces are exons, so the stretch between them is an intron. */
const SPLICED_TYPES = new Set([
  'CDS',
  'mRNA',
  'exon',
  'gene',
  'ncRNA',
  'tRNA',
  'rRNA',
  'tmRNA',
  'misc_RNA',
  'precursor_RNA',
  'prim_transcript',
  "5'UTR",
  "3'UTR",
]);

/** What to call the stretch between two pieces of `feature`: an intron for a spliced type, else a gap. */
export function gapWord(feature: Feature): 'intron' | 'gap' {
  return SPLICED_TYPES.has(feature.type) ? 'intron' : 'gap';
}

/** The gap's bases, 1-based inclusive on the forward strand, `991-10` for one that wraps. */
function gapBases(gap: JoinGap, seqLength: number): string {
  const r = gapRange(gap, seqLength);
  const first = r.start + 1;
  const last = oneBasedEnd(r.end, seqLength);
  return first === last ? String(first) : `${first}-${last}`;
}

/** The chip drawn in a positive gap: `intron 436-1222 · 787 bp`. */
export function gapChipText(gap: JoinGap, feature: Feature, seqLength: number): string {
  return `${gapWord(feature)} ${gapBases(gap, seqLength)} · ${gap.length} bp`;
}

/**
 * What the tooltip over a gap, or over either of its marks, says. The piece
 * where reading goes on is the later segment on the forward strand and the
 * earlier one on the reverse strand; both are named by their first base in
 * reading order, 1-based.
 */
export function gapNote(gap: JoinGap, feature: Feature, seqLength: number): string {
  const name = feature.name === '' ? feature.type : feature.name;
  const word = gapWord(feature);
  const piece = word === 'intron' ? 'exon' : 'piece';
  const earlierLast = oneBasedEnd(gap.end, seqLength);
  const laterFirst = gap.start + 1;
  if (gap.length > 0) {
    const resumes = feature.strand === 'reverse' ? earlierLast : laterFirst;
    return `${name}: ${word} ${gapBases(gap, seqLength)}, ${gap.length} bp. The ${piece}s are joined; the feature continues at ${resumes}.`;
  }
  if (gap.length === 0) {
    return `${name}: the ${piece}s ending at ${earlierLast} and starting at ${laterFirst} touch, with nothing between them.`;
  }
  return `${name}: the ${piece}s ending at ${earlierLast} and starting at ${laterFirst} overlap by ${-gap.length} bp.`;
}

/** Whether base `position` lies in a positive gap. */
export function gapCovers(gap: JoinGap, position: number, seqLength: number): boolean {
  return gapPieces(gap, seqLength).some((p) => position >= p.start && position < p.end);
}

/** A gap of a feature in several pieces, found under the pointer. */
export interface GapHit {
  readonly feature: Feature;
  readonly gap: JoinGap;
}

/**
 * The gap of a feature drawn in `lane` that holds base `position`, for the
 * tooltip over the empty stretch of a lane between two pieces of a join.
 * `laneOf` is the lane assignment the bars were drawn with.
 */
export function gapAtLane(
  features: readonly Feature[],
  laneOf: ReadonlyMap<string, number>,
  lane: number,
  position: number,
  seqLength: number,
  topology: Topology,
): GapHit | undefined {
  for (const feature of features) {
    if (feature.segments.length < 2 || laneOf.get(feature.id) !== lane) continue;
    const gap = joinGaps(feature, seqLength, topology).find((g) =>
      gapCovers(g, position, seqLength),
    );
    if (gap !== undefined) return { feature, gap };
  }
  return undefined;
}
