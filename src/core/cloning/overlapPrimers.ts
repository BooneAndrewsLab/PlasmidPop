import { type SeqDocument } from '../document';
import { meltingTemperature } from '../primers/thermo';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';
import { gibson } from './gibson';
import { type PcrProduct, pcr } from './pcr';

/**
 * Primers that carry a linearised vector's ends on their own 5′ tails, so
 * the amplicon they make joins it without an enzyme (#63).
 *
 * In-Fusion (Takara) and NEBuilder HiFi (NEB) are the same trick as Gibson
 * and assemble by the same rule, which this app already models
 * (`gibson.ts`): what is new is not the reaction but the design, and the
 * design is where the mistakes are. So this makes the two oligos and then
 * *runs* them — `pcr` for the amplicon, `gibson` for the circle — rather
 * than describing what they would do. A design that does not close is a
 * design that failed, not a sentence.
 *
 * The kits differ in how much homology they ask for, and that is all they
 * differ in here: In-Fusion's 15 bases, NEBuilder's 20.
 */
export type OverlapKit = 'in-fusion' | 'nebuilder';

/** Homology each kit's protocol asks the primer tails to carry. */
export const KIT_OVERLAP: Readonly<Record<OverlapKit, number>> = {
  'in-fusion': 15,
  nebuilder: 20,
};

export const KIT_NAMES: Readonly<Record<OverlapKit, string>> = {
  'in-fusion': 'In-Fusion',
  nebuilder: 'NEBuilder HiFi',
};

export interface OverlapPrimer {
  /** 5′→3′, as it would be ordered: the vector's end, then the insert. */
  readonly sequence: string;
  /** The 5′ bases taken from the vector, which match nothing on the template. */
  readonly tail: string;
  /** The 3′ bases that anneal to the template. */
  readonly annealLength: number;
  /** Melting temperature of the annealing part, which is what the first cycle sees. */
  readonly tm: number;
}

export interface OverlapDesign {
  readonly kit: OverlapKit;
  readonly forward: OverlapPrimer;
  readonly reverse: OverlapPrimer;
  /** What the two primers amplify off the template. */
  readonly amplicon: SeqDocument | null;
  /** The circle it and the vector make, which is the point of the design. */
  readonly product: SeqDocument | null;
  readonly warnings: readonly string[];
  readonly problem: string | null;
}

export interface OverlapOptions {
  /** Tm the annealing part grows to. */
  readonly targetTm?: number;
  readonly minAnneal?: number;
  readonly maxAnneal?: number;
  readonly name?: string;
}

export const OVERLAP_DEFAULTS: Required<Omit<OverlapOptions, 'name'>> = {
  targetTm: 60,
  minAnneal: 18,
  maxAnneal: 30,
};

/** Grows an annealing part from `read(n)` until it melts at `target` or runs out. */
function anneal(read: (n: number) => string, opts: Required<Omit<OverlapOptions, 'name'>>): string {
  let n = opts.minAnneal;
  while (n < opts.maxAnneal && meltingTemperature(read(n)) < opts.targetTm) n++;
  return read(n);
}

/**
 * Designs the two primers that amplify `region` of `template` with tails
 * matching the ends of `vector`, and runs them.
 *
 * The circle reads [vector][insert], so the junction before the insert is
 * the vector's right end and the one after it the vector's left end: the
 * forward primer's tail is the vector's last bases and the reverse
 * primer's the reverse complement of its first.
 */
export function designOverlapPrimers(
  vector: SeqDocument,
  template: SeqDocument,
  region: Range,
  kit: OverlapKit,
  options: OverlapOptions = {},
): OverlapDesign {
  const opts = { ...OVERLAP_DEFAULTS, ...options };
  const overlap = KIT_OVERLAP[kit];
  const empty: OverlapPrimer = { sequence: '', tail: '', annealLength: 0, tm: NaN };
  const fail = (problem: string): OverlapDesign => ({
    kit,
    forward: empty,
    reverse: empty,
    amplicon: null,
    product: null,
    warnings: [],
    problem,
  });

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
  const insert = template.subsequence(region);
  if (insert.length < opts.minAnneal * 2) {
    return fail(
      `The selected ${insert.length.toLocaleString()} bp is too short to amplify: a primer needs ${opts.minAnneal} bases at each end.`,
    );
  }

  const text = vector.sequence.toString();
  const forwardTail = text.slice(text.length - overlap).toUpperCase();
  const reverseTail = reverseComplement(text.slice(0, overlap)).toUpperCase();
  const forwardAnneal = anneal((n) => insert.slice(0, n), opts);
  const reverseAnneal = anneal((n) => reverseComplement(insert.slice(insert.length - n)), opts);

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

  // Run them, rather than claim what they would do.
  const reaction = pcr(template, [
    { name: 'Forward', sequence: forward.sequence },
    { name: 'Reverse', sequence: reverse.sequence },
  ]);
  const amplicon = wanted(reaction.products, insert);
  if (amplicon === undefined) {
    return {
      kit,
      forward,
      reverse,
      amplicon: null,
      product: null,
      warnings: [],
      problem:
        reaction.problem ??
        `The primers amplify ${reaction.products.length} other products of ${template.name} but not the selection; they are not specific to it.`,
    };
  }
  const assembly = gibson([vector, amplicon.document], {
    minOverlap: overlap,
    circular: true,
    ...(options.name === undefined ? {} : { name: options.name }),
  });
  if (assembly.assembly === null) {
    return {
      kit,
      forward,
      reverse,
      amplicon: amplicon.document,
      product: null,
      problem: assembly.problem ?? 'The amplicon and the vector do not close into a circle.',
      warnings: [],
    };
  }

  return {
    kit,
    forward,
    reverse,
    amplicon: amplicon.document,
    product: assembly.assembly.product,
    warnings: [
      ...designWarnings(vector, reaction.products.length, kit),
      ...assembly.assembly.warnings.map((w) => w.text),
    ],
    problem: null,
  };
}

/**
 * The product that is the selection with the tails on it, not an off-target
 * one: the shortest that holds the whole insert.
 *
 * It is found by content rather than by coordinates, because the annealing
 * search walks back from the 3′ end and keeps going while the bases match
 * (`anneal.ts`): a tail base that happens to continue the template is part
 * of the site, so the product's `templateRange` can begin a base or two
 * before the selection while being the very product that was designed.
 */
function wanted(products: readonly PcrProduct[], insert: string): PcrProduct | undefined {
  const bases = insert.toUpperCase();
  return products
    .filter((p) => p.document.sequence.toString().toUpperCase().includes(bases))
    .sort((a, b) => a.length - b.length)[0];
}

function designWarnings(vector: SeqDocument, products: number, kit: OverlapKit): string[] {
  const out: string[] = [];
  if (vector.ends !== null) {
    out.push(
      `${vector.name} has sticky ends; the tails match its top strand, and the kit's exonuclease chews them back either way, but check the ends are where you meant to cut.`,
    );
  }
  if (products > 1) {
    out.push(
      `The primers also amplify ${products - 1} other ${products === 2 ? 'product' : 'products'} of the template, which would compete in the tube.`,
    );
  }
  out.push(
    `${KIT_NAMES[kit]} asks for ${KIT_OVERLAP[kit]} bases of homology, which both tails carry.`,
  );
  return out;
}
