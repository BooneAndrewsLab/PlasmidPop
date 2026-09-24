import {
  type Feature,
  type FeatureLocation,
  type Segment,
  moveFeature,
  rangeSegment,
} from '../features';
import { newId } from '../ids';
import { type Range, rangePieces } from '../range';
import { SeqDocument } from './seqDocument';

/**
 * A new linear document holding just the bases in `r` (which may wrap on a
 * circular source). Features are kept when they overlap the region; parts
 * outside it are trimmed and the trimmed end is marked partial, so the
 * result reads like a GenBank sub-record.
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
          if (seg.position > o.start && seg.position < o.end) {
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

  const from = r.start + 1;
  const to = ((r.end - 1) % Math.max(1, L)) + 1;
  return SeqDocument.create({
    name: name ?? `${doc.name}_${from}-${to}`,
    sequence,
    topology: 'linear',
    features,
    // A stretch of a molecule is that molecule's DNA, methylated or not as it
    // was: an exported selection of a PCR product is still unmethylated.
    methylation: doc.methylation,
    metadata: {
      ...doc.metadata,
      description: `${from.toLocaleString()}-${to.toLocaleString()} of ${doc.name}${doc.metadata.description === '' ? '' : `: ${doc.metadata.description}`}`,
      accession: '',
      version: '',
    },
  });
}
