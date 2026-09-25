import { documentFromFragment, type AssemblyPart } from '../cloning/ligate';
import { type DigestFragment, type PartialFragment } from '../cloning/digest';
import { type GatewayReaction } from '../cloning/gateway';
import { type GibsonAssembly } from '../cloning/gibson';
import { type GoldenGateAssembly } from '../cloning/goldenGate';
import { type MutagenesisDesign } from '../cloning/mutagenesis';
import { KIT_OVERLAP, type OverlapDesign, type OverlapKit } from '../cloning/overlapPrimers';
import { type PcrPrimer, type PcrProduct, type Polymerase } from '../cloning/pcr';
import { type SeqDocument } from '../document';

import {
  type HomologyKit,
  type LineageNode,
  type LineagePrimer,
  lineageChecksum,
  lineageName,
  lineageOf,
  pruneLineage,
  withLineage,
} from './lineage';

/**
 * Recording what each reaction made a product from (#67).
 *
 * These run where a reaction's result becomes something the user keeps — a
 * document opened in a tab, a fragment put on the shelf — and not in the
 * reactions themselves: the panels run `digest`, `goldenGate` and `gibson`
 * on every render to describe what they would make, and a checksum of every
 * part each time would be paid for nothing. Each function takes the result
 * and what went into it, and gives the result back with its lineage on.
 */

/** The enzymes at a fragment's two ends, left first, each once. */
function endEnzymes(fragment: DigestFragment): string[] {
  return [...new Set([fragment.left.enzyme, fragment.right.enzyme])].filter(
    (e): e is string => e !== null,
  );
}

/**
 * A digest fragment with how it was made: cut out of `source` at its range,
 * with the enzymes at its ends, and `source`'s own lineage below that. A
 * piece of a partial digest records how many sites it left uncut.
 */
export function fragmentWithLineage<F extends DigestFragment | PartialFragment>(
  fragment: F,
  source: SeqDocument,
): F {
  const uncut = 'uncut' in fragment ? fragment.uncut : 0;
  // Only its name, checksum and length are taken, none of which the
  // metadata it opens with changes.
  const doc = documentFromFragment(fragment);
  const node: LineageNode = {
    name: lineageName(doc.name),
    checksum: lineageChecksum(doc),
    topology: 'linear',
    length: doc.length,
    step: {
      op: 'digest',
      parents: [lineageOf(source)],
      enzymes: endEnzymes(fragment),
      range: { start: fragment.range.start, end: fragment.range.end },
      uncut,
    },
  };
  return { ...fragment, lineage: pruneLineage(node) };
}

/**
 * A fragment that is a whole molecule — a PCR product put on the shelf, as
 * an uncut digest of it gives it — made the way the molecule was.
 */
export function fragmentOfDocument(fragment: DigestFragment, doc: SeqDocument): DigestFragment {
  return { ...fragment, lineage: lineageOf(doc) };
}

/**
 * The lineage a shelf fragment stands for: its own, or for a fragment
 * shelved before lineages were kept, a molecule with no history under the
 * name and checksum it has.
 */
export function fragmentLineage(fragment: DigestFragment): LineageNode {
  if (fragment.lineage !== undefined) return fragment.lineage;
  const doc = documentFromFragment(fragment);
  return {
    name: lineageName(doc.name),
    checksum: lineageChecksum(doc),
    topology: 'linear',
    length: doc.length,
    step: null,
  };
}

/**
 * A shelf fragment treated with phosphatase (`dephosphorylated` true) or
 * kinase. Undoing a treatment takes its step off again rather than adding
 * the opposite one, so a vector dephosphorylated by mistake and put right
 * reads as it was cut. The checksum is of the bases, so it does not change.
 * A fragment without a lineage is only treated.
 */
export function withPhosphates(
  fragment: DigestFragment,
  dephosphorylated: boolean,
): DigestFragment {
  // A part shelved before lineages were kept has none to add a step to.
  const lineage = fragment.lineage;
  if (lineage === undefined) return { ...fragment, dephosphorylated };
  const step = lineage.step;
  const parent = step?.op === 'phosphates' ? step.parents[0] : undefined;
  if (parent !== undefined) return { ...fragment, dephosphorylated, lineage: parent };
  return {
    ...fragment,
    dephosphorylated,
    lineage: pruneLineage({
      ...lineage,
      step: { op: 'phosphates', parents: [lineage], removed: dephosphorylated },
    }),
  };
}

/** A ligation product, made of the shelf parts in the order and orientation they were joined. */
export function recordLigation(
  product: SeqDocument,
  parts: readonly Pick<AssemblyPart, 'fragment' | 'flipped'>[],
  circular: boolean,
): SeqDocument {
  return withLineage(product, {
    op: 'ligation',
    parents: parts.map((p) => fragmentLineage(p.fragment)),
    circular,
    flipped: parts.map((p) => p.flipped),
  });
}

function primerOf(primers: readonly PcrPrimer[], name: string): LineagePrimer {
  const primer = primers.find((p) => p.name === name);
  return { name, sequence: (primer?.sequence ?? '').replace(/\s+/g, '').toUpperCase() };
}

/** A PCR product, amplified from `template` by the named primers of `primers`. */
export function recordPcr(
  product: PcrProduct,
  template: SeqDocument,
  primers: readonly PcrPrimer[],
  polymerase: Polymerase,
): SeqDocument {
  return withLineage(product.document, {
    op: 'pcr',
    parents: [lineageOf(template)],
    forward: primerOf(primers, product.forward.name),
    reverse: primerOf(primers, product.reverse.name),
    polymerase,
  });
}

/** The documents a set of assembled parts came from, each once, in the order they join. */
function sourcesOf<P extends { readonly document: SeqDocument; readonly flipped: boolean }>(
  order: readonly P[],
): P[] {
  const seen = new Set<SeqDocument>();
  return order.filter((p) => {
    if (seen.has(p.document)) return false;
    seen.add(p.document);
    return true;
  });
}

/** A Golden Gate product, made of the documents its pieces were cut from. */
export function recordGoldenGate(
  assembly: GoldenGateAssembly,
  enzymes: readonly string[],
): SeqDocument {
  const sources = sourcesOf(assembly.order);
  return withLineage(assembly.product, {
    op: 'golden-gate',
    parents: sources.map((p) => lineageOf(p.document)),
    enzymes: [...enzymes],
    flipped: sources.map((p) => p.flipped),
  });
}

/** A homology assembly (Gibson, or In-Fusion/NEBuilder when designed for one). */
export function recordGibson(
  assembly: GibsonAssembly,
  options: { readonly kit: HomologyKit; readonly circular: boolean; readonly overlap: number },
): SeqDocument {
  return withLineage(assembly.product, {
    op: 'gibson',
    parents: assembly.order.map((p) => lineageOf(p.document)),
    kit: options.kit,
    circular: options.circular,
    overlap: options.overlap,
    flipped: assembly.order.map((p) => p.flipped),
  });
}

/** A Gateway clone, or its byproduct, from the att substrate or entry clone and the vector. */
export function recordGateway(
  doc: SeqDocument,
  insert: SeqDocument,
  vector: SeqDocument,
  reaction: GatewayReaction,
  byproduct: boolean,
): SeqDocument {
  return withLineage(doc, {
    op: 'gateway',
    parents: [lineageOf(insert), lineageOf(vector)],
    reaction,
    byproduct,
  });
}

/**
 * The mutant a design makes, ready to open: `template` under the mutant's
 * name, carrying the lineage of the mutant. The panel opens it and applies
 * the design's edit as the tab's first step, so the change shows as an
 * edit and Undo takes it back; the lineage's checksum is the mutant's, so
 * the mutant is the molecule as made, and the template before the edit reads
 * as edited since.
 */
export function recordMutagenesis(
  template: SeqDocument,
  design: MutagenesisDesign,
  name: string,
): SeqDocument {
  const mutant = withLineage(design.mutant.rename(name), {
    op: 'mutagenesis',
    parents: [lineageOf(template)],
    change: design.label,
    method: design.method,
    primers: [design.forward.sequence.toUpperCase(), design.reverse.sequence.toUpperCase()],
  });
  return template.rename(name).setMetadata({ lineage: mutant.metadata.lineage });
}

/**
 * The circle an In-Fusion or NEBuilder design makes: the vector and the
 * insert amplified from `template` with the designed primers, joined by
 * their homology. The amplicon is a molecule of the tree of its own, so the
 * template is two levels down. Null when the design made nothing.
 */
export function recordOverlapDesign(
  design: OverlapDesign,
  vector: SeqDocument,
  template: SeqDocument,
  kit: OverlapKit,
): SeqDocument | null {
  const { product, amplicon } = design;
  if (product === null || amplicon === null) return null;
  const pcr = withLineage(amplicon, {
    op: 'pcr',
    parents: [lineageOf(template)],
    forward: { name: 'Forward', sequence: design.forward.sequence.toUpperCase() },
    reverse: { name: 'Reverse', sequence: design.reverse.sequence.toUpperCase() },
    polymerase: 'proofreading',
  });
  return withLineage(product, {
    op: 'gibson',
    parents: [lineageOf(vector), lineageOf(pcr)],
    kit,
    circular: true,
    overlap: KIT_OVERLAP[kit],
    flipped: [false, false],
  });
}
