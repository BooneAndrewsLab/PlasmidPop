import {
  type Enzyme,
  ENZYMES,
  findCutSites,
  isTypeIIS,
  overhangLength,
} from '../analysis/restriction';
import { matchPositions, patternMasks, sequenceMasks } from '../analysis/search';
import { type SeqDocument, describeEnd } from '../document';
import { reverseComplement } from '../sequence';
import { type DigestFragment, digest } from './digest';
import { endsCompatible, flipFragment, ligate } from './ligate';

/**
 * Golden Gate assembly.
 *
 * Every part carries the same Type IIS enzyme's site near each of its ends,
 * placed so that the enzyme cuts on the inside: the piece that is kept comes
 * away with a four-base overhang the designer chose, and the recognition
 * site leaves with the flank. Cutting and ligating happen in one tube, so a
 * piece that still holds a site is simply cut again, and only the pieces
 * that lost theirs survive to close into a circle — in the one order their
 * overhangs allow.
 *
 * That is what this does. It digests each part with the enzyme, throws out
 * the pieces the reaction would keep re-cutting, and then follows the
 * overhangs from one piece to the next. A well-designed set has distinct
 * overhangs, so the order is forced; where it is not, the ambiguity is
 * reported rather than guessed at.
 */

/** Why a piece of the digest cannot be in the product. */
export type DropReason = 'site' | 'blunt';

export interface DroppedFragment {
  readonly fragment: DigestFragment;
  readonly reason: DropReason;
}

/** A part in the product, as it goes in. */
export interface AssembledPart {
  /** The piece, already turned the way it is joined. */
  readonly fragment: DigestFragment;
  /** Whether it had to be turned around for its overhangs to meet. */
  readonly flipped: boolean;
}

export interface GoldenGateAssembly {
  /** The parts in the order they join. */
  readonly order: readonly AssembledPart[];
  readonly product: SeqDocument;
}

export interface GoldenGateResult {
  /** Pieces that survive the reaction: no site left, and two sticky ends. */
  readonly usable: readonly DigestFragment[];
  /** Pieces the reaction re-cuts or cannot join, and why. */
  readonly dropped: readonly DroppedFragment[];
  /** The circular product, or null when the overhangs do not make one. */
  readonly assembly: GoldenGateAssembly | null;
  /** What stopped it, in a sentence for the user; null when it worked. */
  readonly problem: string | null;
}

export interface GoldenGateOptions {
  readonly enzyme: Enzyme;
  /** Name for the product; a description of the parts by default. */
  readonly name?: string;
}

/**
 * The enzymes worth offering for a Golden Gate: those that cut outside their
 * site and leave an overhang to join by. A blunt Type IIS cutter (MlyI) has
 * nothing to assemble with.
 */
export const GOLDEN_GATE_ENZYMES: readonly Enzyme[] = ENZYMES.filter(
  (e) => isTypeIIS(e) && overhangLength(e) > 0,
);

/** Enzymes a Golden Gate is usually done with, offered first. */
const PREFERRED = ['BsaI', 'BsmBI', 'BbsI', 'SapI'];

/** The enzyme to start the picker on: BsaI if it is in the table. */
export function defaultGoldenGateEnzyme(): Enzyme | undefined {
  for (const name of PREFERRED) {
    const found = GOLDEN_GATE_ENZYMES.find((e) => e.name === name);
    if (found !== undefined) return found;
  }
  return GOLDEN_GATE_ENZYMES[0];
}

/** Whether the recognition sequence is still somewhere in `sequence`, on either strand. */
function containsSite(sequence: string, enzyme: Enzyme): boolean {
  const maxStart = sequence.length - enzyme.site.length;
  if (maxStart < 0) return false;
  const masks = sequenceMasks(sequence);
  if (matchPositions(masks, patternMasks(enzyme.site), maxStart).length > 0) return true;
  if (enzyme.palindromic) return false;
  return matchPositions(masks, patternMasks(reverseComplement(enzyme.site)), maxStart).length > 0;
}

/** Cuts one document with the enzyme; an uncut circle gives nothing. */
function digestWith(doc: SeqDocument, enzyme: Enzyme): DigestFragment[] {
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, [enzyme]));
}

/** One oriented candidate: a fragment, as itself or turned around. */
interface Oriented {
  /** Index into the usable list, so a fragment is used only once. */
  readonly index: number;
  readonly fragment: DigestFragment;
  readonly flipped: boolean;
}

function describeOverhang(fragment: DigestFragment): string {
  return describeEnd(fragment.right);
}

/**
 * Runs the reaction. `parts` are the documents in the tube; the product is
 * always circular, which is what a Golden Gate is for.
 */
export function goldenGate(
  parts: readonly SeqDocument[],
  options: GoldenGateOptions,
): GoldenGateResult {
  const { enzyme } = options;
  const usable: DigestFragment[] = [];
  const dropped: DroppedFragment[] = [];
  for (const doc of parts) {
    for (const fragment of digestWith(doc, enzyme)) {
      if (containsSite(fragment.sequence, enzyme)) {
        dropped.push({ fragment, reason: 'site' });
      } else if (fragment.left.kind === 'blunt' || fragment.right.kind === 'blunt') {
        dropped.push({ fragment, reason: 'blunt' });
      } else {
        usable.push(fragment);
      }
    }
  }

  const fail = (problem: string): GoldenGateResult => ({
    usable,
    dropped,
    assembly: null,
    problem,
  });

  const first = usable[0];
  if (first === undefined) {
    return fail(
      `Nothing to assemble: no piece of the ${enzyme.name} digest kept two sticky ends and lost its ${enzyme.name} site.`,
    );
  }

  // Both ways round for every part but the first. Starting the first one
  // forwards costs nothing: the assembly through it flipped is the same
  // circle read from the other strand.
  const candidates: Oriented[] = [];
  for (const [index, fragment] of usable.entries()) {
    candidates.push({ index, fragment, flipped: false });
    candidates.push({ index, fragment: flipFragment(fragment), flipped: true });
  }

  const order: AssembledPart[] = [{ fragment: first, flipped: false }];
  const used = new Set<number>([0]);
  while (used.size < usable.length) {
    const current = order[order.length - 1]?.fragment;
    if (current === undefined) break;
    const next = candidates.filter(
      (c) => !used.has(c.index) && endsCompatible(current.right, c.fragment.left),
    );
    const only = next[0];
    if (only === undefined) {
      return fail(
        `No part starts with the overhang ${describeOverhang(current)} left by ${current.source}. ${usable.length - used.size} of ${usable.length} parts were never reached.`,
      );
    }
    if (next.length > 1) {
      const parts = new Set(next.map((c) => c.index)).size;
      return fail(
        parts === 1
          ? `The overhang ${describeOverhang(current)} lets the next part go in either way round, so the assembly is ambiguous.`
          : `The overhang ${describeOverhang(current)} fits ${parts} parts, so the assembly is ambiguous. Golden Gate needs each overhang to be unique.`,
      );
    }
    order.push({ fragment: only.fragment, flipped: only.flipped });
    used.add(only.index);
  }

  const last = order[order.length - 1]?.fragment;
  if (last === undefined || !endsCompatible(last.right, first.left)) {
    return fail(
      `The parts do not close into a circle: ${last === undefined ? 'nothing' : describeOverhang(last)} does not meet ${describeEnd(first.left)} at the start.`,
    );
  }

  const product = ligate(
    order.map((p) => p.fragment),
    {
      name: options.name ?? defaultProductName(order),
      circular: true,
      metadata: { description: describeGoldenGate(order, enzyme) },
    },
  );
  return { usable, dropped, assembly: { order, product }, problem: null };
}

/** "pICH+insert1+insert2 assembly", from the documents the parts came from. */
export function defaultProductName(order: readonly AssembledPart[]): string {
  const sources = [...new Set(order.map((p) => p.fragment.source))];
  return `${sources.join('+')} assembly`;
}

function describeGoldenGate(order: readonly AssembledPart[], enzyme: Enzyme): string {
  const parts = order.map(({ fragment, flipped }) => {
    const turned = flipped ? ', flipped' : '';
    const size = fragment.sequence.length.toLocaleString();
    return `${fragment.source} (${size} bp, ${fragment.left.overhang.toUpperCase()}${turned})`;
  });
  return `Golden Gate assembly with ${enzyme.name} of ${parts.join(', ')}`;
}

/** What to say about a piece the reaction leaves out. */
export function describeDropped(dropped: DroppedFragment, enzyme: Enzyme): string {
  return dropped.reason === 'site'
    ? `still carries the ${enzyme.name} site, so the reaction cuts it again`
    : 'has a blunt end, so there is no overhang to join it by';
}
