import { type SeqDocument } from '../document';
import { meltingTemperature } from '../primers/thermo';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';
import { YEAST_OVERLAP, clampYeastOverlap, gibson } from './gibson';
import {
  type OverlapKit,
  type OverlapOptions,
  type OverlapPrimer,
  KIT_NAMES,
  KIT_OVERLAP,
  OVERLAP_DEFAULTS,
  growAnnealing,
  productHolding,
} from './overlapPrimers';
import { pcr } from './pcr';
import { yeastAssembly } from './yeastAssembly';

/**
 * Primers for a vector and two or more PCR products in one assembly (#413).
 *
 * `designOverlapPrimers` takes one insert against the vector's two ends. Here
 * the inserts are in the order given: the first one's forward tail is the
 * vector's right end, the last one's reverse tail the reverse complement of
 * its left end, and every junction between two inserts is homology the tails
 * make. As there, the primers are then *run* (`pcr`, then the assembly the kit
 * would make), and the circle is compared with the one that was asked for, so
 * a design that closes in another order or shape is reported as a failure.
 */

/** One PCR product of the assembly: a range of a template, read either way. */
export interface AssemblyInsert {
  readonly template: SeqDocument;
  readonly region: Range;
  /** Read the region on the reverse strand: the product joins as its reverse complement. */
  readonly reverse?: boolean;
}

/**
 * Which primer carries the homology of a junction between insert A and insert B:
 * B's forward primer (`forward`, its tail is A's last bases), A's reverse
 * primer (`reverse`, its tail is B's first bases, reverse-complemented), or
 * half each (`both`).
 */
export type JunctionSplit = 'forward' | 'reverse' | 'both';

export interface MultiOverlapOptions extends OverlapOptions {
  /** Homology at every junction. Yeast: 20 to 80 bases; the other kits use their own. */
  readonly overlap?: number;
  readonly split?: JunctionSplit;
}

export interface InsertPrimers {
  readonly forward: OverlapPrimer;
  readonly reverse: OverlapPrimer;
  readonly amplicon: SeqDocument | null;
}

export interface MultiOverlapDesign {
  readonly kit: OverlapKit;
  readonly overlap: number;
  readonly inserts: readonly InsertPrimers[];
  readonly product: SeqDocument | null;
  readonly warnings: readonly string[];
  readonly problem: string | null;
}

/** Bases of a junction's homology that the next insert's forward primer carries. */
function forwardShare(split: JunctionSplit, overlap: number): number {
  if (split === 'forward') return overlap;
  if (split === 'reverse') return 0;
  return Math.ceil(overlap / 2);
}

export function designMultiOverlapPrimers(
  vector: SeqDocument,
  inserts: readonly AssemblyInsert[],
  kit: OverlapKit,
  options: MultiOverlapOptions = {},
): MultiOverlapDesign {
  const opts = { ...OVERLAP_DEFAULTS, ...options };
  const overlap =
    kit === 'yeast'
      ? clampYeastOverlap(options.overlap ?? YEAST_OVERLAP.default)
      : KIT_OVERLAP[kit];
  const split = options.split ?? 'both';
  const fail = (problem: string, made: readonly InsertPrimers[] = []): MultiOverlapDesign => ({
    kit,
    overlap,
    inserts: made,
    product: null,
    warnings: [],
    problem,
  });

  if (inserts.length === 0) return fail('Choose at least one insert.');
  if (vector.isCircular) {
    return fail(
      `${vector.name} is circular, so it has no ends for the tails to match. Digest it, or amplify it by inverse PCR, first.`,
    );
  }
  if (vector.length < overlap) {
    return fail(
      `${vector.name} is shorter than the ${overlap} bases of homology ${KIT_NAMES[kit]} asks for.`,
    );
  }

  const texts = inserts.map((i) => {
    const forwardStrand = i.template.subsequence(i.region);
    return i.reverse === true ? reverseComplement(forwardStrand) : forwardStrand;
  });
  for (const [n, text] of texts.entries()) {
    const name = inserts[n]?.template.name ?? '';
    if (text.length < opts.minAnneal * 2) {
      return fail(
        `Insert ${n + 1} (${name}) is ${text.length.toLocaleString()} bp, too short to amplify: a primer needs ${opts.minAnneal} bases at each end.`,
      );
    }
    // The homology at a junction is read from both of its inserts.
    if (inserts.length > 1 && text.length < overlap) {
      return fail(
        `Insert ${n + 1} (${name}) is ${text.length.toLocaleString()} bp, shorter than the ${overlap} bases of homology its junction is made of.`,
      );
    }
  }

  const vectorText = vector.sequence.toString().toUpperCase();
  const fromVectorEnd = vectorText.slice(vectorText.length - overlap);
  const fromVectorStart = reverseComplement(vectorText.slice(0, overlap));
  const carried = forwardShare(split, overlap);

  const made: InsertPrimers[] = [];
  for (const [n, insert] of inserts.entries()) {
    const text = texts[n] ?? '';
    const previous = texts[n - 1];
    const next = texts[n + 1];
    const forwardTail =
      previous === undefined
        ? fromVectorEnd
        : previous.slice(previous.length - carried).toUpperCase();
    const reverseTail =
      next === undefined
        ? fromVectorStart
        : reverseComplement(next.slice(0, overlap - carried)).toUpperCase();

    // As in the single design: no annealing part grows past half the insert.
    const grow = { ...opts, maxAnneal: Math.min(opts.maxAnneal, Math.floor(text.length / 2)) };
    const forwardAnneal = growAnnealing((k) => text.slice(0, k), grow);
    const reverseAnneal = growAnnealing(
      (k) => reverseComplement(text.slice(text.length - k)),
      grow,
    );
    const forward: OverlapPrimer = {
      sequence: forwardTail + forwardAnneal.toLowerCase(),
      tail: forwardTail,
      annealLength: forwardAnneal.length,
      tm: meltingTemperature(forwardAnneal),
    };
    const reverse: OverlapPrimer = {
      sequence: reverseTail + reverseAnneal.toLowerCase(),
      tail: reverseTail,
      annealLength: reverseAnneal.length,
      tm: meltingTemperature(reverseAnneal),
    };

    const reaction = pcr(insert.template, [
      { name: 'Forward', sequence: forward.sequence },
      { name: 'Reverse', sequence: reverse.sequence },
    ]);
    // A product is read along the template, so a reverse insert's is its reverse complement.
    const amplicon =
      productHolding(reaction.products, text) ??
      productHolding(reaction.products, reverseComplement(text));
    if (amplicon === undefined) {
      return fail(
        reaction.problem ??
          `The primers for insert ${n + 1} amplify ${reaction.products.length} other ${reaction.products.length === 1 ? 'product' : 'products'} of ${insert.template.name} but not the selection; they are not specific to it.`,
        [...made, { forward, reverse, amplicon: null }],
      );
    }
    made.push({ forward, reverse, amplicon: amplicon.document });
  }

  const parts = [
    vector,
    ...made.map((m) => m.amplicon).filter((a): a is SeqDocument => a !== null),
  ];
  const name = options.name === undefined ? {} : { name: options.name };
  const assembly =
    kit === 'yeast'
      ? yeastAssembly(parts, { minOverlap: overlap, circular: true, vector, ...name })
      : gibson(parts, { minOverlap: overlap, circular: true, ...name });
  if (assembly.assembly === null) {
    return fail(
      assembly.problem ?? 'The amplicons and the vector do not close into a circle.',
      made,
    );
  }

  // The order asked for is the order that was made, and nothing else joined in.
  const product = assembly.assembly.product;
  const wanted = (vectorText + texts.join('')).toUpperCase();
  const circle = product.sequence.toString().toUpperCase();
  const ring = wanted + wanted;
  if (
    circle.length !== wanted.length ||
    (!ring.includes(circle) && !ring.includes(reverseComplement(circle)))
  ) {
    return fail(
      'The primers close into a circle, but not the one asked for: the pieces join in another order or share homology beyond the junctions.',
      made,
    );
  }

  return {
    kit,
    overlap,
    inserts: made,
    product,
    warnings: [
      ...multiWarnings(vector, kit, overlap, inserts.length, split),
      ...assembly.assembly.warnings.map((w) => w.text),
    ],
    problem: null,
  };
}

function multiWarnings(
  vector: SeqDocument,
  kit: OverlapKit,
  overlap: number,
  inserts: number,
  split: JunctionSplit,
): string[] {
  const out: string[] = [];
  const ends = vector.ends;
  if (ends !== null && (ends.left.kind !== 'blunt' || ends.right.kind !== 'blunt')) {
    const chews =
      kit === 'yeast'
        ? "the cell's own resection trims them"
        : "the kit's exonuclease chews them back";
    out.push(
      `${vector.name} has sticky ends; the tails match its top strand, and ${chews} either way, but check the ends are where you meant to cut.`,
    );
  }
  out.push(
    `${KIT_NAMES[kit]} asks for ${overlap} bases of homology at each of the ${inserts + 1} junctions. ${
      split === 'both'
        ? 'The two primers at an internal junction carry half each.'
        : split === 'forward'
          ? "The next insert's forward primer carries each internal junction whole."
          : "The previous insert's reverse primer carries each internal junction whole."
    }`,
  );
  return out;
}
