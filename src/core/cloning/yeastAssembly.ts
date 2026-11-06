import { type SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment } from '../features';
import {
  type GibsonAssembly,
  type GibsonResult,
  type GibsonWarning,
  YEAST_OVERLAP,
  clampYeastOverlap,
  describeGibsonDropped,
  gibson,
  junctionRepeats,
} from './gibson';

/**
 * Assembly in yeast by homologous recombination: TAR cloning, gap repair
 * into a linearised vector (#411).
 *
 * The reaction the app has to model is the one `gibson()` already answers:
 * which end matches which, and is that order forced. What is different is
 * where it happens. There is no exonuclease to set a 15 bp floor and no
 * 50 °C to anneal at, so a junction is judged by its length (30 bp and up,
 * 40 by default), its GC and, above all, whether its homology occurs a second
 * time anywhere in the tube, vector interior included: the cell recombines
 * there just as readily and gives a different circle. So this is `gibson()`
 * with `kit: 'yeast'`, plus what the cell needs of the product that a tube
 * does not: a marker to select it by, an origin to keep it, a circle.
 *
 * Which part is the vector is the user's to say (`vector`): the others are
 * inserts. With none named every part is an insert, which is plain TAR.
 * The vector's two ends are the two outer junctions of a circular product by
 * construction, so only a linear one can leave one free.
 */

export interface YeastOptions {
  /** Shortest homology to accept, held to 20–80 bp; 40 by default. */
  readonly minOverlap?: number;
  /** Whether the product closes into a circle; it has to, in yeast. */
  readonly circular?: boolean;
  readonly name?: string;
  /** The part that is the linearised vector, one of the parts passed. */
  readonly vector?: SeqDocument | null;
}

/** A junction as it lies in the product, 0-based half-open. */
export interface YeastJunction {
  /** `homology 1`… in the order of the assembly's joins; also its feature's name. */
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** The upstream part's name and the downstream part's. */
  readonly from: string;
  readonly to: string;
}

export interface YeastAssembly extends GibsonAssembly {
  /** Which entry of `order` is the vector; null when none was named. */
  readonly vectorIndex: number | null;
  readonly junctions: readonly YeastJunction[];
}

export interface YeastResult extends Omit<GibsonResult, 'assembly'> {
  readonly assembly: YeastAssembly | null;
}

/** Junction GC outside this range recombines poorly, in per cent. */
export const YEAST_GC = { low: 30, high: 70 } as const;

/** Direct repeats of this many bases or more are flagged; the same 30 as the homology floor. */
export const YEAST_REPEAT = YEAST_OVERLAP.floor;

/** Repeats listed one by one before the rest are counted. */
const MAX_REPEATS_LISTED = 10;

/** Names that say a feature is a selectable marker in yeast. */
const MARKER = /\b(URA3|LEU2|HIS3|TRP1|MET15|LYS2|ADE2|kanMX|G418|NatR|natMX|hphMX|HygR)\b/i;
/** ...an origin or centromere that keeps a plasmid in yeast. */
const YEAST_ORIGIN = /\bARS|\bCEN\d*\b|\b2[-\s]?(micron|µ|μ)/i;
/** ...a replication origin in E. coli, as opposed to f1, SV40 and the like. */
const BACTERIAL_ORIGIN = /\b(pUC|pBR322|ColE1|pMB1|p15A|pSC101|R6K|RK2|CloDF13|pBBR1)\b|^ori$/i;
/** ...a gene that makes E. coli resistant. */
const RESISTANCE = /\b(AmpR|bla|KanR|NeoR|CmR|CamR|CAT|TetR|SpecR|AadA|StrepR|GentR|ZeoR|kanMX)\b/i;
const GENE_TYPES = new Set(['CDS', 'gene', 'misc_marker']);

/**
 * Runs the reaction in yeast: `parts` are the linear pieces, in any order,
 * and the answer is the circle they recombine into, with the homology of each
 * junction marked on it and the warnings of `yeastWarnings`.
 */
export function yeastAssembly(
  parts: readonly SeqDocument[],
  options: YeastOptions = {},
): YeastResult {
  const { vector = null, ...rest } = options;
  const result = gibson(parts, { ...rest, kit: 'yeast' });
  const { usable, dropped } = result;
  const assembly = result.assembly;
  if (assembly === null) return { usable, dropped, assembly: null, problem: result.problem };

  const fail = (problem: string): YeastResult => ({ usable, dropped, assembly: null, problem });
  let vectorIndex: number | null = null;
  if (vector !== null) {
    const gone = dropped.find((d) => d.document === vector);
    if (gone !== undefined) {
      const min = clampYeastOverlap(options.minOverlap ?? YEAST_OVERLAP.default);
      return fail(`The vector ${vector.name} ${describeGibsonDropped(gone, min)}.`);
    }
    vectorIndex = indexOfPart(assembly, vector);
    if (vectorIndex === null) {
      return fail(`The vector ${vector.name} is not one of the parts.`);
    }
  }

  const junctions = junctionsOf(assembly);
  const product = assembly.product.addFeatures(junctions.map(junctionFeature));
  return {
    usable,
    dropped,
    assembly: {
      ...assembly,
      product,
      // The warnings read the features the parts carried, not the junctions
      // marked above, which say nothing about markers or origins.
      warnings: yeastWarnings(assembly, vectorIndex),
      vectorIndex,
      junctions,
    },
    problem: null,
  };
}

/** Where `vector` went in: as itself, or turned round, which makes a new document of it. */
function indexOfPart(assembly: GibsonAssembly, vector: SeqDocument): number | null {
  const same = assembly.order.findIndex((p) => p.document === vector);
  if (same >= 0) return same;
  const turned = vector.reverseComplement().sequence.toString();
  const flipped = assembly.order.findIndex(
    (p) =>
      p.flipped && p.document.name === vector.name && p.document.sequence.toString() === turned,
  );
  return flipped >= 0 ? flipped : null;
}

/**
 * Where each part's bases start and end in the product, and where each
 * junction lies. Each part gives up the homology it shares with the part
 * before it, and the circle's closing homology comes off the last part's tail
 * and shows at the product's start (`gibson`).
 */
function layout(assembly: GibsonAssembly): {
  readonly parts: readonly { start: number; end: number }[];
  readonly junctions: readonly { start: number; end: number }[];
} {
  const { order, joins, product } = assembly;
  const closing = product.isCircular ? (joins[order.length - 1]?.length ?? 0) : 0;
  const parts: { start: number; end: number }[] = [];
  const junctions: { start: number; end: number }[] = [];
  let at = 0;
  order.forEach((p, i) => {
    const from = i === 0 ? 0 : (joins[i - 1]?.length ?? 0);
    const to = p.document.length - (i === order.length - 1 ? closing : 0);
    parts.push({ start: at, end: at + to - from });
    at += to - from;
    const join = joins[i];
    // The closing join is the product's own start.
    if (join !== undefined) {
      junctions.push(
        i === order.length - 1
          ? { start: 0, end: join.length }
          : { start: Math.max(0, at - join.length), end: at },
      );
    }
  });
  return { parts, junctions };
}

function junctionsOf(assembly: GibsonAssembly): YeastJunction[] {
  const { order } = assembly;
  return layout(assembly).junctions.map((span, j) => ({
    name: `homology ${j + 1}`,
    start: span.start,
    end: span.end,
    from: order[j]?.document.name ?? 'one part',
    to: order[(j + 1) % order.length]?.document.name ?? 'the next',
  }));
}

/**
 * The homology on the map, so it can be checked by eye and the repeat
 * warnings have something to point at. The note says the app made it, as
 * detected features do, so it is never mistaken for part of a file.
 */
function junctionFeature(j: YeastJunction): Feature {
  return createFeature({
    type: 'misc_feature',
    name: j.name,
    segments: [rangeSegment(j.start, j.end)],
    qualifiers: [
      { name: 'label', value: j.name },
      {
        name: 'note',
        value: `Added by PlasmidPop: ${(j.end - j.start).toLocaleString()} bp of homology shared by ${j.from} and ${j.to}, in the product once; the cell joins the two by recombination here`,
      },
    ],
  });
}

/** GC of a junction's homology in per cent, 0 for none; what the `gc` warning judges. */
export function gcPercent(overlap: string): number {
  let gc = 0;
  for (const c of overlap.toUpperCase()) if (c === 'G' || c === 'C') gc++;
  return overlap.length === 0 ? 0 : (gc * 100) / overlap.length;
}

/**
 * What could make the cell give something else, or nothing, from an assembly
 * that did come together (#411). The product is still the design.
 *
 * - `short-overlap`: a junction under 30 bp, where recombination falls off
 *   sharply; `long-overlap`: over 80, which gains nothing and costs oligo.
 * - `repeat`: a junction's homology (in windows of 30 bp, or of its length if
 *   that is shorter) found anywhere else in the tube on either strand,
 *   interior of the vector included. Same search as Gibson's.
 * - `internal-repeat`: 30 bp or more repeated in the product away from every
 *   junction, whether inside one part or between two. Only direct repeats:
 *   they are what pop out as a deletion; an inverted one inverts.
 * - `gc`: a junction under 30% or over 70% GC.
 * - `linear-product`: a linear molecule without a telomere is lost.
 * - `no-marker`, `no-origin`: no marker or ARS, CEN or 2-micron feature
 *   annotated on the product, by name and type; with no features at all it
 *   says to detect them first. `no-bacterial`: a marker and origin but nothing
 *   to grow it in E. coli with.
 *
 * `vectorIndex` is which part is the vector, if one was named.
 */
export function yeastWarnings(
  assembly: GibsonAssembly,
  vectorIndex: number | null = null,
): GibsonWarning[] {
  const { order, joins, product } = assembly;
  const out: GibsonWarning[] = [];
  /** "homology 2 (vector to insert)", the junction as the map names it. */
  const label = (j: number): string =>
    `homology ${j + 1} (${order[j]?.document.name ?? 'one part'} to ${order[(j + 1) % order.length]?.document.name ?? 'the next'})`;

  const short = joins.flatMap((j, i) =>
    j.length < YEAST_OVERLAP.floor ? [`${label(i)}, ${j.length} bp`] : [],
  );
  if (short.length > 0) {
    out.push({
      kind: 'short-overlap',
      text: `Recombination falls off sharply below ${YEAST_OVERLAP.floor} bp of homology: ${short.join('; ')}.`,
    });
  }
  const long = joins.flatMap((j, i) =>
    j.length > YEAST_OVERLAP.max ? [`${label(i)}, ${j.length} bp`] : [],
  );
  if (long.length > 0) {
    out.push({
      kind: 'long-overlap',
      text: `More than ${YEAST_OVERLAP.max} bp of homology recombines no better and makes the oligos that carry it longer: ${long.join('; ')}.`,
    });
  }

  const sequences = order.map((p) => ({ sequence: p.document.sequence.toString() }));
  const shortest = Math.min(YEAST_REPEAT, ...joins.map((j) => j.length));
  for (const hit of junctionRepeats(sequences, joins, shortest)) {
    const where = order[hit.part]?.document.name ?? 'a part';
    const role = hit.part === vectorIndex ? 'the vector ' : '';
    out.push({
      kind: 'repeat',
      text: `The homology joining ${order[hit.join]?.document.name ?? 'one part'} to ${order[(hit.join + 1) % order.length]?.document.name ?? 'the next'} also occurs in ${role}${where} at ${(hit.start + 1).toLocaleString()}${hit.reverse ? ' (other strand)' : ''}, where the cell could recombine instead and give a different construct.`,
    });
  }

  const spans = layout(assembly);
  const partAt = (pos: number): string => {
    const i = spans.parts.findIndex((s) => pos >= s.start && pos < s.end);
    return order[i]?.document.name ?? 'a part';
  };
  const repeats = directRepeats(
    product.sequence.toString().toUpperCase(),
    product.isCircular,
    YEAST_REPEAT,
    spans.junctions,
  );
  for (const r of repeats.slice(0, MAX_REPEATS_LISTED)) {
    const a = partAt(r.a);
    const b = partAt(r.b);
    out.push({
      kind: 'internal-repeat',
      text: `${r.length} bp at ${(r.a + 1).toLocaleString()} in ${a} is repeated at ${(r.b + 1).toLocaleString()} in ${b}. Direct repeats recombine in yeast and can delete what lies between them.`,
    });
  }
  if (repeats.length > MAX_REPEATS_LISTED) {
    out.push({
      kind: 'internal-repeat',
      text: `${repeats.length - MAX_REPEATS_LISTED} more direct repeats of ${YEAST_REPEAT} bp or more are not listed.`,
    });
  }

  const gc = joins.flatMap((j, i) => {
    const pct = gcPercent(j.overlap);
    return pct < YEAST_GC.low || pct > YEAST_GC.high
      ? [`${label(i)} is ${Math.round(pct)}% GC`]
      : [];
  });
  if (gc.length > 0) {
    out.push({
      kind: 'gc',
      text: `Homology under ${YEAST_GC.low}% or over ${YEAST_GC.high}% GC recombines poorly: ${gc.join('; ')}.`,
    });
  }

  if (!product.isCircular) {
    const free =
      vectorIndex !== null && (vectorIndex === 0 || vectorIndex === order.length - 1)
        ? ' An end of the vector is not joined to anything, so gap repair cannot close it.'
        : '';
    out.push({
      kind: 'linear-product',
      text: `The product is linear. A linear molecule with no telomere is lost from yeast; assemble it as a circle.${free}`,
    });
  }

  const features = [...product.features];
  // The junctions are marked on the product, so they do not make it annotated.
  const annotated = features.some(
    (f) => !(f.type === 'misc_feature' && /^homology \d+$/.test(f.name)),
  );
  const hint = annotated ? '' : ' Detect features on the product first.';
  const isGene = (f: Feature): boolean => GENE_TYPES.has(f.type);
  const marker = features.some((f) => isGene(f) && MARKER.test(f.name));
  const origin = features.some(
    (f) => f.type === 'centromere' || (f.type !== 'primer_bind' && YEAST_ORIGIN.test(f.name)),
  );
  if (!marker) {
    out.push({
      kind: 'no-marker',
      text: `No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly.${hint}`,
    });
  }
  if (!origin) {
    out.push({
      kind: 'no-origin',
      text: `No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast.${hint}`,
    });
  }
  if (marker && origin) {
    const bacterial = features.some(
      (f) =>
        (f.type === 'rep_origin' || f.type === 'misc_feature') && BACTERIAL_ORIGIN.test(f.name),
    );
    const resistance = features.some((f) => isGene(f) && RESISTANCE.test(f.name));
    if (!bacterial && !resistance) {
      out.push({
        kind: 'no-bacterial',
        text: 'No bacterial origin or resistance gene is annotated: the assembly can be recovered from yeast but not propagated in E. coli.',
      });
    }
  }
  return out;
}

/** A stretch that occurs twice on one strand of a molecule. */
export interface DirectRepeat {
  /** Where its first copy starts, 0-based. */
  readonly a: number;
  /** Where the second does. */
  readonly b: number;
  readonly length: number;
}

/**
 * The direct repeats of `k` bases or more in `text` (upper case), left to
 * right by first copy, with copies at least `k` apart so one is not the next
 * one's overlap, and none that touches `blocked`: a junction's own homology
 * is the repeat warning's, not this one's. Windows with a base that is not
 * ACGT are not looked at. A circle is read across its origin.
 *
 * Each window is paired with the first later copy of it that is far enough
 * away, and the pairs on one diagonal that follow each other base by base are
 * one repeat, reported once at its full length.
 */
export function directRepeats(
  text: string,
  circular: boolean,
  k: number,
  blocked: readonly { readonly start: number; readonly end: number }[],
): DirectRepeat[] {
  const n = text.length;
  const reach = circular ? text + text.slice(0, k - 1) : text;
  const touches = (p: number): boolean =>
    blocked.some(
      (s) => (p < s.end && p + k > s.start) || (circular && p < s.end + n && p + k > s.start + n),
    );
  const seen = new Map<string, number[]>();
  for (let p = 0; p < n && p + k <= reach.length; p++) {
    const window = reach.slice(p, p + k);
    if (!/^[ACGT]+$/.test(window) || touches(p)) continue;
    const list = seen.get(window);
    if (list === undefined) seen.set(window, [p]);
    else list.push(p);
  }
  const pairs: { a: number; b: number }[] = [];
  for (const list of seen.values()) {
    for (const [i, a] of list.entries()) {
      const b = list.slice(i + 1).find((q) => q - a >= k && (!circular || n - (q - a) >= k));
      if (b !== undefined) pairs.push({ a, b });
    }
  }
  pairs.sort((x, y) => x.b - x.a - (y.b - y.a) || x.a - y.a);
  const out: DirectRepeat[] = [];
  let run: { a: number; b: number; length: number; last: number } | null = null;
  for (const { a, b } of pairs) {
    if (run !== null && run.b - run.a === b - a && a === run.last + 1) {
      run.last = a;
      run.length++;
    } else {
      if (run !== null) out.push({ a: run.a, b: run.b, length: run.length });
      run = { a, b, length: k, last: a };
    }
  }
  if (run !== null) out.push({ a: run.a, b: run.b, length: run.length });
  return out.sort((x, y) => x.a - y.a || x.b - y.b);
}
