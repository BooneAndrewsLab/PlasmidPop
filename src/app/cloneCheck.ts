import {
  type CloneGeometry,
  type DigestFragment,
  type Enzyme,
  type LineageNode,
  type PcrPrimer,
  type SeqDocument,
  activeEnzymes,
  assemblyJunctions,
  cuttableSites,
  digest,
  documentChecksum,
  emptyVector,
  findCutSites,
  flipFragment,
  locateInsert,
  partJunctions,
} from '@/core';

import { analytics } from './analytics';
import { openPrimerWorkspace } from './primerWorkspace';
import { type OpenStorage, editorStore } from './state/editorStore';

/**
 * What a reaction knows about its product that the clone-check designer
 * (item 120, #311) needs and the product's own document does not carry:
 * where the insert is, what a colony without it would carry, whether the
 * insert could have gone in the other way, and the primers the method
 * designed, which the check can reuse.
 *
 * It is kept for the session only, by the product's checksum, so the
 * product opened by Simulate or Assemble finds it from its own tab; a
 * product reopened from storage, or edited, has none and the page falls
 * back to the selection as the insert.
 */
export interface CloneCheckContext {
  /** The reaction, as the page names it: "Ligation", "Golden Gate"… */
  readonly method: string;
  readonly geometry: CloneGeometry;
  /** The molecule a colony without the insert carries, or null with `emptyNote` saying why. */
  readonly empty: SeqDocument | null;
  readonly emptyNote: string | null;
  readonly orientation: 'open' | 'fixed';
  /** Why the orientation is open or fixed, one sentence. */
  readonly orientationNote: string;
  /** The primers the method designed for the insert, to reuse one of. */
  readonly primers: readonly PcrPrimer[];
}

const contexts = new Map<string, CloneCheckContext>();

function keyOf(product: SeqDocument): string | null {
  return documentChecksum(product)?.text ?? null;
}

export function registerCloneCheck(product: SeqDocument, context: CloneCheckContext): void {
  const key = keyOf(product);
  if (key !== null) contexts.set(key, context);
}

/** The context registered for this molecule, or null: edited since, or opened from storage. */
export function recallCloneCheck(product: SeqDocument): CloneCheckContext | null {
  const key = keyOf(product);
  return key === null ? null : (contexts.get(key) ?? null);
}

/** Forgets every context, for tests. */
export function forgetCloneChecks(): void {
  contexts.clear();
}

/** One part of a reaction's tube: its document, and its shelf fragment when it has one. */
export interface CheckPart {
  readonly document: SeqDocument;
  readonly fragment?: DigestFragment;
}

/** The longest part, which is what a vector most likely is. */
export function longestPart<P extends CheckPart>(parts: readonly P[]): P | undefined {
  return parts.reduce<P | undefined>(
    (best, p) => (best === undefined || p.document.length > best.document.length ? p : best),
    undefined,
  );
}

const NO_EMPTY = {
  cannotClose:
    'The cut vector cannot close on itself (its ends do not join, or were dephosphorylated), so a colony without the insert is unlikely; there is no empty vector to check against.',
  pcr: 'The vector is a PCR product with no phosphates to close with, so there is no empty vector to check against.',
} as const;

/**
 * The context for a product made from `parts` with `vector` among them, by
 * any method that keeps the vector's backbone: the insert is what the
 * product does not share with the vector, the empty vector is the vector
 * as it went in or closed on itself (`emptyVector`, as Check by digest
 * has it), and the other parts give the junctions between them. Null when
 * the vector is nowhere on the product.
 */
export function cloneCheckFromParts(
  product: SeqDocument,
  vector: CheckPart,
  others: readonly CheckPart[],
  method: string,
  orientation: { readonly open: boolean; readonly note: string },
  primers: readonly PcrPrimer[] = [],
): CloneCheckContext | null {
  const geometry = locateInsert(
    product,
    vector.document,
    others.map((p) => p.document),
  );
  if (geometry === null) return null;
  const empty = emptyVector(vector.fragment ?? vector.document);
  return {
    method,
    geometry,
    empty,
    emptyNote:
      empty !== null
        ? null
        : vector.document.ends === null && !vector.document.isCircular
          ? NO_EMPTY.pcr
          : NO_EMPTY.cannotClose,
    orientation: orientation.open ? 'open' : 'fixed',
    orientationNote: orientation.note,
    primers,
  };
}

/**
 * Whether a ligation's insert could have gone in the other way round: some
 * part other than the vector, turned over, still joins at both ends. One
 * enzyme at both ends, or blunt ends, leave it open; two different sticky
 * ends fix it.
 */
export function ligationOrientation(
  parts: readonly DigestFragment[],
  vectorIndex: number,
  circular: boolean,
): { readonly open: boolean; readonly note: string } {
  const open = parts.some((_, i) => {
    if (i === vectorIndex) return false;
    const turned = parts.map((p, k) => (k === i ? flipFragment(p) : p));
    return assemblyJunctions(turned, circular).every((j) => j.compatible);
  });
  return {
    open,
    note: open
      ? 'The insert’s ends join the vector either way round, so a colony may carry it reversed.'
      : 'The two ends differ, so the insert can only have gone in this way round.',
  };
}

export const FIXED_BY = {
  overhangs: 'The overhangs direct each part, so the insert can only have gone in this way round.',
  homology: 'The homology arms direct the insert, so it can only have gone in this way round.',
  att: 'The att sites direct the insert, so it can only have gone in this way round.',
} as const;

/** The longest piece `enzymes` cut out of `doc`, as the Cloning tab's digest would cut it. */
function longestPiece(doc: SeqDocument, enzymes: readonly Enzyme[]): DigestFragment | undefined {
  const text = doc.sequence.toString();
  const sites = cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, enzymes),
    (name) => enzymes.find((e) => e.name === name)?.site.length ?? 0,
  );
  return [...digest(doc, sites)].sort((a, b) => b.sequence.length - a.sequence.length)[0];
}

/**
 * The context for a restriction-cloning product the primer workspace
 * simulated (item 108): the vector cut with the pair's enzymes and the
 * amplicon cut with them are the two parts a ligation would join, so the
 * empty vector is the backbone closed on itself (one enzyme) or nothing
 * (two), and the orientation is open when the piece joins either way.
 */
export function restrictionCloningContext(
  product: SeqDocument,
  vector: SeqDocument,
  amplicon: SeqDocument,
  enzymeNames: readonly string[],
  primers: readonly PcrPrimer[],
): CloneCheckContext | null {
  const table = activeEnzymes();
  const enzymes = [...new Set(enzymeNames)]
    .map((name) => table.find((e) => e.name === name))
    .filter((e): e is Enzyme => e !== undefined);
  const backbone = longestPiece(vector, enzymes);
  const piece = longestPiece(amplicon, enzymes);
  if (backbone === undefined || piece === undefined) return null;
  return cloneCheckFromParts(
    product,
    { document: vector, fragment: backbone },
    [{ document: amplicon }],
    'cloning',
    ligationOrientation([backbone, piece], 0, true),
    primers,
  );
}

/**
 * The context for an overlap-extension fusion (item 79): a linear PCR
 * product with no vector, so the whole molecule is the insert and the
 * junctions are where the fragments were joined; a pair across each one
 * confirms that join. There is no empty vector and no other orientation.
 * Null when the fragments are not found on the product.
 */
export function fusionContext(
  product: SeqDocument,
  fragments: readonly SeqDocument[],
  primers: readonly PcrPrimer[],
): CloneCheckContext | null {
  const insert = { start: 0, end: product.length };
  const junctions = partJunctions(product, insert, fragments);
  if (junctions.length === 0) return null;
  return {
    method: 'Overlap PCR',
    geometry: { insert, junctions },
    empty: null,
    emptyNote:
      'A fusion is a PCR product, not a clone: there is no empty vector. The pairs confirm each join instead.',
    orientation: 'fixed',
    orientationNote: 'The overlaps direct each fragment, so the joins can only be this way round.',
    primers,
  };
}

/** The primers the PCR and mutagenesis steps of a lineage used, each once, nearest the product first. */
export function lineagePrimers(root: LineageNode | null): PcrPrimer[] {
  const out: PcrPrimer[] = [];
  const seen = new Set<string>();
  const add = (p: PcrPrimer): void => {
    if (p.sequence === '' || seen.has(p.sequence)) return;
    seen.add(p.sequence);
    out.push(p);
  };
  const walk = (node: LineageNode): void => {
    const step = node.step;
    if (step === null) return;
    if (step.op === 'pcr') {
      add(step.forward);
      add(step.reverse);
    } else if (step.op === 'mutagenesis') {
      step.primers.forEach((sequence, i) => {
        add({ name: `${node.name} ${i === 0 ? 'fwd' : 'rev'}`, sequence });
      });
    }
    for (const parent of step.parents) walk(parent);
  };
  if (root !== null) walk(root);
  return out;
}

/**
 * Opens a product as a tab with its context registered, and the primer
 * workspace on the clone-check page for it: what "Check primers…" on a
 * Bench result or a Simulate pane does.
 */
export function openCloneCheck(
  product: SeqDocument,
  context: CloneCheckContext | null,
  storage: OpenStorage,
  method: string,
): void {
  if (context !== null) registerCloneCheck(product, context);
  analytics.track('primers', 'check-open', method);
  const id = editorStore.openDocument(product, null, [], storage);
  openPrimerWorkspace(id, 'clone');
}
