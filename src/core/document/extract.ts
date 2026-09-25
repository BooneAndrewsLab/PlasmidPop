import {
  type Feature,
  type FeatureLocation,
  type Segment,
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

  // A location's bases inside the region, in extract coordinates.
  const clip = (location: FeatureLocation): FeatureLocation | null => {
    const segments: Segment[] = [];
    for (const seg of location.segments) {
      if (seg.kind === 'site') {
        for (const o of offsets) {
          // A site is kept only with a base of the extract on each side. The
          // start of a piece after the first is the origin of the circle the
          // range runs across, which has bases on both sides.
          const from = o.offset > 0 ? o.start - 1 : o.start;
          if (seg.position > from && seg.position < o.end) {
            segments.push({ kind: 'site', position: seg.position - o.start + o.offset });
          }
        }
        continue;
      }
      for (const part of rangePieces(seg, L)) {
        for (const o of offsets) {
          const s = Math.max(part.start, o.start);
          const e = Math.min(part.end, o.end);
          if (e <= s) continue;
          segments.push(
            rangeSegment(s - o.start + o.offset, e - o.start + o.offset, {
              partialStart: seg.partialStart || s > part.start,
              partialEnd: seg.partialEnd || e < part.end,
            }),
          );
        }
      }
    }
    if (segments.length === 0) return null;
    // Consecutive pieces that abut inside the extract merge back into one segment.
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
    return { strand: location.strand, segments: merged };
  };

  const into = { length: sequence.length, topology: 'linear' } as const;
  const features: Feature[] = [];
  for (const f of doc.features) {
    const moved = moveFeature(f, doc, into, clip);
    if (moved !== null) features.push({ ...moved, id: newId() });
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
