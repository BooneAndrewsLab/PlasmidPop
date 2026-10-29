import { type EditOp, type Feature, type SeqDocument, firstQualifier } from '@/core';
import { type FeatureGroup, featureLabel } from '@/view/featureGroups';

/**
 * The two bulk removals of the Features tab (#316, item 117). Each is one
 * `removeFeatures` edit, so one Undo puts every feature back where it was;
 * each is offered only when it would remove more than the selected feature
 * already does on its own (Remove), and is null when there is nothing to do.
 */

/** Every feature of `type` in the document, hidden or drawn, in document order. */
export function featuresOfType(doc: SeqDocument, type: string): Feature[] {
  return doc.features.all().filter((f) => f.type === type);
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Removes every feature of `type`: `Remove 14 mRNA features`. Null when it has none. */
export function removeTypeOp(doc: SeqDocument, type: string): EditOp | null {
  const ids = featuresOfType(doc, type).map((f) => f.id);
  if (ids.length === 0) return null;
  return {
    type: 'removeFeatures',
    ids,
    label: `Remove ${plural(ids.length, `${type} feature`, `${type} features`)}`,
  };
}

/**
 * Removes the members of a group the views draw as one (item 115) other
 * than `keepId`: the other transcript variants of the gene, or the other
 * copies on these bases. Only the group's own members go — for a
 * transcripts group that is the other mRNAs and nothing else, as nothing in
 * a record links an mRNA to its CDS or peptides (#315). Null when `keepId`
 * is not a member or there is no other.
 */
export function removeOtherMembersOp(group: FeatureGroup, keepId: string): EditOp | null {
  const keep = group.members.find((m) => m.id === keepId);
  if (keep === undefined) return null;
  const ids = group.members.filter((m) => m.id !== keepId).map((m) => m.id);
  if (ids.length === 0) return null;
  // `Remove 3 other INS transcripts`, `Remove 3 other copies of sig_peptide`.
  // A transcripts group is made by `/gene`, so its members all carry one.
  const gene = firstQualifier(keep, 'gene')?.trim() ?? '';
  const label =
    group.kind === 'transcripts'
      ? `Remove ${plural(ids.length, `other ${gene} transcript`, `other ${gene} transcripts`)}`
      : `Remove ${plural(ids.length, 'other copy', 'other copies')} of ${featureLabel(keep)}`;
  return { type: 'removeFeatures', ids, label };
}
