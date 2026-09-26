import { documentChecksum } from '../checksum';
import { type SeqDocument } from '../document';
import { type Range, type Topology } from '../range';

/**
 * What a molecule was made from (#67, item 52).
 *
 * A product of a simulated reaction opens as a document of its own, and
 * until now the link to its parts was lost the moment it did. A lineage is
 * that link kept: the molecule, how it was made, and the same for each of
 * the molecules it was made from, as far back as the app saw. So a product
 * carries its whole tree, not one level of it — a plasmid ligated from a
 * fragment of a PCR product names the template the PCR was run on.
 *
 * It holds names, checksums, sizes and the settings of each step, never the
 * parents' sequences: a checksum (`seguid.ts`) is enough to tell whether a
 * molecule in front of you is the one a step used, and is 36 characters
 * where the molecule may be 10 kb.
 */

/** One molecule in a lineage: what it is, and how it was made when that is known. */
export interface LineageNode {
  /** What it was called when it was used or made. */
  readonly name: string;
  /**
   * Its `cdseguid=…`/`ldseguid=…` checksum in full, taken when it was used
   * or made; null when there was none to take (an empty molecule).
   */
  readonly checksum: string | null;
  readonly topology: Topology;
  readonly length: number;
  /** How it was made; null for a molecule with no recorded history, such as a file opened. */
  readonly step: LineageStep | null;
}

/** An oligo as a step records it: its name in the reaction and its bases, 5′ to 3′. */
export interface LineagePrimer {
  readonly name: string;
  readonly sequence: string;
}

/** Which kit a homology assembly was run as; the same reaction, at different overlaps. */
export type HomologyKit = 'gibson' | 'in-fusion' | 'nebuilder';

/** The polymerase a PCR was run with, as `pcr.ts` names it. */
export type LineagePolymerase = 'proofreading' | 'taq';

/** How a mutagenesis was designed, as `mutagenesis.ts` names it. */
export type LineageMutagenesisMethod = 'back-to-back' | 'overlapping';

/**
 * How a molecule was made, one kind per reaction, each with the molecules
 * that went into it. `parents` is always there, so a tree can be walked
 * without knowing the kinds; how many a kind has is checked by
 * `isLineageNode` and by the reader of the GenBank block.
 */
export type LineageStep =
  | {
      /** Cut out of its one parent. */
      readonly op: 'digest';
      readonly parents: readonly LineageNode[];
      /** The enzymes at its two ends, left first, each once; empty for an uncut molecule. */
      readonly enzymes: readonly string[];
      /** Where it lies in the parent: 0-based, half-open, unrolled past the origin of a circle. */
      readonly range: Range;
      /** Sites inside it a partial digest left uncut; 0 for a complete digest. */
      readonly uncut: number;
    }
  | {
      /** Amplified from its one parent, the template. */
      readonly op: 'pcr';
      readonly parents: readonly LineageNode[];
      readonly forward: LineagePrimer;
      readonly reverse: LineagePrimer;
      readonly polymerase: LineagePolymerase;
    }
  | {
      /** Its parents joined end to end in this order, each turned over or not. */
      readonly op: 'ligation';
      readonly parents: readonly LineageNode[];
      readonly circular: boolean;
      /** One per parent. */
      readonly flipped: readonly boolean[];
    }
  | {
      /** Its parents cut with one or two Type IIS enzymes and joined, in the order found. */
      readonly op: 'golden-gate';
      readonly parents: readonly LineageNode[];
      readonly enzymes: readonly string[];
      /** One per parent: whether its first piece went in turned over. */
      readonly flipped: readonly boolean[];
    }
  | {
      /** Its parents joined by their end homology (Gibson, In-Fusion, NEBuilder). */
      readonly op: 'gibson';
      readonly parents: readonly LineageNode[];
      readonly kit: HomologyKit;
      readonly circular: boolean;
      /** The shortest homology looked for, in bases. */
      readonly overlap: number;
      /** One per parent. */
      readonly flipped: readonly boolean[];
    }
  | {
      /** Recombined from two parents: the att substrate or entry clone, then the vector. */
      readonly op: 'gateway';
      readonly parents: readonly LineageNode[];
      readonly reaction: 'BP' | 'LR';
      /** The other circle the reaction gives, not the clone. */
      readonly byproduct: boolean;
    }
  | {
      /** Its one parent changed by a pair of mutagenic primers. */
      readonly op: 'mutagenesis';
      readonly parents: readonly LineageNode[];
      /** What changed, as the design names it (`A1234G`, `+GGATCC at 120`…). */
      readonly change: string;
      readonly method: LineageMutagenesisMethod;
      /** The two primers' bases, forward first. */
      readonly primers: readonly string[];
    }
  | {
      /** Its one parent's 5′ phosphates taken off (phosphatase) or put on (kinase). */
      readonly op: 'phosphates';
      readonly parents: readonly LineageNode[];
      readonly removed: boolean;
    }
  | {
      /**
       * Its one parent edited by hand: a product changed after it was made,
       * then used again. The parent is the product as it was made; what the
       * edits were is the document's own history (items 5 and 51), which a
       * checksum cannot say.
       */
      readonly op: 'edited';
      readonly parents: readonly LineageNode[];
    }
  | {
      /**
       * A step another program recorded that has no kind of its own here
       * (#85): SnapGene's history tree names operations PlasmidPop does not
       * run, and its own name for one is better than dropping the node.
       */
      readonly op: 'other';
      readonly parents: readonly LineageNode[];
      /** What the program called it, e.g. `newFileFromSelection`. */
      readonly name: string;
    }
  | {
      /** Earlier molecules left out to keep the tree small (`pruneLineage`). */
      readonly op: 'elided';
      readonly parents: readonly LineageNode[];
      /** How many molecules were left out below this one. */
      readonly nodes: number;
    };

export type LineageOp = LineageStep['op'];

/**
 * The most molecules a lineage keeps, root included. A construct made in
 * five rounds of two-part cloning, each insert a PCR product, is 26 (a 3.3 KB
 * GenBank block); 64 leaves room for a Golden Gate of a dozen parts on top of
 * that. The worst case, 64 PCR products with 60-base primers, is a 19 KB
 * block, which a share link's compression brings to about 1 KB more link
 * (item 52 has the measurements).
 */
export const MAX_LINEAGE_NODES = 64;

/** The deepest a lineage goes, root at 0. */
export const MAX_LINEAGE_DEPTH = 24;

/** Names are cut to this many characters: a file name, not a paragraph. */
export const MAX_LINEAGE_NAME = 120;

/** How many parents each kind of step takes: an exact count, or at least one. */
export function parentCount(op: LineageOp): number | 'some' {
  switch (op) {
    case 'digest':
    case 'pcr':
    case 'mutagenesis':
    case 'phosphates':
    case 'edited':
      return 1;
    case 'gateway':
      return 2;
    case 'ligation':
    case 'golden-gate':
    case 'gibson':
    case 'other':
      return 'some';
    case 'elided':
      return 0;
  }
}

/** A name as a lineage keeps it: one line, trimmed, and not too long. */
export function lineageName(name: string): string {
  const flat = name.replace(/\s+/g, ' ').trim();
  const cut = flat.length > MAX_LINEAGE_NAME ? `${flat.slice(0, MAX_LINEAGE_NAME - 1)}…` : flat;
  return cut === '' ? 'Untitled' : cut;
}

/** The checksum a lineage records for a document, in full. */
export function lineageChecksum(doc: SeqDocument): string | null {
  return documentChecksum(doc)?.text ?? null;
}

/**
 * A document as a parent in a step: its name, checksum and size now, and
 * how it was made. A product used as made brings its own lineage along. One
 * edited since it was made (its checksum no longer the one recorded at
 * creation) is a molecule of its own, made from the product by editing, so
 * its node says so and keeps the recorded one beneath it. A document with no
 * lineage — a file opened, a sequence typed — is a leaf.
 */
export function lineageOf(doc: SeqDocument): LineageNode {
  const checksum = lineageChecksum(doc);
  const own = doc.metadata.lineage;
  const node = {
    name: lineageName(doc.name),
    checksum,
    topology: doc.topology,
    length: doc.length,
  };
  if (own === null) return { ...node, step: null };
  if (own.checksum === checksum) return { ...node, step: own.step };
  return { ...node, step: { op: 'edited', parents: [own] } };
}

/**
 * Whether a document has been edited since the lineage it carries was
 * recorded: its checksum is not the one taken when it was made. False for a
 * document with no lineage, which was not made here, and for one whose
 * lineage came from a program that records no checksum (#85).
 */
export function editedSinceMade(doc: SeqDocument): boolean {
  const own = doc.metadata.lineage;
  // A root with no checksum cannot say: SnapGene records none (#85), so a
  // tree read from one of its files would otherwise read as edited the
  // moment it was opened.
  if (own?.checksum == null) return false;
  return own.checksum !== lineageChecksum(doc);
}

/**
 * A product with how it was made recorded on it: the document as the root,
 * its checksum taken now so a later edit can be told from the molecule that
 * was made, and the step beneath it, trimmed to the limits.
 */
export function withLineage(doc: SeqDocument, step: LineageStep): SeqDocument {
  const root: LineageNode = {
    name: lineageName(doc.name),
    checksum: lineageChecksum(doc),
    topology: doc.topology,
    length: doc.length,
    step,
  };
  return doc.setMetadata({ lineage: pruneLineage(root) });
}

/** How many molecules a lineage holds, counting those an `elided` step stands for. */
export function lineageSize(node: LineageNode): number {
  const step = node.step;
  if (step === null) return 1;
  if (step.op === 'elided') return 1 + step.nodes;
  let n = 1;
  for (const p of step.parents) n += lineageSize(p);
  return n;
}

/** How many nodes a lineage actually holds, `elided` markers counting as nothing below them. */
export function lineageNodeCount(node: LineageNode): number {
  let n = 1;
  for (const p of node.step?.parents ?? []) n += lineageNodeCount(p);
  return n;
}

/** How deep a lineage goes: 0 for a leaf. */
export function lineageDepth(node: LineageNode): number {
  let d = 0;
  for (const p of node.step?.parents ?? []) d = Math.max(d, 1 + lineageDepth(p));
  return d;
}

/**
 * A lineage cut down to `maxNodes` molecules and `maxDepth` levels, nearest
 * first. The tree is walked breadth first and a step is kept whole or not at
 * all — half of a ligation's parents would be a false account of it — so a
 * step that does not fit becomes an `elided` marker counting what it stood
 * for, and the molecule it made stays, with its name and checksum. A tree
 * inside the limits comes back as it is.
 */
export function pruneLineage(
  root: LineageNode,
  maxNodes: number = MAX_LINEAGE_NODES,
  maxDepth: number = MAX_LINEAGE_DEPTH,
): LineageNode {
  if (lineageNodeCount(root) <= maxNodes && lineageDepth(root) <= maxDepth) return root;
  const expanded = new Set<string>();
  let kept = 1;
  const queue: { readonly node: LineageNode; readonly path: string; readonly depth: number }[] = [
    { node: root, path: '', depth: 0 },
  ];
  // The queue grows as it is walked, which a for-of over an array follows.
  for (const item of queue) {
    const step = item.node.step;
    if (step === null || step.op === 'elided') continue;
    if (item.depth + 1 > maxDepth || kept + step.parents.length > maxNodes) continue;
    kept += step.parents.length;
    expanded.add(item.path);
    step.parents.forEach((p, k) => {
      queue.push({ node: p, path: `${item.path}/${String(k)}`, depth: item.depth + 1 });
    });
  }
  const rebuild = (node: LineageNode, path: string): LineageNode => {
    const step = node.step;
    if (step === null || step.op === 'elided') return node;
    if (!expanded.has(path)) {
      // Capped where a count stops fitting a file's nine digits; a tree that
      // size is a curiosity, and "a great many" is the truth about it.
      const nodes = Math.min(lineageSize(node) - 1, 999_999_999);
      return { ...node, step: { op: 'elided', parents: [], nodes } };
    }
    return {
      ...node,
      step: { ...step, parents: step.parents.map((p, k) => rebuild(p, `${path}/${String(k)}`)) },
    };
  };
  return rebuild(root, '');
}

/** Every checksum in a lineage, root first, each once. */
export function lineageChecksums(node: LineageNode): string[] {
  const out = new Set<string>();
  const walk = (n: LineageNode): void => {
    if (n.checksum !== null) out.add(n.checksum);
    for (const p of n.step?.parents ?? []) walk(p);
  };
  walk(node);
  return [...out];
}

// ---------------------------------------------------------------- shape check

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isStringList(v: unknown): boolean {
  return Array.isArray(v) && v.every(isString);
}

function isFlags(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n && v.every((b) => typeof b === 'boolean');
}

function isPrimer(v: unknown): boolean {
  return isObject(v) && isString(v['name']) && isString(v['sequence']);
}

/**
 * Every kind of step. A record of the union rather than a list, so that a
 * kind added to `LineageStep` and left out here does not compile: one left
 * out would make every tree carrying it unreadable, silently (#85).
 */
const OP_NAMES: Readonly<Record<LineageOp, true>> = {
  digest: true,
  pcr: true,
  ligation: true,
  'golden-gate': true,
  gibson: true,
  gateway: true,
  mutagenesis: true,
  phosphates: true,
  edited: true,
  other: true,
  elided: true,
};

const OPS: ReadonlySet<string> = new Set(Object.keys(OP_NAMES));

function isStep(v: unknown, depth: number): boolean {
  if (!isObject(v) || !isString(v['op']) || !OPS.has(v['op'])) return false;
  const op = v['op'] as LineageOp;
  const parents = v['parents'];
  if (!Array.isArray(parents)) return false;
  const count = parentCount(op);
  if (count === 'some' ? parents.length === 0 : parents.length !== count) return false;
  if (!parents.every((p) => isNode(p, depth + 1))) return false;
  const n = parents.length;
  switch (op) {
    case 'digest': {
      const range = v['range'];
      return (
        isStringList(v['enzymes']) &&
        isObject(range) &&
        isCount(range['start']) &&
        isCount(range['end']) &&
        range['start'] < range['end'] &&
        isCount(v['uncut'])
      );
    }
    case 'pcr':
      return (
        isPrimer(v['forward']) &&
        isPrimer(v['reverse']) &&
        (v['polymerase'] === 'proofreading' || v['polymerase'] === 'taq')
      );
    case 'ligation':
      return typeof v['circular'] === 'boolean' && isFlags(v['flipped'], n);
    case 'golden-gate':
      return isStringList(v['enzymes']) && isFlags(v['flipped'], n);
    case 'gibson':
      return (
        (v['kit'] === 'gibson' || v['kit'] === 'in-fusion' || v['kit'] === 'nebuilder') &&
        typeof v['circular'] === 'boolean' &&
        isCount(v['overlap']) &&
        isFlags(v['flipped'], n)
      );
    case 'gateway':
      return (
        (v['reaction'] === 'BP' || v['reaction'] === 'LR') && typeof v['byproduct'] === 'boolean'
      );
    case 'mutagenesis':
      return (
        isString(v['change']) &&
        (v['method'] === 'back-to-back' || v['method'] === 'overlapping') &&
        isStringList(v['primers'])
      );
    case 'phosphates':
      return typeof v['removed'] === 'boolean';
    case 'edited':
      return true;
    case 'other':
      return isString(v['name']);
    case 'elided':
      return isCount(v['nodes']);
  }
}

function isNode(v: unknown, depth: number): boolean {
  if (depth > MAX_LINEAGE_DEPTH || !isObject(v)) return false;
  return (
    isString(v['name']) &&
    (v['checksum'] === null || isString(v['checksum'])) &&
    (v['topology'] === 'linear' || v['topology'] === 'circular') &&
    isCount(v['length']) &&
    (v['step'] === null || isStep(v['step'], depth))
  );
}

/**
 * Whether a value read back from storage is a lineage this build can use:
 * every node and step of the right shape, each step with the number of
 * parents its kind takes, and no deeper than the limit.
 */
export function isLineageNode(v: unknown): v is LineageNode {
  return isNode(v, 0);
}
