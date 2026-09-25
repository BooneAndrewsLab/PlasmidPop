import {
  type Enzyme,
  activeEnzymes,
  findCutSites,
  isDoubleCutter,
  isTypeIIS,
  overhangLength,
} from '../analysis/restriction';
import { codeMask, matchPositions, patternMasks, sequenceMasks } from '../analysis/search';
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
  /** For `site`: the enzyme whose site it still carries. */
  readonly enzyme?: string;
}

/** A part in the product, as it goes in. */
export interface AssembledPart {
  /** The piece, already turned the way it is joined. */
  readonly fragment: DigestFragment;
  /** Whether it had to be turned around for its overhangs to meet. */
  readonly flipped: boolean;
  /** The document in the tube it was cut from, so the product can name its parents (#67). */
  readonly document: SeqDocument;
}

export interface GoldenGateAssembly {
  /** The parts in the order they join. */
  readonly order: readonly AssembledPart[];
  readonly product: SeqDocument;
  /**
   * Overhangs in the set that could join the wrong partner (#11): the
   * product is what the design intends, but the tube may hold others.
   */
  readonly warnings: readonly OverhangWarning[];
}

/** A risk in a set of overhangs, in a sentence, with the overhangs it is about. */
export interface OverhangWarning {
  readonly overhangs: readonly string[];
  readonly text: string;
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
  /**
   * A second Type IIS enzyme in the same tube (#11), for parts made for
   * different enzymes. Every part is cut by both, and a piece keeping either
   * site is cut again.
   */
  readonly secondEnzyme?: Enzyme;
  /** Name for the product; a description of the parts by default. */
  readonly name?: string;
}

/**
 * The enzymes worth offering for a Golden Gate: those that cut outside their
 * site and leave an overhang to join by. A blunt Type IIS cutter (MlyI) has
 * nothing to assemble with, and a double cutter (BcgI) cuts on both sides of
 * its site, so no part keeps an end of the enzyme's making on one side only.
 */
export function goldenGateEnzymes(): readonly Enzyme[] {
  return activeEnzymes().filter((e) => isTypeIIS(e) && overhangLength(e) > 0 && !isDoubleCutter(e));
}

/** Enzymes a Golden Gate is usually done with, offered first. */
const PREFERRED = ['BsaI', 'BsmBI', 'BbsI', 'SapI'];

/** The enzyme to start the picker on: BsaI if it is in the table. */
export function defaultGoldenGateEnzyme(): Enzyme | undefined {
  const usable = goldenGateEnzymes();
  for (const name of PREFERRED) {
    const found = usable.find((e) => e.name === name);
    if (found !== undefined) return found;
  }
  return usable[0];
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

/** Cuts one document with the enzymes; an uncut circle gives nothing. */
function digestWith(doc: SeqDocument, enzymes: readonly Enzyme[]): DigestFragment[] {
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, enzymes));
}

/** The enzymes in the tube, and their names as a sentence says them. */
function enzymesOf(options: GoldenGateOptions): readonly Enzyme[] {
  const { enzyme, secondEnzyme } = options;
  return secondEnzyme === undefined || secondEnzyme.name === enzyme.name
    ? [enzyme]
    : [enzyme, secondEnzyme];
}

function namesOf(enzymes: readonly Enzyme[]): string {
  return enzymes.map((e) => e.name).join(' and ');
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
  const enzymes = enzymesOf(options);
  const names = namesOf(enzymes);
  const usable: DigestFragment[] = [];
  /** The document each usable piece was cut from, by index. */
  const from: SeqDocument[] = [];
  const dropped: DroppedFragment[] = [];
  for (const doc of parts) {
    for (const fragment of digestWith(doc, enzymes)) {
      const kept = enzymes.find((e) => containsSite(fragment.sequence, e));
      if (kept !== undefined) {
        dropped.push({ fragment, reason: 'site', enzyme: kept.name });
      } else if (fragment.left.kind === 'blunt' || fragment.right.kind === 'blunt') {
        dropped.push({ fragment, reason: 'blunt' });
      } else {
        usable.push(fragment);
        from.push(doc);
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
  const firstFrom = from[0];
  if (first === undefined || firstFrom === undefined) {
    return fail(
      `Nothing to assemble: no piece of the ${names} digest kept two sticky ends and lost its ${enzymes.length === 1 ? `${names} site` : 'sites'}.`,
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

  const order: AssembledPart[] = [{ fragment: first, flipped: false, document: firstFrom }];
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
    order.push({
      fragment: only.fragment,
      flipped: only.flipped,
      document: from[only.index] ?? firstFrom,
    });
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
      metadata: { description: describeGoldenGate(order, names) },
    },
  );
  const warnings = overhangWarnings(order.map((p) => p.fragment.left.overhang));
  return { usable, dropped, assembly: { order, product, warnings }, problem: null };
}

/** "pICH+insert1+insert2 assembly", from the documents the parts came from. */
export function defaultProductName(order: readonly AssembledPart[]): string {
  const sources = [...new Set(order.map((p) => p.fragment.source))];
  return `${sources.join('+')} assembly`;
}

function describeGoldenGate(order: readonly AssembledPart[], enzymes: string): string {
  const parts = order.map(({ fragment, flipped }) => {
    const turned = flipped ? ', flipped' : '';
    const size = fragment.sequence.length.toLocaleString();
    return `${fragment.source} (${size} bp, ${fragment.left.overhang.toUpperCase()}${turned})`;
  });
  return `Golden Gate assembly with ${enzymes} of ${parts.join(', ')}`;
}

/** What to say about a piece the reaction leaves out. */
export function describeDropped(dropped: DroppedFragment): string {
  return dropped.reason === 'site'
    ? `still carries the ${dropped.enzyme ?? 'enzyme'} site, so the reaction cuts it again`
    : 'has a blunt end, so there is no overhang to join it by';
}

/** Positions at which two overhangs cannot be the same base. */
function mismatches(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if ((codeMask(a.charAt(i)) & codeMask(b.charAt(i))) === 0) n++;
  }
  return n;
}

/**
 * What in a set of junction overhangs could make a ligase join the wrong
 * ends (#11). The rules are the usual design ones: an overhang that is its
 * own reverse complement lets a part join a copy of itself back to front;
 * two overhangs one base apart, read either way (a ligase pairs an overhang
 * with the complement of the other's too), are mis-joined at a measurable
 * rate; and an ambiguity code pairs with every base it stands for. These are
 * warnings, not refusals: the set can still work, and a designer who knows
 * the fidelity data for their ligase may have chosen it on purpose.
 */
export function overhangWarnings(overhangs: readonly string[]): OverhangWarning[] {
  const out: OverhangWarning[] = [];
  const set = overhangs.map((o) => o.toUpperCase());
  for (const o of set) {
    if (/[^ACGT]/.test(o)) {
      out.push({
        overhangs: [o],
        text: `${o} has an ambiguity code, so it pairs with every overhang it could stand for.`,
      });
    } else if (o.length > 0 && o === reverseComplement(o)) {
      out.push({
        overhangs: [o],
        text: `${o} is its own reverse complement, so a part can join a copy of itself back to front.`,
      });
    }
  }
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const a = set[i] ?? '';
      const b = set[j] ?? '';
      if (a.length !== b.length || a.length === 0) continue;
      const same = mismatches(a, b);
      const turned = mismatches(a, reverseComplement(b));
      if (same === 1) {
        out.push({
          overhangs: [a, b],
          text: `${a} and ${b} differ at one base, so a ligase may join one in place of the other.`,
        });
      } else if (turned <= 1) {
        out.push({
          overhangs: [a, b],
          text:
            turned === 0
              ? `${a} pairs with ${b} turned around, so the parts at those junctions can swap.`
              : `${a} is one base from ${b} turned around (${reverseComplement(b)}), so a ligase may join them.`,
        });
      }
    }
  }
  return out;
}
