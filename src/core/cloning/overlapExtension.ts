import { type SeqDocument } from '../document';
import { type Feature } from '../features';
import { meltingTemperature } from '../primers/thermo';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';
import { gibson } from './gibson';
import { OVERLAP_DEFAULTS, growAnnealing, productHolding } from './overlapPrimers';
import { pcr } from './pcr';

/**
 * Overlap-extension (SOE) PCR: fusing two or more fragments by PCR alone
 * (#216), with no enzyme and no vector.
 *
 * Each fragment is amplified once with primers whose 5′ tails carry the
 * neighbour's end, so the first-round products share a stretch with the one
 * next to them. Mixed, they anneal at those stretches and extend into the
 * fused molecule, and the two outer primers amplify it. This designs the
 * oligos and then *runs* every step with the code the rest of the app uses:
 * `pcr` for each first-round product, `gibson` (linear) for the extension
 * step, `pcr` again on the fused molecule for the outer primers. A design
 * that does not come out as the fragments end to end is a design that
 * failed, not a sentence.
 *
 * At a junction the overlap is the last `a` bases of the upstream fragment
 * followed by the first `b` of the downstream one, grown until it melts at
 * the target. The downstream fragment's forward primer carries the first
 * half as its tail and the upstream fragment's reverse primer the second
 * half's reverse complement; the annealing parts are at least as long as the
 * tail they must continue, so the two inner primers are complementary over
 * the whole overlap, which is how they are usually drawn.
 */

export interface SoeFragment {
  readonly doc: SeqDocument;
  /** The stretch of `doc` that goes into the fusion, in `doc`'s own coordinates. */
  readonly range: Range;
}

export interface SoeOptions {
  /** Tm the overlap grows to. */
  readonly overlapTm?: number;
  /** Shortest and longest overlap to use, in bases. */
  readonly minOverlap?: number;
  readonly maxOverlap?: number;
  /** Tm, shortest and longest of each primer's annealing part. */
  readonly targetTm?: number;
  readonly minAnneal?: number;
  readonly maxAnneal?: number;
  /** Name of the product, and what the primers' names start with. */
  readonly name?: string;
  readonly primerPrefix?: string;
}

export const SOE_DEFAULTS = {
  overlapTm: 60,
  minOverlap: 18,
  maxOverlap: 40,
  targetTm: OVERLAP_DEFAULTS.targetTm,
  minAnneal: OVERLAP_DEFAULTS.minAnneal,
  maxAnneal: OVERLAP_DEFAULTS.maxAnneal,
} as const;

/** Below this an overlap is short, whatever the Tm asked for. */
export const SOE_SHORT_OVERLAP = 15;
/** Below this the overlap melts too low to hold the extension step. */
export const SOE_WEAK_TM = 50;

export interface SoePrimer {
  /** `SOE F1`: the prefix, then F or R and the fragment it amplifies, from 1. */
  readonly name: string;
  /** 5′→3′, as ordered: the tail in upper case, then the part that anneals. */
  readonly sequence: string;
  readonly tail: string;
  readonly annealLength: number;
  /** Melting temperature of the annealing part. */
  readonly tm: number;
  /** Index of the fragment it amplifies, from 0. */
  readonly fragment: number;
  readonly strand: 'forward' | 'reverse';
  /** An outer primer has no tail; an inner one carries a neighbour's end. */
  readonly role: 'outer' | 'inner';
}

export interface SoeJunction {
  /** Between fragment `index` and the one after it. */
  readonly index: number;
  readonly overlap: string;
  readonly length: number;
  readonly tm: number;
}

export interface SoeDesign {
  /** In ordering order: F1, R1, F2, R2, and so on. */
  readonly primers: readonly SoePrimer[];
  readonly junctions: readonly SoeJunction[];
  /** What each fragment's two primers amplify, with the tails on. */
  readonly firstRound: readonly SeqDocument[];
  /** The first-round products extended into one molecule. */
  readonly fused: SeqDocument | null;
  /** What the outer primers amplify off it: the fragments end to end. */
  readonly product: SeqDocument | null;
  readonly warnings: readonly string[];
  readonly problem: string | null;
}

function failure(problem: string, partial: Partial<SoeDesign> = {}): SoeDesign {
  return {
    primers: [],
    junctions: [],
    firstRound: [],
    fused: null,
    product: null,
    warnings: [],
    ...partial,
    problem,
  };
}

/** The overlap at a junction: the least that melts at the target, within bounds. */
function chooseOverlap(
  upstream: string,
  downstream: string,
  opts: Pick<Required<SoeOptions>, 'overlapTm' | 'minOverlap' | 'maxOverlap'>,
): { readonly a: number; readonly b: number } {
  const longest = Math.max(opts.minOverlap, opts.maxOverlap);
  let length = opts.minOverlap;
  for (;;) {
    const a = Math.ceil(length / 2);
    const b = length - a;
    const text = upstream.slice(upstream.length - a) + downstream.slice(0, b);
    if (length >= longest || meltingTemperature(text) >= opts.overlapTm) return { a, b };
    length++;
  }
}

/**
 * Designs the primers that fuse `fragments`, in the order given, and runs
 * every step of it.
 */
export function designOverlapExtension(
  fragments: readonly SoeFragment[],
  options: SoeOptions = {},
): SoeDesign {
  const opts = { ...SOE_DEFAULTS, ...options };
  const numbers = {
    overlapTm: opts.overlapTm,
    minOverlap: opts.minOverlap,
    maxOverlap: opts.maxOverlap,
    targetTm: opts.targetTm,
    minAnneal: opts.minAnneal,
    maxAnneal: opts.maxAnneal,
  };
  const prefix = options.primerPrefix ?? 'SOE ';
  const n = fragments.length;
  if (n < 2) return failure('Choose at least two fragments to fuse.');

  const texts: string[] = [];
  for (const [i, f] of fragments.entries()) {
    const text = f.doc.subsequence(f.range).toUpperCase();
    // Both primers anneal inside it, and the neighbours' tails are copied from its ends.
    if (text.length < opts.minAnneal * 2) {
      return failure(
        `Fragment ${i + 1} (${f.doc.name}) is ${text.length.toLocaleString()} bp, too short to fuse: a primer needs ${opts.minAnneal} bases at each end.`,
      );
    }
    if (/[^ACGT]/.test(text)) {
      return failure(
        `Fragment ${i + 1} (${f.doc.name}) has ambiguous bases, which primers cannot be designed over. Resolve them first.`,
      );
    }
    texts.push(text);
  }

  // Junctions first: they say how long each inner primer's tail and annealing part are.
  const cuts: { readonly a: number; readonly b: number }[] = [];
  const junctions: SoeJunction[] = [];
  for (let j = 0; j < n - 1; j++) {
    // Stryker disable next-line StringLiteral: the `?? ''` is a noUncheckedIndexedAccess fallback, never reached
    const up = texts[j] ?? '';
    // Stryker disable next-line StringLiteral: the `?? ''` is a noUncheckedIndexedAccess fallback, never reached
    const down = texts[j + 1] ?? '';
    const cut = chooseOverlap(up, down, numbers);
    cuts.push(cut);
    const overlap = up.slice(up.length - cut.a) + down.slice(0, cut.b);
    junctions.push({ index: j, overlap, length: overlap.length, tm: meltingTemperature(overlap) });
  }

  const primers: SoePrimer[] = [];
  const anneal = (read: (len: number) => string, atLeast: number, half: number): string =>
    growAnnealing(read, {
      targetTm: opts.targetTm,
      minAnneal: Math.max(opts.minAnneal, atLeast),
      maxAnneal: Math.min(Math.max(opts.maxAnneal, atLeast), Math.floor(half)),
    });
  for (const [i, text] of texts.entries()) {
    const before = i > 0 ? cuts[i - 1] : undefined;
    const after = i < n - 1 ? cuts[i] : undefined;
    // The downstream half of the previous overlap is this fragment's own start.
    const forwardPart = anneal((len) => text.slice(0, len), before?.b ?? 0, text.length / 2);
    const reversePart = anneal(
      (len) => reverseComplement(text.slice(text.length - len)),
      after?.a ?? 0,
      text.length / 2,
    );
    const forwardTail =
      before === undefined
        ? ''
        : // Stryker disable next-line StringLiteral,LogicalOperator: texts[i - 1] exists whenever `before` does
          (texts[i - 1] ?? '').slice((texts[i - 1] ?? '').length - before.a);
    const reverseTail =
      // Stryker disable next-line ConditionalExpression,OptionalChaining,StringLiteral: texts[i + 1] exists whenever `after` does
      after === undefined ? '' : reverseComplement(texts[i + 1]?.slice(0, after.b) ?? '');
    primers.push({
      name: `${prefix}F${i + 1}`,
      sequence: forwardTail + forwardPart.toLowerCase(),
      tail: forwardTail,
      annealLength: forwardPart.length,
      tm: meltingTemperature(forwardPart),
      fragment: i,
      strand: 'forward',
      role: before === undefined ? 'outer' : 'inner',
    });
    primers.push({
      name: `${prefix}R${i + 1}`,
      sequence: reverseTail + reversePart.toLowerCase(),
      tail: reverseTail,
      annealLength: reversePart.length,
      tm: meltingTemperature(reversePart),
      fragment: i,
      strand: 'reverse',
      role: after === undefined ? 'outer' : 'inner',
    });
  }

  // Round one: each fragment off its own template, with its tails.
  const firstRound: SeqDocument[] = [];
  for (const [i, f] of fragments.entries()) {
    const fwd = primers[2 * i];
    const rev = primers[2 * i + 1];
    // Stryker disable next-line all: both primers exist for every fragment; the guard narrows the index type
    if (fwd === undefined || rev === undefined) continue;
    const reaction = pcr(f.doc, [
      { name: fwd.name, sequence: fwd.sequence },
      { name: rev.name, sequence: rev.sequence },
    ]);
    // Stryker disable next-line StringLiteral: the `?? ''` is a noUncheckedIndexedAccess fallback, never reached
    const made = productHolding(reaction.products, texts[i] ?? '');
    if (made === undefined) {
      return failure(
        reaction.problem ??
          `The primers for fragment ${i + 1} (${f.doc.name}) do not amplify it: ${reaction.products.length} other ${reaction.products.length === 1 ? 'product' : 'products'} instead.`,
        { primers, junctions, firstRound },
      );
    }
    firstRound.push(
      // Stryker disable next-line OptionalChaining,StringLiteral: fragments[i] exists; the fallback only narrows the index type
      made.document.rename(`${fragments[i]?.doc.name ?? 'Fragment'} fragment ${i + 1}`),
    );
  }

  // Round two: the products anneal at their overlaps and extend into one molecule.
  const shortest = Math.min(...junctions.map((j) => j.length));
  const extension = gibson(firstRound, { minOverlap: shortest, circular: false });
  const expected = texts.join('');
  const fused = extension.assembly?.product ?? null;
  if (fused === null) {
    return failure(extension.problem ?? 'The first-round products do not join into one molecule.', {
      primers,
      junctions,
      firstRound,
    });
  }
  if (fused.sequence.toString().toUpperCase() !== expected) {
    return failure(
      'The first-round products join, but not into the fragments end to end: an overlap also matches somewhere else in them.',
      { primers, junctions, firstRound, fused },
    );
  }

  // Round three: the outer primers copy the fused molecule.
  const outerF = primers[0];
  const outerR = primers[2 * n - 1];
  const amplification = pcr(fused, [
    // Stryker disable next-line all: the outer primers exist; the fallbacks only narrow the index type
    { name: outerF?.name ?? 'F', sequence: outerF?.sequence ?? '' },
    // Stryker disable next-line all: the outer primers exist; the fallbacks only narrow the index type
    { name: outerR?.name ?? 'R', sequence: outerR?.sequence ?? '' },
  ]);
  const product = productHolding(amplification.products, expected);
  if (product?.length !== expected.length) {
    return failure(
      amplification.problem ??
        'The outer primers do not amplify the fused molecule as the fragments end to end.',
      { primers, junctions, firstRound, fused },
    );
  }
  const joined = fragments.map((f) => f.doc.name).join(' + ');
  const named = product.document.rename(options.name ?? `${joined} fusion`);

  return {
    primers,
    junctions,
    firstRound,
    fused,
    product: named,
    warnings: [
      ...junctionWarnings(junctions, fused),
      ...primerWarnings(primers, opts.targetTm),
      ...frameWarnings(fragments),
    ],
    problem: null,
  };
}

// ---------------------------------------------------------------- warnings

/** Occurrences of `needle` in `haystack`, overlapping ones included. */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
}

function junctionWarnings(junctions: readonly SoeJunction[], fused: SeqDocument): string[] {
  const out: string[] = [];
  const text = fused.sequence.toString().toUpperCase();
  for (const j of junctions) {
    const label = junctions.length === 1 ? 'The overlap' : `The overlap at junction ${j.index + 1}`;
    if (j.length < SOE_SHORT_OVERLAP || j.tm < SOE_WEAK_TM) {
      out.push(
        `${label} is ${j.length} bases melting at ${j.tm.toFixed(0)} °C, short for the extension step: lengthen it, or raise the overlap Tm.`,
      );
    }
    const rc = reverseComplement(j.overlap);
    const copies = occurrences(text, j.overlap) + (rc === j.overlap ? 0 : occurrences(text, rc));
    if (copies > 1) {
      out.push(
        `${label} (${j.overlap}) occurs ${copies} times in the fused molecule, so a first-round product can anneal at the wrong place and give a different fusion.`,
      );
    }
  }
  return out;
}

function primerWarnings(primers: readonly SoePrimer[], targetTm: number): string[] {
  const weak = primers.filter((p) => p.tm < targetTm - 5);
  return weak.length === 0
    ? []
    : [
        `${weak.map((p) => p.name).join(', ')} anneal${weak.length === 1 ? 's' : ''} below ${(targetTm - 5).toFixed(0)} °C, because the fragment gives it no room to grow: expect a poorer first round.`,
      ];
}

// ------------------------------------------------------------------- frames

/**
 * The positions a CDS reads, in reading order, and how many bases its
 * `/codon_start` skips. Positions are real ones, so a CDS over the origin
 * of a circle reads through it.
 */
function reading(doc: SeqDocument, feature: Feature): { positions: number[]; skip: number } {
  const forward: number[] = [];
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') continue;
    for (let p = seg.start; p < seg.end; p++) forward.push(p % doc.length);
  }
  const q = feature.qualifiers.find((x) => x.name === 'codon_start')?.value;
  return {
    positions: feature.strand === 'reverse' ? forward.reverse() : forward,
    skip: q === '2' ? 1 : q === '3' ? 2 : 0,
  };
}

interface Reader {
  readonly feature: Feature;
  /** Frame (0, 1 or 2) the CDS reads at the junction. */
  readonly phase: number;
}

/**
 * The CDSs on `strand` of `doc` that cover `position`, and the frame each is
 * in as the reading crosses the junction. `upstream` is the side the
 * ribosome arrives from: the fragment before the junction on the forward
 * strand, the one after it on the reverse. Arriving, it has read through the
 * base at the junction; leaving, it is about to read it.
 */
function readersAt(
  doc: SeqDocument,
  position: number,
  strand: 'forward' | 'reverse',
  arriving: boolean,
): Reader[] {
  const out: Reader[] = [];
  for (const feature of doc.features.all()) {
    if (feature.type !== 'CDS' || feature.strand !== strand) continue;
    const { positions, skip } = reading(doc, feature);
    const at = positions.indexOf(position);
    if (at < 0) continue;
    out.push({ feature, phase: ((((arriving ? at + 1 : at) - skip) % 3) + 3) % 3 });
  }
  return out;
}

function cdsName(feature: Feature): string {
  return feature.name === '' ? 'A CDS' : feature.name;
}

/**
 * A CDS that reads into another across a junction, or that spans it, must
 * keep its frame. The fragments are read where they join: the last base of
 * one and the first of the next, in the frame each had in its own template.
 * Cutting a number of bases that is not a multiple of three out of the
 * middle of a gene, or fusing a tag at a distance that is not, shifts the
 * frame, and the protein after the junction is a different one.
 */
function frameWarnings(fragments: readonly SoeFragment[]): string[] {
  const out: string[] = [];
  for (let j = 0; j + 1 < fragments.length; j++) {
    const left = fragments[j];
    const right = fragments[j + 1];
    // Stryker disable next-line all: j + 1 < length keeps both in range; the guard narrows the index type
    if (left === undefined || right === undefined) continue;
    const last = (left.range.end - 1) % left.doc.length;
    const first = right.range.start % right.doc.length;
    for (const strand of ['forward', 'reverse'] as const) {
      // Forward: the left fragment's CDS arrives, the right's departs. Reverse: the other way round.
      const arriving =
        strand === 'forward'
          ? readersAt(left.doc, last, strand, true)
          : readersAt(right.doc, first, strand, true);
      const leaving =
        strand === 'forward'
          ? readersAt(right.doc, first, strand, false)
          : readersAt(left.doc, last, strand, false);
      for (const a of arriving) {
        for (const b of leaving) {
          if (a.phase === b.phase) continue;
          const same = a.feature.id === b.feature.id;
          out.push(
            same
              ? `What is left out between fragments ${j + 1} and ${j + 2} is not a multiple of three bases, so ${cdsName(a.feature)} is read out of frame after the junction.`
              : `${cdsName(a.feature)} runs into ${cdsName(b.feature)} at junction ${j + 1} out of frame: the fusion shifts the reading frame of ${strand === 'forward' ? cdsName(b.feature) : cdsName(a.feature)}.`,
          );
        }
      }
    }
  }
  return out;
}
