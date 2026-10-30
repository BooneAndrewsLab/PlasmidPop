import { type EditOp, type Feature, type SeqDocument, firstQualifier } from '@/core';
import { type FeatureGroup, featureLabel } from '@/view/featureGroups';
import { planTranscripts, transcriptKey } from '@/view/transcriptPick';

/**
 * The two bulk removals of the Features tab (#316, item 117). Each is one
 * `removeFeatures` edit, so one Undo puts every feature back where it was;
 * each is offered only when it would remove more than the selected feature
 * already does on its own (Remove), and is null when there is nothing to do.
 */

/**
 * Every feature of `type` in the document, hidden or drawn, in document
 * order; or, given `listed`, every one of those (#316): while a transcript
 * is picked (item 119) the Features list leaves the gene's other variants
 * out, and a bulk removal must take what the list shows, not what it hides.
 */
export function featuresOfType(
  doc: SeqDocument,
  type: string,
  listed: readonly Feature[] = doc.features.all(),
): Feature[] {
  return listed.filter((f) => f.type === type);
}

/** The `removeFeatures` edit, for callers that read its label. */
export type RemoveFeaturesOp = Extract<EditOp, { type: 'removeFeatures' }>;

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Removes every feature of `type` (of `listed`, when given; see
 * `featuresOfType`): `Remove 14 mRNA features`. Null when it has none.
 */
export function removeTypeOp(
  doc: SeqDocument,
  type: string,
  listed?: readonly Feature[],
): EditOp | null {
  const ids = featuresOfType(doc, type, listed).map((f) => f.id);
  if (ids.length === 0) return null;
  return {
    type: 'removeFeatures',
    ids,
    label: `Remove ${plural(ids.length, `${type} feature`, `${type} features`)}`,
  };
}

/**
 * Makes a transcript pick (item 119) permanent (#328): keeps the mRNA of
 * `gene` that `key` names and removes exactly what `planTranscripts` leaves
 * out for that pick: the gene's other mRNAs, the CDSs the kept one cannot
 * carry, and the peptides no remaining CDS can carry. Ambiguous or unlinked
 * features are not in the plan, so they stay. Null when the pick names
 * nothing the document has, or hides nothing.
 */
export function removeOtherTranscriptsOp(
  doc: SeqDocument,
  gene: string,
  key: string,
): RemoveFeaturesOp | null {
  const features = doc.features.all();
  const plan = planTranscripts(features, new Map([[gene, key]]), doc.length);
  const gone = features.filter((f) => plan.hidden.has(f.id));
  if (gone.length === 0) return null;
  const count = (pred: (f: Feature) => boolean): number => gone.filter(pred).length;
  const mRNAs = count((f) => f.type === 'mRNA');
  const cdss = count((f) => f.type === 'CDS');
  const peptides = gone.length - mRNAs - cdss;
  const parts = [plural(mRNAs, `other ${gene} transcript`, `other ${gene} transcripts`)];
  if (cdss > 0) parts.push(plural(cdss, 'CDS', 'CDSs'));
  if (peptides > 0) parts.push(plural(peptides, 'peptide', 'peptides'));
  const last = parts.pop();
  const list = parts.length === 0 ? (last ?? '') : `${parts.join(', ')} and ${last ?? ''}`;
  return { type: 'removeFeatures', ids: gone.map((f) => f.id), label: `Remove ${list}` };
}

/**
 * Removes the members of a group the views draw as one (item 115) other
 * than `keepId`: the other copies on these bases, or, for a transcripts
 * group, the gene's other variants with what only they can carry
 * (`removeOtherTranscriptsOp`, #328). Null when `keepId` is not a member or
 * there is nothing else to remove.
 */
export function removeOtherMembersOp(
  group: FeatureGroup,
  keepId: string,
  doc: SeqDocument,
): EditOp | null {
  const keep = group.members.find((m) => m.id === keepId);
  if (keep === undefined) return null;
  if (group.kind === 'transcripts') {
    // A transcripts group is made by `/gene`, so its members all carry one.
    const gene = firstQualifier(keep, 'gene')?.trim() ?? '';
    return removeOtherTranscriptsOp(doc, gene, transcriptKey(keep));
  }
  const ids = group.members.filter((m) => m.id !== keepId).map((m) => m.id);
  if (ids.length === 0) return null;
  return {
    type: 'removeFeatures',
    ids,
    label: `Remove ${plural(ids.length, 'other copy', 'other copies')} of ${featureLabel(keep)}`,
  };
}
