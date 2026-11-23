import { type SeqDocument } from '../document';
import { type Feature, qualifierValues } from '../features';
import { isCodingFeature } from './cdsTranslation';

/**
 * The CDS features a `gene` or an `mRNA` stands for (#452, item 149).
 *
 * A gene's own span is never what is translated: it holds the UTRs and the
 * introns (ACT1 is `<1..>1437` as a gene and `join(1..10,320..1437)` as a
 * CDS), so reading it end to end runs through the intron. Its protein is the
 * protein of the CDS annotated inside it.
 */

/** Feature keys whose protein is that of a CDS inside them. */
export function isGeneLikeFeature(feature: Feature): boolean {
  return feature.type === 'gene' || feature.type === 'mRNA';
}

interface Piece {
  readonly from: number;
  readonly to: number;
}

/**
 * A feature's range segments as offsets from `origin`, unrolled: on a circle
 * a segment before `origin` is one that was reached by going round, so a
 * feature over the origin is one run of offsets whichever way its location
 * was written (`4201..150` or `join(4201..5000,1..150)`).
 */
function piecesFrom(feature: Feature, origin: number, doc: SeqDocument): Piece[] {
  const circular = doc.topology === 'circular' && doc.length > 0;
  const pieces: Piece[] = [];
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') continue;
    const offset = seg.start - origin;
    const from = circular ? ((offset % doc.length) + doc.length) % doc.length : offset;
    pieces.push({ from, to: from + (seg.end - seg.start) });
  }
  return pieces;
}

function firstStart(feature: Feature): number | null {
  for (const seg of feature.segments) if (seg.kind === 'range') return seg.start;
  return null;
}

/** The stretches between consecutive pieces (the introns), as `from-to` keys. */
function gapsOf(pieces: readonly Piece[]): string[] {
  const sorted = [...pieces].sort((a, b) => a.from - b.from);
  const gaps: string[] = [];
  let reached = sorted[0]?.to ?? 0;
  for (const piece of sorted.slice(1)) {
    if (piece.from > reached) gaps.push(`${String(reached)}-${String(piece.from)}`);
    reached = Math.max(reached, piece.to);
  }
  return gaps;
}

type Kinship = 'same' | 'other' | 'unknown';

/**
 * Whether two features name the same gene: by `/locus_tag` when both carry
 * one, else by `/gene` when both carry one, else there is nothing to tell.
 */
function kinship(a: Feature, b: Feature): Kinship {
  for (const name of ['locus_tag', 'gene']) {
    const mine = qualifierValues(a, name).map((v) => v.trim());
    const theirs = qualifierValues(b, name).map((v) => v.trim());
    if (mine.length === 0 || theirs.length === 0) continue;
    return mine.some((v) => theirs.includes(v)) ? 'same' : 'other';
  }
  return 'unknown';
}

/**
 * The CDS features of `feature`, a gene or an mRNA, in document order: those
 * on its strand lying wholly inside its span, the origin of a circular
 * sequence included.
 *
 * - Where a CDS shares the feature's `/locus_tag` or `/gene`, only those
 *   count; a CDS that names another gene (one nested in an intron) never
 *   does. A CDS that says nothing either way counts when none is named.
 * - For an mRNA, a CDS spliced as the mRNA is (its introns are exactly the
 *   mRNA's introns within the CDS) is preferred over the other isoforms'.
 *
 * Empty for any other feature, and for a gene with no CDS in it.
 */
export function codingFeaturesOf(doc: SeqDocument, feature: Feature): readonly Feature[] {
  if (doc.isProtein || !isGeneLikeFeature(feature)) return [];
  const origin = firstStart(feature);
  if (origin === null) return [];
  const own = piecesFrom(feature, origin, doc);
  const span = Math.max(...own.map((p) => p.to));

  const inside: { cds: Feature; pieces: Piece[] }[] = [];
  for (const cds of doc.features.all()) {
    if (cds.id === feature.id || !isCodingFeature(cds) || cds.strand !== feature.strand) continue;
    const pieces = piecesFrom(cds, origin, doc);
    if (pieces.every((p) => p.from >= 0 && p.to <= span)) inside.push({ cds, pieces });
  }

  const named = inside.filter((c) => kinship(feature, c.cds) === 'same');
  let found =
    named.length > 0 ? named : inside.filter((c) => kinship(feature, c.cds) === 'unknown');

  if (feature.type === 'mRNA') {
    const introns = gapsOf(own);
    const spliced = found.filter((c) => {
      const from = Math.min(...c.pieces.map((p) => p.from));
      const to = Math.max(...c.pieces.map((p) => p.to));
      const within = introns.filter((gap) => {
        const [start, end] = gap.split('-').map(Number);
        return start !== undefined && end !== undefined && start >= from && end <= to;
      });
      return within.join() === gapsOf(c.pieces).join();
    });
    if (spliced.length > 0) found = spliced;
  }
  return found.map((c) => c.cds);
}
