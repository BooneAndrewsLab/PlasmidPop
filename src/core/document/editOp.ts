import { type Feature, type FeatureId } from '../features';
import { type Range, type Topology } from '../range';
import { type DocumentEnds } from './ends';
import { type SeqFragment } from './fragment';
import { type DocumentMetadata } from './metadata';

/**
 * Every change to a document is expressible as plain data. The UI, undo
 * history and (later) a CRDT layer all speak this vocabulary; `SeqDocument`
 * methods are thin wrappers that construct one of these and apply it.
 */
export type EditOp =
  | { readonly type: 'insert'; readonly position: number; readonly text: string }
  | { readonly type: 'delete'; readonly range: Range }
  | { readonly type: 'replace'; readonly range: Range; readonly text: string }
  /**
   * Pasting: the bases in `range` (none for a caret) are removed and the
   * fragment's sequence and features take their place. Unlike `replace`,
   * annotations confined to `range` do not survive.
   */
  | { readonly type: 'insertFragment'; readonly range: Range; readonly fragment: SeqFragment }
  | { readonly type: 'reverseComplement' }
  | { readonly type: 'setOrigin'; readonly position: number }
  | { readonly type: 'setTopology'; readonly topology: Topology }
  /** Describes the ends of a linear molecule, or clears the description. */
  | { readonly type: 'setEnds'; readonly ends: DocumentEnds | null }
  | { readonly type: 'rename'; readonly name: string }
  | { readonly type: 'setMetadata'; readonly patch: Partial<DocumentMetadata> }
  | { readonly type: 'addFeature'; readonly feature: Feature }
  | { readonly type: 'updateFeature'; readonly id: FeatureId; readonly patch: FeaturePatch }
  | { readonly type: 'removeFeature'; readonly id: FeatureId };

export type FeaturePatch = Partial<Omit<Feature, 'id'>>;

/**
 * The History label for an edit that took `before` to `after`. Only a turn
 * says more than its op does: a molecule with overhangs comes out of one a
 * different length (item 34), and a step that reads "Reverse complement"
 * gives no hint of that (#7).
 */
export function describeEditStep(
  op: EditOp,
  before: { readonly length: number },
  after: { readonly length: number },
): string {
  const label = describeEditOp(op);
  if (op.type !== 'reverseComplement' || before.length === after.length) return label;
  return `${label}: ${before.length.toLocaleString()} → ${after.length.toLocaleString()} bp`;
}

export function describeEditOp(op: EditOp): string {
  switch (op.type) {
    case 'insert':
      return op.text.length === 1 ? 'Insert 1 base' : `Insert ${op.text.length} bases`;
    case 'delete':
      return 'Delete';
    case 'replace':
      return 'Replace';
    case 'insertFragment': {
      const n = op.fragment.sequence.length;
      return n === 1 ? 'Paste 1 base' : `Paste ${n.toLocaleString()} bases`;
    }
    case 'reverseComplement':
      return 'Reverse complement';
    case 'setOrigin':
      return 'Set origin';
    case 'setTopology':
      return op.topology === 'circular' ? 'Make circular' : 'Make linear';
    case 'setEnds':
      return op.ends === null ? 'Blunt the ends' : 'Set the ends';
    case 'rename':
      return 'Rename';
    case 'setMetadata':
      return 'Edit description';
    case 'addFeature':
      return 'Add feature';
    case 'updateFeature':
      return 'Edit feature';
    case 'removeFeature':
      return 'Remove feature';
  }
}
