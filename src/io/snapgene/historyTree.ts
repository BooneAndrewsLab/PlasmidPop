import {
  type LineageNode,
  type LineageStep,
  MAX_LINEAGE_DEPTH,
  MAX_LINEAGE_NODES,
  lineageName,
} from '@/core';

import { type XmlElement, childElements, parseXml } from '../xml';

/**
 * SnapGene's own history tree, read into the lineage of item 67 (#85).
 *
 * A `.dna` file keeps how it was made in packet `0x07`: a `<HistoryTree>`
 * XML document, usually xz-compressed. Each `<Node>` is a molecule, the
 * product at the root and its ingredients nested inside it, with an
 * `operation` saying what was done and `<Oligo>` and `<InputSummary>`
 * children describing it. That is the same shape as our "Made from" tree,
 * so it is read into `LineageNode`s and shown by the same panel.
 *
 * What it cannot give is checksums: SnapGene stores none, so every node
 * comes back with `checksum: null` and the tree says "not in this browser"
 * for each, which is honest — the ancestors' own sequences are in packets
 * `0x0B`, in an encoding we have not worked out.
 */

/**
 * SnapGene's operations that are one of ours. Everything else keeps its own
 * name under `other`, which is more use than dropping the node: a tree that
 * says `newFileFromSelection` tells the reader where the piece came from.
 */
const OPERATIONS: Readonly<Record<string, LineageStep['op']>> = {
  insertFragments: 'ligation',
  replaceFragment: 'ligation',
  amplifyFragment: 'pcr',
  primerDirectedMutagenesis: 'mutagenesis',
};

function attribute(element: XmlElement, name: string): string {
  return element.attributes[name] ?? '';
}

function number(element: XmlElement, name: string): number {
  const value = Number(attribute(element, name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** The oligos of a node, in the order SnapGene lists them. */
function oligos(node: XmlElement): { name: string; sequence: string }[] {
  return childElements(node, 'Oligo')
    .map((c) => ({
      name: lineageName(attribute(c, 'name')),
      sequence: attribute(c, 'sequence').toUpperCase().replace(/\s+/g, ''),
    }))
    .filter((o) => o.sequence !== '');
}

/** What an `InputSummary` says was done, for the name of an `other` step. */
function manipulation(node: XmlElement): string {
  const [summary] = childElements(node, 'InputSummary');
  return summary === undefined ? '' : attribute(summary, 'manipulation');
}

/** The step a node's operation becomes, given the molecules that went into it. */
function stepOf(node: XmlElement, parents: readonly LineageNode[]): LineageStep | null {
  if (parents.length === 0) return null;
  const operation = attribute(node, 'operation');
  const op = OPERATIONS[operation];
  const primers = oligos(node);
  if (op === 'ligation') {
    return {
      op,
      parents,
      circular: attribute(node, 'circular') === '1',
      // SnapGene records which piece went in which way round in its
      // `InputSummary`, in a form we do not read yet; none is said to be
      // flipped rather than guessing.
      flipped: parents.map(() => false),
    };
  }
  const [forward, reverse] = primers;
  // A PCR with no oligos in the file is not a PCR we can describe.
  if (op === 'pcr' && forward !== undefined && reverse !== undefined) {
    return { op, parents, forward, reverse, polymerase: 'proofreading' };
  }
  if (op === 'mutagenesis') {
    const change = manipulation(node);
    return {
      op,
      parents,
      change: change === '' ? 'as SnapGene made it' : change,
      // SnapGene does not say which design; its own is a pair of
      // overlapping primers, which is what its oligos are.
      method: 'overlapping',
      primers: primers.map((o) => o.sequence),
    };
  }
  // `invalid` is SnapGene's word for a leaf that was opened rather than
  // made; with parents under it, it is still a step, and unnamed.
  const name = operation === '' || operation === 'invalid' ? 'made in SnapGene' : operation;
  return { op: 'other', parents, name };
}

/** One `<Node>` and everything under it, within the limits a lineage keeps. */
function nodeOf(element: XmlElement, depth: number, budget: { left: number }): LineageNode | null {
  if (depth > MAX_LINEAGE_DEPTH || budget.left <= 0) return null;
  budget.left--;
  const parents: LineageNode[] = [];
  for (const child of childElements(element, 'Node')) {
    const parent = nodeOf(child, depth + 1, budget);
    if (parent !== null) parents.push(parent);
  }
  return {
    name: lineageName(attribute(element, 'name')),
    // SnapGene stores no checksum, so no node can be looked for here.
    checksum: null,
    topology: attribute(element, 'circular') === '1' ? 'circular' : 'linear',
    length: number(element, 'seqLen'),
    step: stepOf(element, parents),
  };
}

/**
 * The lineage a SnapGene `<HistoryTree>` describes, or null when the XML is
 * not one. A tree deeper or larger than a lineage keeps is cut to the
 * limits, oldest first, as `pruneLineage` does for our own.
 */
export function readHistoryTree(xml: string): LineageNode | null {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch {
    return null;
  }
  const [first] = root.name === 'HistoryTree' ? childElements(root, 'Node') : [];
  if (first === undefined) return null;
  const node = nodeOf(first, 0, { left: MAX_LINEAGE_NODES });
  // A tree of one node with nothing under it says only that the file was
  // opened, which the document already says.
  return node?.step == null ? null : node;
}

/** The xz magic, which a `<HistoryTree>` packet usually starts with. */
const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];

function isXz(bytes: Uint8Array): boolean {
  return XZ_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * The history packet as text: plain XML in some files, xz-compressed in
 * most. `DecompressionStream` does gzip and deflate only, so the xz decoder
 * is a dependency (`xz-decompress`, MIT, WebAssembly, no dependencies of
 * its own) and is imported here, where it is used, so it is a chunk of its
 * own that a session which opens no SnapGene file never fetches.
 */
export async function historyXml(packet: Uint8Array): Promise<string | null> {
  if (!isXz(packet)) return new TextDecoder('utf-8').decode(packet);
  try {
    const { XzReadableStream } = await import('xz-decompress');
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(packet);
        controller.close();
      },
    });
    return await new Response(new XzReadableStream(source)).text();
  } catch {
    // A history we cannot decompress costs the tree, never the document.
    return null;
  }
}

/** The lineage a SnapGene file's history packet describes, when it has one. */
export async function readSnapGeneHistory(packet: Uint8Array): Promise<LineageNode | null> {
  const xml = await historyXml(packet);
  return xml === null ? null : readHistoryTree(xml);
}
