import { SeqDocument, createMetadata, fragmentFromRange } from '../document';
import { type Feature, createFeature, rangeSegment, shiftFeature } from '../features';
import { newId } from '../ids';
import { type AnnealOptions, type AnnealingSite, findAnnealingSites } from '../primers';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';

/**
 * PCR: two primers, a template, and the piece between them copied over and
 * over until it is the only thing in the tube.
 *
 * This is the reaction the other three were missing. A digest takes a
 * molecule apart, Golden Gate and Gibson put molecules together — but
 * neither could *make* a part, so an assembly could only be built out of
 * files that already existed. Almost nothing on a real bench does: the
 * insert is amplified, the backbone is amplified, and the homology that a
 * Gibson joins them by is on the primers, not in any file.
 *
 * Two things follow from that, and they are what this module is about.
 *
 * **A primer is not its binding site.** It is a 3′ part that anneals and a
 * 5′ tail that does not — the tail is where the restriction site, the
 * Gibson arm, the tag or the mutation lives. The tail matches nothing on the
 * template and is in the product all the same. `findAnnealingSites`
 * (`core/primers/anneal.ts`) is the search that allows for it.
 *
 * **The product is the primers' sequence, not the template's.** The first
 * cycle copies the template; every cycle after that copies the product, so
 * whatever the primers say the ends are is what the ends become. A mismatch
 * under a primer is therefore not an error to be flagged, it is a mutation
 * to be written down: site-directed mutagenesis is a PCR with a mismatched
 * primer, and it falls out of doing this correctly rather than needing a
 * feature of its own.
 *
 * What it does not model: A-tailing (a Taq product is left blunt here), the
 * polymerase's processivity beyond a flat length ceiling, primer dimers,
 * and how much more readily a short product amplifies than a long one — the
 * order the products are listed in says that, and nothing else does.
 */

/** One of the oligos in the tube. */
export interface PcrPrimer {
  readonly name: string;
  readonly sequence: string;
}

/** An annealing site, and which primer made it. */
export interface PcrSite extends AnnealingSite {
  readonly name: string;
}

export interface PcrProduct {
  readonly document: SeqDocument;
  /** The site priming rightwards, and the one priming leftwards. */
  readonly forward: PcrSite;
  readonly reverse: PcrSite;
  /**
   * The stretch of template copied, unrolled forward coordinates: from the
   * forward primer's 5′-most annealed base to the reverse primer's. The
   * tails are outside it, because they are nowhere on the template.
   */
  readonly templateRange: Range;
  /** Length of the product, tails included. */
  readonly length: number;
  /** Mismatches under the two primers, which are in the product. */
  readonly mismatches: number;
}

export interface PcrOptions extends AnnealOptions {
  /** Longest product to bother with; a polymerase has its limits. */
  readonly maxProduct?: number;
  /** How many products to build, when a primer binds all over the place. */
  readonly maxProducts?: number;
  /** Name for the product; several are numbered from it. */
  readonly name?: string;
}

export const PCR_DEFAULTS = {
  maxProduct: 20_000,
  maxProducts: 12,
} as const;

export interface PcrResult {
  /** Every annealing site of every primer, in template order. */
  readonly sites: readonly PcrSite[];
  readonly products: readonly PcrProduct[];
  /** Pairs that would amplify, but longer than `maxProduct`. */
  readonly tooLong: number;
  /** Products past `maxProducts`, which are not built. */
  readonly hidden: number;
  /** What stopped it, in a sentence; null when something amplified. */
  readonly problem: string | null;
}

interface Candidate {
  readonly forward: PcrSite;
  readonly reverse: PcrSite;
  readonly span: number;
}

/**
 * Best first. Fewer mismatches beats more, because an exactly-matched pair
 * is the product that was designed and a mismatched one is usually noise;
 * then shorter beats longer, which is not a tidiness rule but what the tube
 * does — a short amplicon finishes every cycle and out-competes a long one.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  const ma = a.forward.mismatches + a.reverse.mismatches;
  const mb = b.forward.mismatches + b.reverse.mismatches;
  if (ma !== mb) return ma - mb;
  if (a.span !== b.span) return a.span - b.span;
  return a.forward.range.start - b.forward.range.start;
}

/** Runs the reaction. One primer is allowed: some templates prime both ways. */
export function pcr(
  template: SeqDocument,
  primers: readonly PcrPrimer[],
  options: PcrOptions = {},
): PcrResult {
  const { maxProduct, maxProducts } = { ...PCR_DEFAULTS, ...options };
  const L = template.length;
  const text = template.sequence.toString();
  const circular = template.isCircular;

  const sites: PcrSite[] = [];
  for (const primer of primers) {
    for (const site of findAnnealingSites(text, template.topology, primer.sequence, options)) {
      sites.push({ ...site, name: primer.name });
    }
  }
  sites.sort((a, b) => a.range.start - b.range.start || a.strand.localeCompare(b.strand));

  const forwards = sites.filter((s) => s.strand === 'forward');
  const reverses = sites.filter((s) => s.strand === 'reverse');

  const candidates: Candidate[] = [];
  let tooLong = 0;
  for (const f of forwards) {
    for (const r of reverses) {
      // From the forward primer's 5′-most annealed base to the reverse
      // primer's. On a circle the two are always in that order once you go
      // the right way round, which is why inverse PCR — primers back to back,
      // pointing away from each other — needs no special case: it is the
      // product that happens to be nearly the whole plasmid.
      let span = r.range.end - f.range.start;
      if (circular) {
        span = ((span % L) + L) % L;
        // Back-to-back primers whose ends meet exactly amplify the whole
        // circle, not nothing.
        if (span === 0) span = L;
      }
      if (span <= 0) continue;
      // Overlapping annealing regions are not an amplicon: the two primers
      // are on top of each other and what comes out is however much of each
      // the other let it copy.
      if (span < f.annealLength + r.annealLength) continue;
      if (span > maxProduct) {
        tooLong++;
        continue;
      }
      candidates.push({ forward: f, reverse: r, span });
    }
  }
  candidates.sort(compareCandidates);
  const kept = candidates.slice(0, maxProducts);

  const base = options.name ?? defaultPcrName(template);
  const products = kept.map((c, i) =>
    amplify(template, c, kept.length === 1 ? base : `${base} ${i + 1}`),
  );

  return {
    sites,
    products,
    tooLong,
    hidden: candidates.length - kept.length,
    problem:
      products.length > 0
        ? null
        : describeFailure(template, primers, forwards, reverses, tooLong, maxProduct),
  };
}

/** The product of one pair: primer, template, primer. */
function amplify(template: SeqDocument, c: Candidate, name: string): PcrProduct {
  const { forward: f, reverse: r, span } = c;
  const templateRange: Range = { start: f.range.start, end: f.range.start + span };
  const copied = fragmentFromRange(template, templateRange);
  // The product's ends are the primers', not the template's: the bases under
  // an annealing region come from the oligo, so a mismatch in one is a
  // mutation in the product. The interior is the template's own.
  const body = copied.sequence;
  const reverseOligo = reverseComplement(r.primer);
  const sequence =
    f.tail +
    fromPrimer(body.slice(0, f.annealLength), f.primer.slice(f.tail.length)) +
    body.slice(f.annealLength, span - r.annealLength) +
    fromPrimer(body.slice(span - r.annealLength), reverseOligo.slice(0, r.annealLength)) +
    reverseOligo.slice(r.annealLength);
  const shift = f.tail.length;
  const from = { length: body.length, topology: 'linear' } as const;
  const to = { length: sequence.length, topology: 'linear' } as const;
  const features = copied.features.map((feature) => ({
    ...shiftFeature(feature, shift, from, to),
    id: newId(),
  }));
  const document = SeqDocument.create({
    name,
    sequence,
    topology: 'linear',
    features: [
      ...features,
      primerFeature(f, 0, 'forward'),
      primerFeature(r, sequence.length - r.primer.length, 'reverse'),
    ],
    // Blunt: a proofreading polymerase leaves it so. Taq's single A is not
    // modelled, so TA cloning is not either.
    ends: null,
    metadata: createMetadata({
      moleculeType: 'DNA',
      division: 'SYN',
      description: describeProduct(template, c, sequence.length),
    }),
  });
  return {
    document,
    forward: f,
    reverse: r,
    templateRange,
    length: sequence.length,
    mismatches: f.mismatches + r.mismatches,
  };
}

/**
 * The annealed stretch as the product carries it: the template's own bases,
 * except where the primer disagrees.
 *
 * It is the same string either way but for its case, and the case is worth
 * having. Primers are cleaned to upper case and a GenBank ORIGIN block is
 * usually lower, so writing the primer over the template would shout the
 * whole annealing region — which came from the template after all. Written
 * this way, the upper-case letters of a product are exactly the bases that
 * did not: the 5\u2032 tails and the mismatches. That is how a primer is written
 * out in a paper, and it costs nothing.
 */
function fromPrimer(fromTemplate: string, fromOligo: string): string {
  let out = '';
  for (let i = 0; i < fromTemplate.length; i++) {
    const base = fromTemplate.charAt(i);
    const oligo = fromOligo.charAt(i);
    out += base.toUpperCase() === oligo ? base : oligo;
  }
  return out;
}

/**
 * The oligo itself on the product, tail and all — which is where a tail can
 * finally be drawn, having been nowhere on the template. A Gibson arm added
 * by PCR is then visible in the part it is meant to join by.
 */
function primerFeature(site: PcrSite, start: number, strand: 'forward' | 'reverse'): Feature {
  const note =
    site.tail === ''
      ? `PCR primer: ${site.primer}`
      : `PCR primer: ${site.primer} (${site.tail.length} bp 5′ tail)`;
  return createFeature({
    type: 'primer_bind',
    name: site.name,
    strand,
    segments: [rangeSegment(start, start + site.primer.length)],
    qualifiers: [{ name: 'note', value: note }],
  });
}

/** "pBR322 PCR product", which several products are numbered from. */
export function defaultPcrName(template: SeqDocument): string {
  return `${template.name} PCR product`;
}

function describeProduct(template: SeqDocument, c: Candidate, length: number): string {
  const tails = c.forward.tail.length + c.reverse.tail.length;
  const parts = [
    `${length.toLocaleString()} bp PCR product of ${template.name}`,
    `with ${c.forward.name} and ${c.reverse.name}`,
  ];
  const notes: string[] = [`${c.span.toLocaleString()} bp of template`];
  if (tails > 0) notes.push(`${tails.toLocaleString()} bp of 5′ tail`);
  const mismatches = c.forward.mismatches + c.reverse.mismatches;
  if (mismatches > 0) {
    notes.push(`${mismatches} primer ${mismatches === 1 ? 'mismatch' : 'mismatches'} carried in`);
  }
  return `${parts.join(' ')}: ${notes.join(', ')}`;
}

/**
 * Why nothing amplified. Each case is a different thing to do about it, so
 * they are different sentences rather than one "no product".
 */
function describeFailure(
  template: SeqDocument,
  primers: readonly PcrPrimer[],
  forwards: readonly PcrSite[],
  reverses: readonly PcrSite[],
  tooLong: number,
  maxProduct: number,
): string {
  const silent = primers
    .filter((p) => ![...forwards, ...reverses].some((s) => s.name === p.name))
    .map((p) => p.name);
  if (silent.length === primers.length) {
    return `Neither primer anneals to ${template.name}. The 3′ end is what has to match; a 5′ tail is free.`;
  }
  if (silent.length > 0) {
    return `${silent.join(' and ')} ${silent.length === 1 ? 'does' : 'do'} not anneal to ${template.name}, so there is nothing for the other primer to meet.`;
  }
  if (forwards.length === 0 || reverses.length === 0) {
    return `Both primers anneal to the same strand of ${template.name}, so they both copy the same way and nothing is amplified. One of them wants reverse-complementing.`;
  }
  if (tooLong > 0) {
    return `The primers would amplify, but the product is longer than ${maxProduct.toLocaleString()} bp.`;
  }
  return template.isCircular
    ? `The primers anneal but overlap each other, so there is no stretch between them to copy.`
    : `The primers point away from each other, so there is nothing between them on a linear template. On a plasmid this would be the long way round; make ${template.name} circular first.`;
}
