import { type SeqDocument, createMetadata, fragmentFromRange } from '../document';
import { type Feature, type Strand, createFeature, rangeSegment } from '../features';
import { type Range } from '../range';
import { type DigestFragment } from './digest';
import { ligate } from './ligate';

/**
 * Gateway cloning (#62): the BP and LR recombinations of the lambda
 * integrase system, as Invitrogen's kits run them.
 *
 * A Gateway reaction is not a cut and a join, it is a crossover: an
 * integrase pairs two att sites that share a core and swaps the DNA either
 * side of it. Two sites on one molecule and their two partners on another
 * therefore exchange the stretches between them, which is why a BP gives an
 * entry clone *and* a byproduct, and why the ccdB cassette leaves on the
 * byproduct rather than vanishing.
 *
 *   BP: attB1–gene–attB2  ×  attP1–ccdB–attP2  →  attL1–gene–attL2 (entry)
 *                                                + attR1–ccdB–attR2
 *   LR: attL1–gene–attL2  ×  attR1–ccdB–attR2  →  attB1–gene–attB2 (expression)
 *                                                + attP1–ccdB–attP2
 *
 * **No att sequences are bundled.** The sites are read from the documents'
 * own annotation — a real donor, entry or destination vector carries them,
 * and so does a PCR product made with attB-tailed primers (item 36) once
 * the tails are annotated. The crossover point is then found from the two
 * molecules themselves: sites that recombine share a core, so the longest
 * stretch common to the pair is that core, and crossing over in its middle
 * gives the recombinant sites their right sequence without a table to
 * consult or a licence to check. Detecting an unannotated att site by
 * sequence is feature detection (#60) and belongs there.
 */

/** Which of the four kinds a site is; they pair B×P and L×R. */
export type AttKind = 'B' | 'P' | 'L' | 'R';

export interface AttSite {
  readonly kind: AttKind;
  /** What has to match between partners: `1`, `2`, `3`, `5`, `2r`, … */
  readonly number: string;
  readonly feature: Feature;
  /** Where it lies, unrolled forward coordinates. */
  readonly range: Range;
  readonly strand: Strand;
}

/** `attB1`, `attP2r`, `attL5`, `attR4` — the names real vectors use. */
const ATT_NAME = /^att([BPLR])(\d+r?)$/i;

/**
 * The att sites a document annotates, in order along it. Anything else the
 * document says is ignored: this asks only "what does it call itself".
 */
export function attSites(doc: SeqDocument): AttSite[] {
  const out: AttSite[] = [];
  for (const feature of doc.features.all()) {
    const match = ATT_NAME.exec(feature.name.trim());
    if (match === null) continue;
    const spans = feature.segments.filter((s) => s.kind === 'range');
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (first === undefined || last === undefined) continue;
    out.push({
      kind: (match[1] ?? 'B').toUpperCase() as AttKind,
      number: (match[2] ?? '').toLowerCase(),
      feature,
      range: { start: first.start, end: last.end },
      strand: feature.strand,
    });
  }
  return out.sort((a, b) => a.range.start - b.range.start);
}

export type GatewayReaction = 'BP' | 'LR';

/** Which kinds each reaction takes, and what the two products carry. */
const RECOMBINATION: Readonly<
  Record<
    GatewayReaction,
    { readonly from: readonly [AttKind, AttKind]; readonly to: readonly [AttKind, AttKind] }
  >
> = {
  // attB × attP → attL (the entry clone) + attR (the byproduct).
  BP: { from: ['B', 'P'], to: ['L', 'R'] },
  // attL × attR → attB (the expression clone) + attP (the byproduct).
  LR: { from: ['L', 'R'], to: ['B', 'P'] },
};

export interface GatewayResult {
  /** The clone that was wanted: the entry clone (BP) or expression clone (LR). */
  readonly product: SeqDocument | null;
  /** The other circle the reaction makes, which carries the ccdB cassette. */
  readonly byproduct: SeqDocument | null;
  /** What could still go wrong on the bench, in sentences. */
  readonly warnings: readonly string[];
  /** What stopped it; null when it worked. */
  readonly problem: string | null;
}

export interface GatewayOptions {
  readonly name?: string;
}

/** The longest stretch common to both, which for two partner att sites is their core. */
function sharedCore(
  a: string,
  b: string,
): { readonly inA: number; readonly inB: number; readonly length: number } {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  let best = { inA: 0, inB: 0, length: 0 };
  // Lengths of common suffixes, one row per position in `x`.
  let previous = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x.charAt(i - 1) !== y.charAt(j - 1)) continue;
      const run = (previous[j - 1] ?? 0) + 1;
      row[j] = run;
      if (run > best.length) best = { inA: i - run, inB: j - run, length: run };
    }
    previous = row;
  }
  return best;
}

/** Shortest core two partner sites must share before they are taken to pair. */
const MIN_CORE = 7;

interface Crossover {
  /** Where the strands swap, as a position in each molecule's forward coordinates. */
  readonly inFirst: number;
  readonly inSecond: number;
  readonly core: number;
}

/**
 * Where two partner sites cross over: the middle of the core they share,
 * read on the forward strand of each molecule. Both sites lie on the same
 * strand: `gateway` turns a vector whose sites face the other way over
 * before it gets here.
 */
function crossoverOf(
  first: { readonly doc: SeqDocument; readonly site: AttSite },
  second: { readonly doc: SeqDocument; readonly site: AttSite },
): Crossover | null {
  const textOf = (d: SeqDocument, s: AttSite): string => d.subsequence(s.range);
  const a = textOf(first.doc, first.site);
  const b = textOf(second.doc, second.site);
  const core = sharedCore(a, b);
  if (core.length < MIN_CORE) return null;
  const half = Math.floor(core.length / 2);
  // A recombinant clone's own site can wrap the origin, so its range starts
  // near the end of the sequence and runs past it; the crossover is wrapped
  // back into the molecule.
  const wrap = (at: number, doc: SeqDocument): number =>
    doc.isCircular && doc.length > 0 ? ((at % doc.length) + doc.length) % doc.length : at;
  return {
    inFirst: wrap(first.site.range.start + core.inA + half, first.doc),
    inSecond: wrap(second.site.range.start + core.inB + half, second.doc),
    core: core.length,
  };
}

/**
 * Runs a BP or an LR. `insert` is the molecule carrying the DNA to move —
 * the attB substrate of a BP, the entry clone of an LR — and `vector` the
 * one that receives it: the donor vector or the destination vector.
 */
export function gateway(
  insert: SeqDocument,
  vector: SeqDocument,
  reaction: GatewayReaction,
  options: GatewayOptions = {},
): GatewayResult {
  const { from, to } = RECOMBINATION[reaction];
  const fail = (problem: string): GatewayResult => ({
    product: null,
    byproduct: null,
    warnings: [],
    problem,
  });

  const inserts = attSites(insert).filter((s) => s.kind === from[0]);
  const vectors = attSites(vector).filter((s) => s.kind === from[1]);
  const named = (kind: AttKind): string => `att${kind}`;
  if (inserts.length < 2) {
    return fail(
      `${insert.name} has ${inserts.length === 0 ? 'no' : 'only one'} ${named(from[0])} site annotated. A ${reaction} needs two, flanking the DNA to move; annotate them, or open a file that does.`,
    );
  }
  if (vectors.length < 2) {
    return fail(
      `${vector.name} has ${vectors.length === 0 ? 'no' : 'only one'} ${named(from[1])} site annotated. A ${reaction} needs two, flanking the cassette they replace.`,
    );
  }
  if (inserts.length > 2 || vectors.length > 2) {
    return fail(
      `More than two sites of a kind: this runs one pair at a time, so a multisite reaction has to be done a fragment at a time.`,
    );
  }

  const [i1, i2] = inserts as [AttSite, AttSite];
  // The vector's partners, matched by number rather than by position: a
  // destination vector often carries attR2 before attR1 on the forward strand.
  const v1 = vectors.find((s) => s.number === i1.number);
  const v2 = vectors.find((s) => s.number === i2.number);
  if (v1 === undefined || v2 === undefined) {
    return fail(
      `The sites do not pair: ${insert.name} has ${named(from[0])}${i1.number} and ${named(from[0])}${i2.number}, ${vector.name} has ${vectors.map((s) => named(from[1]) + s.number).join(' and ')}. Each number recombines only with its own.`,
    );
  }
  if (i1.number === i2.number) {
    return fail(
      `${insert.name} carries ${named(from[0])}${i1.number} twice. The two sites must differ, or the reaction has no direction and the insert can go in either way round.`,
    );
  }

  // A vector whose sites lie on the other strand from the insert's is the
  // same molecule written the other way round: the crossover joins the
  // insert's top strand to its bottom one, so its pieces go in
  // reverse-complemented. Turning the whole vector over first keeps the
  // pieces below on one strand. Only one pair opposed is not a swap at all
  // (it would invert the DNA between the sites), so that is refused.
  const opposed = [i1.strand !== v1.strand, i2.strand !== v2.strand];
  if (opposed[0] !== opposed[1]) {
    return fail(
      `${named(from[0])}${i1.number} and ${named(from[0])}${i2.number} of ${insert.name} do not lie the same way round as their partners in ${vector.name}: one pair is on the same strand and the other on opposite strands, which is not an exchange of the DNA between them. Check the sites' strands.`,
    );
  }
  if (opposed[0] === true) return gateway(insert, vector.reverseComplement(), reaction, options);

  const first = crossoverOf({ doc: insert, site: i1 }, { doc: vector, site: v1 });
  const second = crossoverOf({ doc: insert, site: i2 }, { doc: vector, site: v2 });
  if (first === null || second === null) {
    const which = first === null ? i1 : i2;
    return fail(
      `${named(from[0])}${which.number} of ${insert.name} and its partner in ${vector.name} share no core of ${MIN_CORE} bases, so they would not recombine. Check they are the sites they are labelled as.`,
    );
  }

  // Each molecule is opened at one crossover and closed at the other, so the
  // stretch between them changes hands: that is the recombination. The
  // insert's piece runs from its first site to its second, the vector's the
  // other way round, and the two leftovers make the byproduct.
  const insertPiece = fragmentFromRange(insert, unrolled(first.inFirst, second.inFirst, insert));
  const vectorPiece = fragmentFromRange(vector, unrolled(second.inSecond, first.inSecond, vector));
  const leftover = fragmentFromRange(insert, unrolled(second.inFirst, first.inFirst, insert));
  const cassette = fragmentFromRange(vector, unrolled(first.inSecond, second.inSecond, vector));

  // How much of each parent site each piece carries, so the recombinant
  // sites can be annotated across the junctions they now straddle.
  /** Distance from `start` round to `at`, for a site that may wrap the origin. */
  const along = (start: number, at: number, doc: SeqDocument): number => {
    const d = at - start;
    return d >= 0 || !doc.isCircular ? d : d + doc.length;
  };
  const i1Left = along(i1.range.start, first.inFirst, insert);
  const i1Right = i1.range.end - i1.range.start - i1Left;
  const i2Left = along(i2.range.start, second.inFirst, insert);
  const i2Right = i2.range.end - i2.range.start - i2Left;
  const v1Left = along(v1.range.start, first.inSecond, vector);
  const v1Right = v1.range.end - v1.range.start - v1Left;
  const v2Left = along(v2.range.start, second.inSecond, vector);
  const v2Right = v2.range.end - v2.range.start - v2Left;

  const productName = options.name ?? `${insert.name} × ${vector.name} ${reaction}`;
  const carriesCcdb = (pieces: readonly { readonly features: readonly Feature[] }[]): boolean =>
    pieces.some((p) => p.features.some((f) => /ccdb/i.test(f.name)));

  // The two circles the crossover makes. Which of them is the clone wanted
  // is not a matter of geometry — the sites can be annotated in either order
  // and one of them may wrap the origin — but of selection: the cassette
  // goes to the byproduct, and the circle without it is what grows.
  const crossed = {
    pieces: [asFragment(insertPiece, insert.name), asFragment(vectorPiece, vector.name)],
    sites: [
      { at: -v1Left, length: v1Left + i1Right, number: i1.number, strand: i1.strand },
      {
        at: insertPiece.sequence.length - i2Left,
        length: i2Left + v2Right,
        number: i2.number,
        strand: i2.strand,
      },
    ],
    ccdB: carriesCcdb([insertPiece, vectorPiece]),
  };
  const other = {
    pieces: [asFragment(cassette, vector.name), asFragment(leftover, insert.name)],
    sites: [
      { at: -i1Left, length: i1Left + v1Right, number: i1.number, strand: i1.strand },
      {
        at: cassette.sequence.length - v2Left,
        length: v2Left + i2Right,
        number: i2.number,
        strand: i2.strand,
      },
    ],
    ccdB: carriesCcdb([cassette, leftover]),
  };
  const [wanted, spare] = crossed.ccdB && !other.ccdB ? [other, crossed] : [crossed, other];

  const product = recombinant(wanted.pieces, {
    name: productName,
    description: `${reaction === 'BP' ? 'Entry' : 'Expression'} clone from a ${reaction} reaction of ${insert.name} and ${vector.name}`,
    kind: to[0],
    sites: wanted.sites,
  });
  // A linear substrate — an attB PCR product — has no byproduct circle: its
  // two flanks come away as loose ends and are lost.
  const byproduct = !insert.isCircular
    ? null
    : recombinant(spare.pieces, {
        name: `${productName} byproduct`,
        description: `Byproduct of the ${reaction} reaction of ${insert.name} and ${vector.name}`,
        kind: to[1],
        sites: spare.sites,
      });

  return {
    product,
    byproduct,
    warnings: gatewayWarnings(product, vector, reaction, first.core, second.core),
    problem: null,
  };
}

const BLUNT = { kind: 'blunt', overhang: '', enzyme: null } as const;

/** A piece of a parent molecule, with its att annotation dropped: it is half a site now. */
function asFragment(
  piece: { readonly sequence: string; readonly features: readonly Feature[] },
  source: string,
): DigestFragment {
  return {
    sequence: piece.sequence,
    features: piece.features.filter((f) => ATT_NAME.exec(f.name.trim()) === null),
    range: { start: 0, end: piece.sequence.length },
    left: BLUNT,
    right: BLUNT,
    source,
  };
}

interface RecombinantSite {
  /** Where it starts in the product; negative wraps back from the end. */
  readonly at: number;
  readonly length: number;
  readonly number: string;
  readonly strand: Strand;
}

/**
 * Closes the two pieces into a circle and annotates the sites the crossover
 * made. Each is half of one parent's site and half of the other's, which is
 * neither of them, so it gets the name the reaction gives it — `attL1` for
 * a BP's entry clone — and keeps the number, which is what pairs.
 */
function recombinant(
  pieces: readonly DigestFragment[],
  spec: {
    readonly name: string;
    readonly description: string;
    readonly kind: AttKind;
    readonly sites: readonly RecombinantSite[];
  },
): SeqDocument {
  const circle = ligate(pieces, {
    name: spec.name,
    circular: true,
    metadata: createMetadata({
      moleculeType: 'DNA',
      division: 'SYN',
      description: `${spec.description}: att${spec.kind}${spec.sites.map((s) => s.number).join(' and att' + spec.kind)}`,
    }),
  });
  const L = circle.length;
  let out = circle;
  for (const site of spec.sites) {
    if (site.length <= 0) continue;
    const start = L === 0 ? 0 : ((site.at % L) + L) % L;
    out = out.addFeature(
      createFeature({
        type: 'protein_bind',
        name: `att${spec.kind}${site.number}`,
        strand: site.strand,
        segments: [rangeSegment(start, start + site.length)],
      }),
    );
  }
  return out;
}

/** An unrolled range from `from` round to `to` on a circle, or along a linear molecule. */
function unrolled(from: number, to: number, doc: SeqDocument): Range {
  if (!doc.isCircular) return { start: Math.min(from, to), end: Math.max(from, to) };
  const end = to > from ? to : to + doc.length;
  return { start: from, end };
}

/** What the reaction cannot settle but the bench will (#62). */
function gatewayWarnings(
  product: SeqDocument,
  vector: SeqDocument,
  reaction: GatewayReaction,
  ...cores: readonly number[]
): string[] {
  const out: string[] = [];
  if (vector.features.all().some((f) => /ccdb/i.test(f.name))) {
    out.push(
      `The ccdB cassette of ${vector.name} leaves on the byproduct, so ${reaction === 'BP' ? 'an entry' : 'an expression'} clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.`,
    );
  }
  for (const core of cores) {
    if (core < 15) {
      out.push(
        `One pair shares only ${core} bases, shorter than a full att core: check the sites are annotated over their whole length.`,
      );
    }
  }
  out.push(...frameWarnings(product));
  return out;
}

/**
 * Whether a tag in the backbone still reads through into the insert. An
 * attB site is 25 bases, which is not a multiple of three, so an N- or
 * C-terminal fusion through one is in frame only if it was designed to be:
 * the commonest Gateway mistake, and one the sequence can answer.
 */
function frameWarnings(product: SeqDocument): string[] {
  const L = product.length;
  if (L === 0) return [];
  /** Distance forward from `x` to `y` round the circle. */
  const forward = (x: number, y: number): number => (((y - x) % L) + L) % L;
  const coding = product.features
    .all()
    .filter((f) => f.type === 'CDS')
    .map((f) => {
      const spans = f.segments.filter((s) => s.kind === 'range');
      const first = spans[0];
      const last = spans[spans.length - 1];
      return first === undefined || last === undefined
        ? null
        : { name: f.name === '' ? 'CDS' : f.name, start: first.start % L, end: last.end % L };
    })
    .filter((c): c is { name: string; start: number; end: number } => c !== null);

  const out: string[] = [];
  for (const site of attSites(product)) {
    const start = site.range.start % L;
    const end = site.range.end % L;
    const nearest = (
      pick: (c: { start: number; end: number }) => number,
    ): { name: string; start: number; end: number } | null => {
      let best: { name: string; start: number; end: number } | null = null;
      let bestGap = Infinity;
      for (const c of coding) {
        const gap = pick(c);
        if (gap <= GAP && gap < bestGap) {
          best = c;
          bestGap = gap;
        }
      }
      return best;
    };
    const before = nearest((c) => forward(c.end, start));
    const after = nearest((c) => forward(end, c.start));
    if (before === null || after === null || before.name === after.name) continue;
    const gap = forward(before.end, after.start);
    if (gap % 3 !== 0) {
      out.push(
        `${before.name} and ${after.name} are ${gap.toLocaleString()} bases apart across att${site.kind}${site.number}, which is not a multiple of three, so the fusion is out of frame.`,
      );
    }
  }
  return out;
}

/** How close a coding feature has to sit to an att site to be read as a fusion. */
const GAP = 30;
