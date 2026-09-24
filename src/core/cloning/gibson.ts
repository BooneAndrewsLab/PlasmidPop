import { BLUNT_END, type SeqDocument, fragmentFromRange } from '../document';
import { meltingTemperature } from '../primers/thermo';
import { type DigestFragment } from './digest';
import { ligate } from './ligate';
import { reverseComplement } from '../sequence';

/**
 * Gibson assembly.
 *
 * Every piece is made to end in the same 15–40 bases as the piece it is to
 * join — by the tails of the primers it was amplified with, usually. In the
 * tube an exonuclease chews back one strand of each end, the matching single
 * strands anneal, a polymerase fills the gaps and a ligase seals them. What
 * comes out is seamless: the shared stretch is in the product **once**, and
 * there is no scar, no site and no enzyme in the sequence.
 *
 * So there is nothing to digest here and no overhang table to consult, as
 * there is for a restriction ligation or a Golden Gate (`goldenGate.ts`).
 * The whole reaction is: which end matches which, and is that order forced.
 * This looks for the longest shared stretch between the end of one piece and
 * the start of another, follows the chain, and refuses with a sentence
 * rather than guessing when two pieces could follow the same one.
 *
 * What it checks beyond the order (`gibsonWarnings`, #12): homology that
 * turns up elsewhere in the tube, pieces short enough to be chewed away, and
 * overlaps short for the number of pieces. It does not model the chew-back
 * itself, whose rate depends on the mix and the temperature.
 */

/** Why a document cannot be a Gibson part. */
export type GibsonDropReason = 'circular' | 'short';

export interface DroppedPart {
  readonly document: SeqDocument;
  readonly reason: GibsonDropReason;
}

/** The homology two parts share, which ends up in the product once. */
export interface GibsonJoin {
  /** The shared bases, as the upstream part's 3′ end reads them. */
  readonly overlap: string;
  readonly length: number;
  /**
   * Melting temperature of the overlap. Gibson's own protocol anneals at
   * 50 °C, so an overlap much below that is where an assembly fails without
   * anything looking wrong in the sequence.
   */
  readonly tm: number;
}

/** A part in the product, in the orientation it goes in. */
export interface GibsonPart {
  readonly document: SeqDocument;
  /** Whether it had to be turned around for its ends to meet its neighbours'. */
  readonly flipped: boolean;
}

export interface GibsonAssembly {
  readonly order: readonly GibsonPart[];
  /** One per join, in order; the last closes the circle when circular. */
  readonly joins: readonly GibsonJoin[];
  readonly product: SeqDocument;
  /**
   * What could make the tube give something else, or nothing (#12): a
   * junction's homology found elsewhere, a part the exonuclease may eat, an
   * overlap short for the number of pieces. The product is still the design.
   */
  readonly warnings: readonly GibsonWarning[];
}

export interface GibsonWarning {
  readonly kind: 'repeat' | 'short-part' | 'short-overlap';
  readonly text: string;
}

export interface GibsonResult {
  readonly usable: readonly SeqDocument[];
  readonly dropped: readonly DroppedPart[];
  readonly assembly: GibsonAssembly | null;
  /** What stopped it, in a sentence for the user; null when it worked. */
  readonly problem: string | null;
}

export interface GibsonOptions {
  /** Shortest homology to accept. NEB's kit asks for 15 or more. */
  readonly minOverlap?: number;
  /**
   * Longest stretch to look for. Not a limit on the design — a longer shared
   * end is simply reported at this length — but a bound on the search, and a
   * guard against two parts that share hundreds of bases being read as a
   * junction when what they really share is a whole feature.
   */
  readonly maxOverlap?: number;
  /** Whether the product closes into a circle. A plasmid does. */
  readonly circular?: boolean;
  readonly name?: string;
}

export const GIBSON_DEFAULTS = {
  minOverlap: 15,
  maxOverlap: 60,
  circular: true,
} as const;

/**
 * The longest suffix of `a` that is also a prefix of `b`, within the given
 * bounds; 0 when there is none. Longest first, because a designed overlap of
 * 30 bases also has a 15-base suffix that matches, and the designed one is
 * the true junction.
 */
export function terminalOverlap(a: string, b: string, min: number, max: number): number {
  const limit = Math.min(max, a.length, b.length);
  for (let n = limit; n >= min; n--) {
    if (a.slice(a.length - n).toUpperCase() === b.slice(0, n).toUpperCase()) return n;
  }
  return 0;
}

/** One oriented candidate: a part as itself or turned around. */
interface Oriented {
  /** Index into the usable list, so a part is used only once. */
  readonly index: number;
  readonly document: SeqDocument;
  readonly flipped: boolean;
  readonly sequence: string;
}

function joinOf(overlap: string): GibsonJoin {
  return { overlap, length: overlap.length, tm: meltingTemperature(overlap) };
}

/**
 * Runs the reaction. `parts` are the linear pieces in the tube, in any
 * order: which follows which is the answer, not the question.
 */
export function gibson(parts: readonly SeqDocument[], options: GibsonOptions = {}): GibsonResult {
  const { minOverlap, maxOverlap, circular } = { ...GIBSON_DEFAULTS, ...options };
  const usable: SeqDocument[] = [];
  const dropped: DroppedPart[] = [];
  for (const doc of parts) {
    if (doc.isCircular) dropped.push({ document: doc, reason: 'circular' });
    else if (doc.length <= minOverlap) dropped.push({ document: doc, reason: 'short' });
    else usable.push(doc);
  }

  const fail = (problem: string): GibsonResult => ({
    usable,
    dropped,
    assembly: null,
    problem,
  });

  const first = usable[0];
  if (first === undefined) {
    return fail('Nothing to assemble: no part has two ends to join by.');
  }
  if (usable.length === 1 && !circular) {
    return fail('One part and a linear product is not an assembly.');
  }
  // One part and a circular product is: a piece whose own two ends share
  // homology closes on itself, which is how a PCR product is circularised.

  // Both ways round for every part but the first, whose orientation is free:
  // the assembly through it flipped is the same molecule read from the
  // other strand.
  const candidates: Oriented[] = [];
  for (const [index, document] of usable.entries()) {
    if (index > 0) {
      const flipped = document.reverseComplement();
      candidates.push({
        index,
        document: flipped,
        flipped: true,
        sequence: flipped.sequence.toString(),
      });
    }
    candidates.push({ index, document, flipped: false, sequence: document.sequence.toString() });
  }

  const order: Oriented[] = [
    { index: 0, document: first, flipped: false, sequence: first.sequence.toString() },
  ];
  /** `joins[i]` is the junction between `order[i]` and `order[i + 1]`. */
  const joins: GibsonJoin[] = [];
  const used = new Set<number>([0]);
  /** The unused parts, both ways round, that would follow (or precede) `seq`. */
  const around = (seq: string, after: boolean): { c: Oriented; n: number }[] =>
    candidates
      .filter((c) => !used.has(c.index))
      .map((c) => ({
        c,
        n: after
          ? terminalOverlap(seq, c.sequence, minOverlap, maxOverlap)
          : terminalOverlap(c.sequence, seq, minOverlap, maxOverlap),
      }))
      .filter((m) => m.n > 0);
  const ambiguous = (name: string, next: { c: Oriented }[], after: boolean): string => {
    const names = [...new Set(next.map((m) => m.c.document.name))];
    const end = after ? 'The end' : 'The start';
    return names.length === 1
      ? `${end} of ${name} matches ${names[0] ?? 'a part'} either way round, so the assembly is ambiguous.`
      : `${end} of ${name} matches ${names.join(' and ')}, so the assembly is ambiguous. Every junction needs homology of its own.`;
  };

  while (used.size < usable.length) {
    const tail = order[order.length - 1];
    const head = order[0];
    if (tail === undefined || head === undefined) break;
    const next = around(tail.sequence, true);
    if (next.length > 1) return fail(ambiguous(tail.document.name, next, true));
    const forward = next[0];
    if (forward !== undefined) {
      joins.push(joinOf(tail.sequence.slice(tail.sequence.length - forward.n)));
      order.push(forward.c);
      used.add(forward.c.index);
      continue;
    }
    // A circle has no first part, so following it round from any one of them
    // reaches them all; a linear product does, and the part this started
    // from may be in the middle of it. So the other direction is tried too,
    // and only for a linear product.
    if (!circular) {
      const before = around(head.sequence, false);
      if (before.length > 1) return fail(ambiguous(head.document.name, before, false));
      const back = before[0];
      if (back !== undefined) {
        joins.unshift(joinOf(back.c.sequence.slice(back.c.sequence.length - back.n)));
        order.unshift(back.c);
        used.add(back.c.index);
        continue;
      }
    }
    return fail(
      `Nothing follows ${tail.document.name}: no other part starts with its last ${minOverlap} bases or more. ${usable.length - used.size} of ${usable.length} parts were never reached.`,
    );
  }

  const last = order[order.length - 1];
  const start = order[0];
  if (last === undefined || start === undefined) return fail('Nothing to assemble.');
  let closing = 0;
  if (circular) {
    closing = terminalOverlap(last.sequence, start.sequence, minOverlap, maxOverlap);
    if (closing === 0) {
      return fail(
        `The parts do not close into a circle: ${last.document.name} does not end in the bases ${start.document.name} starts with.`,
      );
    }
    joins.push(joinOf(last.sequence.slice(last.sequence.length - closing)));
  }

  // Every shared stretch has to be in the product exactly once, so each
  // part gives up the homology it shares with the part *before* it and the
  // upstream part carries it. The closing overlap of a circle is the one
  // exception: it is taken off the *last* part's tail rather than the first
  // part's head, so the product begins where the first part does instead of
  // being that same circle written from an origin the user never chose.
  const fragments: DigestFragment[] = [];
  for (const [i, part] of order.entries()) {
    const range = {
      start: i === 0 ? 0 : (joins[i - 1]?.length ?? 0),
      end: part.sequence.length - (i === order.length - 1 ? closing : 0),
    };
    if (range.end <= range.start) {
      return fail(
        `${part.document.name} is shorter than the homology at its two ends, so there would be nothing left of it in the product.`,
      );
    }
    const piece = fragmentFromRange(part.document, range);
    fragments.push({
      sequence: piece.sequence,
      features: piece.features,
      range,
      left: BLUNT_END,
      right: BLUNT_END,
      source: part.document.name,
    });
  }

  const product = ligate(fragments, {
    name: options.name ?? defaultGibsonName(order.map((p) => p.document)),
    circular,
    metadata: { description: describeGibson(order, joins, circular) },
  });
  return {
    usable,
    dropped,
    assembly: {
      order: order.map((p) => ({ document: p.document, flipped: p.flipped })),
      joins,
      product,
      warnings: gibsonWarnings(order, joins, minOverlap),
    },
    problem: null,
  };
}

/**
 * Below this a part may be chewed back from both ends before it anneals.
 * NEB's guidance for its Gibson and NEBuilder HiFi mixes is to add pieces
 * under 200 bp in a 5-fold molar excess.
 */
export const GIBSON_SHORT_PART = 200;

/** Bases of a window that the repeat search keys on; 15 fit a 32-bit code. */
const SEED = 15;

/** 2-bit code per base by char code, -1 for anything else. */
const BASE_CODE: readonly number[] = (() => {
  const out: number[] = new Array<number>(128).fill(-1);
  out['A'.charCodeAt(0)] = 0;
  out['C'.charCodeAt(0)] = 1;
  out['G'.charCodeAt(0)] = 2;
  out['T'.charCodeAt(0)] = 3;
  return out;
})();

/** The rolling code of the first `n` bases, or null if any is not ACGT. */
function seedCode(text: string, n: number): number | null {
  let code = 0;
  for (let i = 0; i < n; i++) {
    const bits = BASE_CODE[text.charCodeAt(i)] ?? -1;
    if (bits < 0) return null;
    code = (code << 2) | bits;
  }
  return code >>> 0;
}

/**
 * The overlap NEB's NEBuilder HiFi guidance asks for by the number of
 * pieces: 15–20 bp for two or three, 20–30 bp for four to six. The shorter
 * end of each is the floor below which a junction is flagged.
 */
function recommendedOverlap(pieces: number): number {
  return pieces <= 3 ? 15 : 20;
}

/**
 * The risks in an assembly that did come together (#12).
 *
 * The exonuclease leaves each end as a long 3′ single strand, and what
 * anneals is whatever pairs with it, not only the partner it was designed
 * for. So each junction's homology is looked for everywhere else in the
 * tube, on both strands, in windows as long as the shortest overlap the
 * reaction accepts: a hit outside the junction itself is somewhere a
 * chewed-back end could anneal instead. The two length rules are NEB's
 * guidance rather than a model of the chew-back, whose rate depends on the
 * mix and the temperature.
 */
function gibsonWarnings(
  order: readonly Oriented[],
  joins: readonly GibsonJoin[],
  minOverlap: number,
): GibsonWarning[] {
  const out: GibsonWarning[] = [];
  const k = minOverlap;
  // Each part's two strands, upper case, searched in one pass each for
  // every junction window at once: a rolling 2-bit code of the first
  // `SEED` bases finds the candidates and `startsWith` confirms them. An
  // index of every k-mer in the tube took 13 ms for six 2 kb parts, and an
  // indexOf per window 6.5 ms, against the 1 ms of the assembly itself.
  const strands = order.map((p) => {
    const forward = p.sequence.toUpperCase();
    return { forward, reverse: reverseComplement(forward) };
  });
  const windows = new Set<string>();
  for (const join of joins) {
    const overlap = join.overlap.toUpperCase();
    for (let i = 0; i + k <= overlap.length; i++) windows.add(overlap.slice(i, i + k));
  }
  const seed = Math.min(k, SEED);
  const bySeed = new Map<number, string[]>();
  for (const w of windows) {
    const code = seedCode(w, seed);
    if (code === null) continue;
    const list = bySeed.get(code);
    if (list === undefined) bySeed.set(code, [w]);
    else list.push(w);
  }
  /** Where each window occurs in the tube, both strands, forward coordinates. */
  const found = new Map<string, { part: number; start: number; reverse: boolean }[]>();
  const record = (w: string, hit: { part: number; start: number; reverse: boolean }): void => {
    const list = found.get(w);
    if (list === undefined) found.set(w, [hit]);
    else list.push(hit);
  };
  const mask = (1 << (2 * seed)) - 1;
  strands.forEach(({ forward, reverse }, part) => {
    for (const [text, isReverse] of [
      [forward, false],
      [reverse, true],
    ] as const) {
      let code = 0;
      let run = 0;
      for (let at = 0; at < text.length; at++) {
        const bits = BASE_CODE[text.charCodeAt(at)] ?? -1;
        if (bits < 0) {
          run = 0;
          code = 0;
          continue;
        }
        code = ((code << 2) | bits) & mask;
        run++;
        if (run < seed) continue;
        const start = at - seed + 1;
        const candidates = bySeed.get(code);
        if (candidates === undefined) continue;
        for (const w of candidates) {
          if (!text.startsWith(w, start)) continue;
          record(w, {
            part,
            start: isReverse ? text.length - start - k : start,
            reverse: isReverse,
          });
        }
      }
    }
  });
  const hitsOf = (window: string) => found.get(window) ?? [];

  joins.forEach((join, j) => {
    const up = j;
    const down = (j + 1) % order.length;
    const upLength = order[up]?.sequence.length ?? 0;
    // Where the homology is by design: the upstream part's last bases and
    // the downstream part's first ones, on the forward strand.
    const designed = (hit: { part: number; start: number; reverse: boolean }): boolean =>
      !hit.reverse &&
      ((hit.part === up && hit.start >= upLength - join.length) ||
        (hit.part === down && hit.start + k <= join.length));
    const overlap = join.overlap.toUpperCase();
    // Hits of neighbouring windows are one stretch; it is reported once, from
    // where it starts on the forward strand.
    const stretches = new Map<string, { part: number; start: number; reverse: boolean }>();
    for (let i = 0; i + k <= overlap.length; i++) {
      for (const hit of hitsOf(overlap.slice(i, i + k))) {
        if (designed(hit)) continue;
        const key = `${hit.part}:${hit.reverse}:${Math.floor(hit.start / 100)}`;
        const known = stretches.get(key);
        if (known === undefined || hit.start < known.start) stretches.set(key, hit);
      }
    }
    for (const hit of stretches.values()) {
      const where = order[hit.part]?.document.name ?? 'a part';
      const from = order[up]?.document.name ?? 'one part';
      const to = order[down]?.document.name ?? 'the next';
      out.push({
        kind: 'repeat',
        text: `The homology joining ${from} to ${to} also occurs in ${where} at ${(hit.start + 1).toLocaleString()}${hit.reverse ? ' (other strand)' : ''}, where a chewed-back end could anneal instead.`,
      });
    }
  });

  for (const p of order) {
    if (p.sequence.length < GIBSON_SHORT_PART) {
      out.push({
        kind: 'short-part',
        text: `${p.document.name} is ${p.sequence.length} bp; the exonuclease may chew a piece under ${GIBSON_SHORT_PART} bp away before it anneals, so add it in excess (NEB suggests 5-fold).`,
      });
    }
  }
  const floor = recommendedOverlap(order.length);
  const short = joins.filter((j) => j.length < floor);
  if (short.length > 0 && floor > minOverlap) {
    out.push({
      kind: 'short-overlap',
      text: `${order.length} pieces want overlaps of ${floor} bp or more; ${short.length === 1 ? 'one junction has' : `${short.length} junctions have`} ${[...new Set(short.map((j) => j.length))].join(', ')} bp.`,
    });
  }
  return out;
}

/** "vector+insert1+insert2 assembly", from the parts that went in. */
export function defaultGibsonName(parts: readonly SeqDocument[]): string {
  return `${[...new Set(parts.map((d) => d.name))].join('+')} assembly`;
}

function describeGibson(
  order: readonly Oriented[],
  joins: readonly GibsonJoin[],
  circular: boolean,
): string {
  const parts = order.map((p, i) => {
    const turned = p.flipped ? ', flipped' : '';
    const join = joins[i];
    const into = join === undefined ? '' : `, ${join.length} bp overlap`;
    return `${p.document.name} (${p.document.length.toLocaleString()} bp${turned}${into})`;
  });
  return `${circular ? 'Circular' : 'Linear'} Gibson assembly of ${parts.join(', ')}`;
}

/** What to say about a document the reaction cannot take. */
export function describeGibsonDropped(dropped: DroppedPart, minOverlap: number): string {
  return dropped.reason === 'circular'
    ? 'is circular, so it has no ends to join by — linearise or digest it first'
    : `is shorter than the ${minOverlap} bp of homology a junction needs`;
}
