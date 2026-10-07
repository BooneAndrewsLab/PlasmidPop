import {
  type Feature,
  type FeatureLocation,
  type Segment,
  advanceCodonStart,
  keepLocatedWithinOwnSegments,
  moveFeature,
  rangeSegment,
} from '../features';
import { newId } from '../ids';
import { type Range, rangePieces } from '../range';
import { type StyleRun } from './baseStyles';
import { type DocumentEnds, BLUNT_END, topStrandOverhang } from './ends';
import { SeqDocument } from './seqDocument';

/**
 * A new linear document holding just the bases in `r` (which may wrap on a
 * circular source). Features are kept when they overlap the region; parts
 * outside it are trimmed and the trimmed end is marked partial, so the
 * result reads like a GenBank sub-record. A range that reaches an end of
 * a linear molecule keeps that end's shape, overhang and all (#39); an end
 * the range stops short of is a plain blunt one.
 */
export function extractRange(doc: SeqDocument, r: Range, name?: string): SeqDocument {
  const L = doc.length;
  const sequence = doc.subsequence(r);
  const pieces = rangePieces(r, L);
  // Offsets of each real piece within the extracted sequence.
  const offsets: { start: number; end: number; offset: number }[] = [];
  let acc = 0;
  for (const p of pieces) {
    offsets.push({ start: p.start, end: p.end, offset: acc });
    acc += p.end - p.start;
  }

  /**
   * A location's bases inside the region, in extract coordinates and in the
   * location's own segment order. Each range piece carries `from`/`to`, the
   * offsets of its bases along the location's range segments laid end to end
   * (source gaps between segments do not count, a segment across the origin
   * is continuous), so two consecutive pieces with `to < from` have bases
   * between them that the region dropped (#169). A range piece also carries
   * `at`, the source position of its first base, and `next`, the one just
   * past its last (taken round a circle), so a piece whose `at` is the last
   * one's `next` holds the bases that follow it in the source.
   */
  interface Piece {
    seg: Segment;
    from: number;
    to: number;
    at: number;
    next: number;
  }
  const keptPieces = (location: FeatureLocation): Piece[] => {
    const out: Piece[] = [];
    let along = 0;
    for (const seg of location.segments) {
      if (seg.kind === 'site') {
        for (const o of offsets) {
          // A site is kept only with a base of the extract on each side. The
          // start of a piece after the first is the origin of the circle the
          // range runs across, which has bases on both sides.
          const from = o.offset > 0 ? o.start - 1 : o.start;
          if (seg.position > from && seg.position < o.end) {
            out.push({
              seg: { kind: 'site', position: seg.position - o.start + o.offset },
              from: -1,
              to: -1,
              at: -1,
              next: -1,
            });
          }
        }
        continue;
      }
      for (const part of rangePieces(seg, L)) {
        // The part's bases in the region, in the part's own order: a region
        // across the origin lists its pieces in extract order, which is not
        // the order the feature reads them in.
        const inside: Piece[] = [];
        for (const o of offsets) {
          const s = Math.max(part.start, o.start);
          const e = Math.min(part.end, o.end);
          if (e <= s) continue;
          inside.push({
            from: along + s - part.start,
            to: along + e - part.start,
            at: s,
            next: doc.isCircular ? e % L : e,
            seg: rangeSegment(s - o.start + o.offset, e - o.start + o.offset, {
              partialStart: seg.partialStart || s > part.start,
              partialEnd: seg.partialEnd || e < part.end,
            }),
          });
        }
        inside.sort((x, y) => x.from - y.from);
        out.push(...inside);
        along += part.end - part.start;
      }
    }
    // The feature goes on past the first and last bases kept when whole
    // segments or the far side of the origin were dropped, even though the
    // region cuts no kept part inside (#176).
    const ranges = out.filter((x) => x.seg.kind === 'range');
    const head = ranges[0];
    const tail = ranges[ranges.length - 1];
    const total = location.segments.reduce(
      (n, x) => n + (x.kind === 'range' ? x.end - x.start : 0),
      0,
    );
    for (const piece of [head, tail]) {
      if (piece?.seg.kind !== 'range') continue;
      const { start, end, partialStart, partialEnd } = piece.seg;
      piece.seg = rangeSegment(start, end, {
        partialStart: partialStart || (piece === head && piece.from > 0),
        partialEnd: partialEnd || (piece === tail && piece.to < total),
      });
    }
    return out;
  };

  // Consecutive pieces that abut inside the extract merge back into one segment.
  const mergeAbutting = (segments: readonly Segment[]): Segment[] => {
    const merged: Segment[] = [];
    for (const seg of segments) {
      const prev = merged[merged.length - 1];
      if (prev?.kind === 'range' && seg.kind === 'range' && prev.end === seg.start) {
        merged[merged.length - 1] = rangeSegment(prev.start, seg.end, {
          partialStart: prev.partialStart,
          partialEnd: seg.partialEnd,
        });
      } else merged.push(seg);
    }
    return merged;
  };

  const clip = (location: FeatureLocation): FeatureLocation | null => {
    const segments = keptPieces(location).map((x) => x.seg);
    if (segments.length === 0) return null;
    return { strand: location.strand, segments: mergeAbutting(segments) };
  };

  const into = { length: sequence.length, topology: 'linear' } as const;
  const features: Feature[] = [];
  for (const f of doc.features) {
    const moved = moveFeature(f, doc, into, clip);
    if (moved === null) continue;
    // Where the region drops bases from the middle of a feature but keeps
    // both sides, the kept stretches are separate features (#169): a join
    // across the gap would read the far side out of frame. So are bases that
    // follow each other in the source but land at the two ends of the
    // extract, as a feature across the one cut of a circle does (#174): a
    // join across the product's ends would skip whatever is later put
    // between them.
    const pieces = keptPieces(f);
    const runs: Piece[][] = [];
    let last: Piece | undefined; // the last range piece
    for (const piece of pieces) {
      const isRange = piece.seg.kind === 'range';
      const split =
        isRange &&
        last !== undefined &&
        (piece.from > last.to ||
          (piece.at === last.next &&
            piece.seg.kind === 'range' &&
            last.seg.kind === 'range' &&
            piece.seg.start !== last.seg.end));
      if (runs.length === 0 || split) runs.push([]);
      runs[runs.length - 1]?.push(piece);
      if (isRange) last = piece;
    }
    const totalLength = f.segments.reduce(
      (n, x) => n + (x.kind === 'range' ? x.end - x.start : 0),
      0,
    );
    runs.forEach((run, i) => {
      // A CDS that loses the start of its reading is read from the first whole
      // codon left, as when a delete takes it (#160, #162). Each stretch of a
      // split one counts the bases that precede it in the whole reading.
      const ranges = run.filter((x) => x.seg.kind === 'range');
      const head = ranges[0];
      const tail = ranges[ranges.length - 1];
      const lost =
        head === undefined || tail === undefined
          ? 0
          : f.strand === 'reverse'
            ? totalLength - tail.to
            : head.from;
      if (runs.length === 1) {
        // A CDS the region clipped no longer has the bases its stored
        // /translation was read from (#179).
        const keptLength = moved.segments.reduce(
          (n, x) => n + (x.kind === 'range' ? x.end - x.start : 0),
          0,
        );
        const clipped = moved.type === 'CDS' && keptLength !== totalLength;
        const whole: Feature = clipped
          ? { ...moved, qualifiers: moved.qualifiers.filter((q) => q.name !== 'translation') }
          : moved;
        features.push({ ...advanceCodonStart(whole, lost), id: newId() });
        return;
      }
      if (head === undefined || tail === undefined) return; // only a split run of ranges gets here
      const first = run.indexOf(head);
      const last = run.lastIndexOf(tail);
      const segments = run.map((x, k) => {
        const seg = x.seg;
        if (seg.kind !== 'range') return seg;
        return rangeSegment(seg.start, seg.end, {
          partialStart: seg.partialStart || (i > 0 && k === first),
          partialEnd: seg.partialEnd || (i < runs.length - 1 && k === last),
        });
      });
      const part: Feature = {
        ...moved,
        segments: mergeAbutting(segments),
        qualifiers: moved.qualifiers.filter((q) => q.name !== 'translation'),
      };
      // A /transl_except stays with the stretch that holds its codon (#179).
      features.push({
        ...advanceCodonStart(keepLocatedWithinOwnSegments(part, into), lost),
        id: newId(),
      });
    });
  }

  // The styles the bases had go with them.
  const styles: StyleRun[] = [];
  for (const o of offsets) {
    for (const run of doc.styles.slice(o.start, o.end)) {
      styles.push({ start: run.start + o.offset, end: run.end + o.offset, style: run.style });
    }
  }

  const from = r.start + 1;
  const to = ((r.end - 1) % Math.max(1, L)) + 1;
  return SeqDocument.create({
    alphabet: doc.alphabet,
    name: name ?? `${doc.name}_${from}-${to}`,
    sequence,
    topology: 'linear',
    features,
    styles,
    // A stretch of a molecule is that molecule's DNA, methylated or not as it
    // was: an exported selection of a PCR product is still unmethylated.
    methylation: doc.methylation,
    ends: endsWithin(doc, r, sequence.length),
    metadata: {
      ...doc.metadata,
      description: `${from.toLocaleString()}-${to.toLocaleString()} of ${doc.name}${doc.metadata.description === '' ? '' : `: ${doc.metadata.description}`}`,
      accession: '',
      version: '',
      // A stretch of a product is not the molecule its lineage describes,
      // and extracting is not a reaction the tree has a step for (#67).
      lineage: null,
    },
  });
}

/** The ends of `doc` that `r` reaches, for an extract of `length` bases. */
function endsWithin(doc: SeqDocument, r: Range, length: number): DocumentEnds | null {
  const { ends } = doc;
  if (ends === null || doc.topology !== 'linear' || r.end <= r.start) return null;
  // An end is kept only with the single-stranded bases of it that are part
  // of the sequence, so an extract never holds half of an overhang.
  const left = r.start === 0 ? ends.left : BLUNT_END;
  const leftBases = topStrandOverhang(left, 'left');
  const right =
    r.end === doc.length && leftBases + topStrandOverhang(ends.right, 'right') <= length
      ? ends.right
      : BLUNT_END;
  return leftBases <= length ? { left, right } : null;
}
