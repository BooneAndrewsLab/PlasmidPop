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

/** Pieces in order, those that touch or overlap made one (an exon split at the origin). */
function merged(pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const piece of [...pieces].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last !== undefined && piece.from <= last.to) {
      out[out.length - 1] = { from: last.from, to: Math.max(last.to, piece.to) };
    } else {
      out.push(piece);
    }
  }
  return out;
}

/** The stretches between consecutive merged pieces: the introns. */
function gapsOf(exons: readonly Piece[]): Piece[] {
  return exons.slice(1).map((exon, i) => ({ from: exons[i]?.to ?? exon.from, to: exon.from }));
}

/**
 * Whether a CDS is spliced as an mRNA is: each of its exons lies in one of
 * the mRNA's, and its introns are exactly the mRNA's introns within it.
 */
function splicedAs(cds: readonly Piece[], mrnaExons: readonly Piece[]): boolean {
  const exons = merged(cds);
  if (!exons.every((e) => mrnaExons.some((m) => m.from <= e.from && e.to <= m.to))) return false;
  const from = exons[0]?.from ?? 0;
  const to = exons[exons.length - 1]?.to ?? 0;
  const key = (gaps: readonly Piece[]): string =>
    gaps.map((g) => `${String(g.from)}-${String(g.to)}`).join();
  return key(gapsOf(exons)) === key(gapsOf(mrnaExons).filter((g) => g.from >= from && g.to <= to));
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
 * - For an mRNA, a CDS spliced as the mRNA is (its exons inside the mRNA's, its
 *   introns exactly the mRNA's introns within it) is preferred over the other isoforms'.
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
    const exons = merged(own);
    const spliced = found.filter((c) => splicedAs(c.pieces, exons));
    if (spliced.length > 0) found = spliced;
  }
  return found.map((c) => c.cds);
}
