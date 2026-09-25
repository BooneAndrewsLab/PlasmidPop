import { type Feature, type FeatureId } from '../features';
import { type Range, type Topology } from '../range';
import { type HostMethylationState } from '../analysis/methylation';
import { type BaseStylePatch } from './baseStyles';
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
  /**
   * Makes both sticky ends of a linear molecule blunt, as an enzyme on the
   * bench would (see `BluntMethod`). The bases change as well as the ends.
   */
  | { readonly type: 'bluntEnds'; readonly method: BluntMethod }
  /** Says where the DNA was grown, for the enzymes its methylation blocks. */
  | { readonly type: 'setMethylation'; readonly methylation: HostMethylationState }
  /** Colours, highlights, emboldens or resizes the bases in `range` (#89, #91). */
  | { readonly type: 'styleBases'; readonly range: Range; readonly style: BaseStylePatch }
  | { readonly type: 'rename'; readonly name: string }
  | { readonly type: 'setMetadata'; readonly patch: Partial<DocumentMetadata> }
  | { readonly type: 'addFeature'; readonly feature: Feature }
  | { readonly type: 'updateFeature'; readonly id: FeatureId; readonly patch: FeaturePatch }
  | { readonly type: 'removeFeature'; readonly id: FeatureId };

export type FeaturePatch = Partial<Omit<Feature, 'id'>>;

/**
 * How an overhang is made blunt (#8). `fill`: a polymerase (Klenow, T4 DNA
 * polymerase) fills a 5′ overhang in and chews a 3′ one back, so a 5′
 * overhang's bases become base pairs. `trim`: a single-strand nuclease (mung
 * bean) removes every overhang, 5′ or 3′.
 */
export type BluntMethod = 'fill' | 'trim';

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
    case 'bluntEnds':
      return op.method === 'fill' ? 'Blunt the ends (fill in)' : 'Blunt the ends (trim)';
    case 'setMethylation':
      return 'Set the host methylation';
    case 'styleBases':
      return describeStylePatch(op.style);
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

/** The History label for a change of base style: what it changed, when it was one thing. */
function describeStylePatch(patch: BaseStylePatch): string {
  const parts = (['color', 'highlight', 'bold', 'size'] as const).filter(
    (k) => patch[k] !== undefined,
  );
  if (parts.length > 0 && parts.every((k) => patch[k] === null)) {
    return parts.length === 1 ? CLEARED[parts[0] ?? 'color'] : 'Clear base style';
  }
  if (parts.length !== 1) return 'Style bases';
  return SET[parts[0] ?? 'color'];
}

const SET = {
  color: 'Colour bases',
  highlight: 'Highlight bases',
  bold: 'Bold bases',
  size: 'Resize bases',
} as const;

const CLEARED = {
  color: 'Clear base colour',
  highlight: 'Clear highlight',
  bold: 'Clear bold',
  size: 'Ordinary size',
} as const;
