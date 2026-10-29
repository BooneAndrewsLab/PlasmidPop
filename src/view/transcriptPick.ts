import { type Feature, type Range, firstQualifier } from '@/core';

import { featureLabel, groupFeatures, transcriptGene } from './featureGroups';

/**
 * Showing one transcript variant of a gene (item 119, #315). A RefSeq gene
 * record lists an mRNA per variant and, for each, a CDS followed by what its
 * protein is cut into; the views group them (item 115), and this narrows
 * them to one variant of the user's choosing — a display-time filter after
 * the hidden types (item 109) and before the grouping, so the lanes, the
 * hit tests, the translations and the Features list all see one transcript.
 *
 * **The link is compatibility, not identity.** Nothing in the record says
 * which CDS is which mRNA's (the four INS CDSs differ only in `/protein_id`,
 * and the mRNAs and CDSs are not even listed in the same order), nor which
 * CDS a `sig_peptide` is cut from (file order alone, which a hand-made file
 * does not keep). What the coordinates do say is which transcript *could*
 * carry a CDS and which CDS *could* be cut into a peptide: a CDS is the
 * picked transcript's when every piece of it lies in one of its exons and
 * its splice junctions are the exons' own; a peptide is a CDS's on the same
 * terms. A pick leaves out only what cannot belong to the chosen
 * transcript; whatever can — a CDS four variants share, drawn as one bar
 * anyway — stays, and so does anything the filter cannot place at all: an
 * mRNA or CDS with no `/gene`, a CDS that fits none of its gene's
 * transcripts, a peptide in no CDS. Those fail visible, never silently.
 */

/** What a CDS's protein is cut into (INSDC keys); each follows its CDS in an NCBI record. */
export const PROCESSING_TYPES: ReadonlySet<string> = new Set([
  'sig_peptide',
  'transit_peptide',
  'mat_peptide',
  'propeptide',
  'proprotein',
]);

/** The transcript shown per gene, by gene name; a gene not listed shows every transcript. */
export type TranscriptPicks = ReadonlyMap<string, string>;

export const NO_PICKS: TranscriptPicks = new Map();

export interface TranscriptPlan {
  /** Each gene with two or more mRNAs (item 115's transcript groups), its mRNAs in document order. */
  readonly variants: ReadonlyMap<string, readonly Feature[]>;
  /** The picks that name a transcript the document has: the gene, and its mRNAs with that key. */
  readonly picked: ReadonlyMap<string, readonly Feature[]>;
  /** The features the picks leave out, by id. */
  readonly hidden: ReadonlySet<string>;
}

const EMPTY_PLAN: TranscriptPlan = { variants: new Map(), picked: new Map(), hidden: new Set() };

function locationKey(f: Feature): string {
  return f.segments
    .map((s) =>
      s.kind === 'range' ? `${String(s.start)}-${String(s.end)}` : `@${String(s.position)}`,
    )
    .join(',');
}

/**
 * What a pick names an mRNA by: its `/transcript_id` (`NM_000207.3`), which
 * is what a user knows a variant as and holds across copies of the record;
 * failing that, its name and location, which is all a hand-made one has.
 */
export function transcriptKey(mRNA: Feature): string {
  const id = firstQualifier(mRNA, 'transcript_id')?.trim();
  return id === undefined || id === '' ? `${featureLabel(mRNA)}@${locationKey(mRNA)}` : id;
}

/** How the picker lists an mRNA: its accession, or its name when it has none. */
export function transcriptChoice(mRNA: Feature): string {
  const id = firstQualifier(mRNA, 'transcript_id')?.trim();
  return id === undefined || id === '' ? featureLabel(mRNA) : id;
}

/**
 * The genes a transcript can be picked for: those item 115 would draw as a
 * transcripts row, from the document's mRNAs whether or not the type is
 * drawn (hiding `mRNA` is how the record is read as its genes; the pick is
 * about which gene product those are). A gene with mRNAs on both strands
 * lists both groups' members.
 */
export function transcriptVariants(
  features: readonly Feature[],
  seqLength: number,
): ReadonlyMap<string, readonly Feature[]> {
  const mRNAs = features.filter((f) => f.type === 'mRNA');
  const byGene = new Map<string, Feature[]>();
  for (const group of groupFeatures(mRNAs, seqLength).groups.values()) {
    if (group.kind !== 'transcripts') continue;
    const first = group.members[0];
    const gene = first === undefined ? undefined : transcriptGene(first);
    if (gene === undefined) continue;
    const list = byGene.get(gene) ?? [];
    list.push(...group.members);
    byGene.set(gene, list);
  }
  const order = new Map(features.map((f, i) => [f.id, i]));
  for (const list of byGene.values())
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return byGene;
}

function geneOf(f: Feature): string | undefined {
  const gene = firstQualifier(f, 'gene')?.trim();
  return gene === undefined || gene === '' ? undefined : gene;
}

function rangePiecesOf(f: Feature): Range[] | null {
  const out: Range[] = [];
  for (const s of f.segments) {
    if (s.kind !== 'range') return null;
    out.push(s);
  }
  return out.length === 0 ? null : out;
}

/**
 * Whether `inner` lies within `outer`, as the unrolled coordinates have them
 * (`end` past the sequence's length for a piece through the origin). A piece
 * in the tail of one that wraps is found by sliding it round once.
 */
function offsetWithin(inner: Range, outer: Range, seqLength: number): number | null {
  if (outer.start <= inner.start && inner.end <= outer.end) return 0;
  if (seqLength > 0 && outer.start <= inner.start + seqLength && inner.end + seqLength <= outer.end)
    return seqLength;
  return null;
}

/**
 * Whether `outer` can carry `inner`: the same strand, every piece of `inner`
 * inside a piece of `outer`, consecutive pieces in consecutive pieces of
 * `outer`, and each splice junction of `inner` an exon boundary of `outer`
 * (the end of each piece but the last, the start of each but the first).
 * A CDS whose junctions are not the mRNA's — one that skips an exon the
 * mRNA keeps, or reads through an intron it splices — is not its CDS; a
 * single-piece feature needs only to lie inside one piece.
 */
export function carries(outer: Feature, inner: Feature, seqLength: number): boolean {
  if (outer.strand !== inner.strand) return false;
  const exons = rangePiecesOf(outer);
  const pieces = rangePiecesOf(inner);
  if (exons === null || pieces === null) return false;
  let at = -1;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (piece === undefined) return false;
    let found = -1;
    let shift = 0;
    const from = i === 0 ? 0 : at + 1;
    const to = i === 0 ? exons.length - 1 : at + 1;
    for (let j = from; j <= to; j++) {
      const exon = exons[j];
      if (exon === undefined) continue;
      const d = offsetWithin(piece, exon, seqLength);
      if (d !== null) {
        found = j;
        shift = d;
        break;
      }
    }
    if (found < 0) return false;
    const exon = exons[found];
    if (exon === undefined) return false;
    if (i > 0 && piece.start + shift !== exon.start) return false;
    if (i < pieces.length - 1 && piece.end + shift !== exon.end) return false;
    at = found;
  }
  return true;
}

/**
 * What the picks leave out of `features` (the document's, hidden types
 * included: a peptide's CDS may be hidden by type and still place it).
 * Picks naming a gene or a transcript the document lacks do nothing: the
 * last document's picks seed the next (item 109), and a stale one must not
 * hide anything.
 */
export function planTranscripts(
  features: readonly Feature[],
  picks: TranscriptPicks,
  seqLength: number,
): TranscriptPlan {
  if (picks.size === 0) return EMPTY_PLAN;
  const variants = transcriptVariants(features, seqLength);
  const picked = new Map<string, readonly Feature[]>();
  for (const [gene, key] of picks) {
    const chosen = variants.get(gene)?.filter((m) => transcriptKey(m) === key) ?? [];
    if (chosen.length > 0) picked.set(gene, chosen);
  }
  const hidden = new Set<string>();
  if (picked.size === 0) return { variants, picked, hidden };

  // The gene's other mRNAs.
  for (const [gene, chosen] of picked) {
    const keep = new Set(chosen.map((m) => m.id));
    for (const m of variants.get(gene) ?? []) if (!keep.has(m.id)) hidden.add(m.id);
  }
  // A CDS the chosen transcript cannot carry, when another of the gene's can.
  const cdss = features.filter((f) => f.type === 'CDS');
  for (const cds of cdss) {
    const gene = geneOf(cds);
    if (gene === undefined) continue;
    const chosen = picked.get(gene);
    if (chosen === undefined) continue;
    const mRNAs = variants.get(gene) ?? [];
    if (!mRNAs.some((m) => carries(m, cds, seqLength))) continue;
    if (!chosen.some((m) => carries(m, cds, seqLength))) hidden.add(cds.id);
  }
  // A peptide cut from no CDS that is still shown. One in no CDS at all is
  // nobody's and stays; one with a /gene is only its own gene's CDSs'.
  for (const f of features) {
    if (!PROCESSING_TYPES.has(f.type)) continue;
    const gene = geneOf(f);
    let carriersSeen = false;
    let shown = false;
    for (const cds of cdss) {
      const cdsGene = geneOf(cds);
      if (gene !== undefined && cdsGene !== undefined && gene !== cdsGene) continue;
      if (!carries(cds, f, seqLength)) continue;
      carriersSeen = true;
      if (!hidden.has(cds.id)) {
        shown = true;
        break;
      }
    }
    if (carriersSeen && !shown) hidden.add(f.id);
  }
  return { variants, picked, hidden };
}

/** `features` without what the plan leaves out. */
export function showTranscripts(features: readonly Feature[], plan: TranscriptPlan): Feature[] {
  return plan.hidden.size === 0 ? [...features] : features.filter((f) => !plan.hidden.has(f.id));
}

/** "1 transcript picked" / "2 transcripts picked", for the Format menu's note. */
export function transcriptPicksNote(count: number): string {
  return `${String(count)} ${count === 1 ? 'transcript' : 'transcripts'} picked`;
}

/**
 * The Features tab's banner: which genes show one transcript, and that the
 * rest are out of the list too.
 */
export function transcriptPicksBanner(plan: TranscriptPlan): string {
  const genes = [...plan.picked.keys()];
  const list =
    genes.length <= 1
      ? (genes[0] ?? '')
      : `${genes.slice(0, -1).join(', ')} and ${genes[genes.length - 1] ?? ''}`;
  return `Showing one transcript of ${list} in the views; the others, with the CDSs and peptides only they carry, are not listed here either.`;
}

/** An option's tip in the picker: the accession and the name, when it has both. */
export function describeTranscript(mRNA: Feature): string {
  const id = transcriptChoice(mRNA);
  const name = featureLabel(mRNA);
  return id === name ? name : `${id} — ${name}`;
}
