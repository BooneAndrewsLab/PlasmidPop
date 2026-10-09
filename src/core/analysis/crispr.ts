import { type Strand } from '../features';
import { type Range, type Topology, rangeContains } from '../range';
import { reverseComplement } from '../sequence';
import { codeMask } from './search';

/**
 * A CRISPR nuclease as the guide finder needs it (item 74): the PAM it
 * recognises, which side of the protospacer the PAM is on, the spacer's
 * length, and where it cuts. Cut offsets count bases from the spacer's 5'
 * end, read on the strand the PAM is on: `pamStrand` is the break on that
 * strand, `targetStrand` the one on the strand the guide pairs with. Cas9
 * cuts both at the same place (blunt), Cas12a staggers them.
 */
export interface Nuclease {
  readonly id: string;
  readonly name: string;
  /** 5'→3' on the protospacer's strand, IUPAC. */
  readonly pam: string;
  readonly pamSide: '3prime' | '5prime';
  readonly spacerLength: number;
  readonly cut: { readonly pamStrand: number; readonly targetStrand: number };
}

/**
 * The presets. SpCas9: NGG, 20 nt, blunt 3 bp from the PAM (Jinek 2012).
 * SaCas9: NNGRRT, 21 nt, blunt 3 bp from the PAM (Ran 2015). AsCas12a:
 * TTTV 5' of a 23 nt spacer, cutting after base 18 of the PAM strand and
 * base 23 of the target strand, a 5-nt 5' overhang (Zetsche 2015).
 */
export const NUCLEASES: readonly Nuclease[] = [
  {
    id: 'spcas9',
    name: 'SpCas9 (NGG)',
    pam: 'NGG',
    pamSide: '3prime',
    spacerLength: 20,
    cut: { pamStrand: 17, targetStrand: 17 },
  },
  {
    id: 'sacas9',
    name: 'SaCas9 (NNGRRT)',
    pam: 'NNGRRT',
    pamSide: '3prime',
    spacerLength: 21,
    cut: { pamStrand: 18, targetStrand: 18 },
  },
  {
    id: 'ascas12a',
    name: 'AsCas12a (TTTV)',
    pam: 'TTTV',
    pamSide: '5prime',
    spacerLength: 23,
    cut: { pamStrand: 18, targetStrand: 23 },
  },
];

/** The spacer lengths a custom nuclease may have; the off-target scan packs a spacer in 32 bits. */
export const MIN_SPACER = 15;
export const MAX_SPACER = 30;
export const MAX_PAM = 8;

/** Why a custom PAM or spacer length cannot be used, or null when it can. */
export function nucleaseProblem(pam: string, spacerLength: number): string | null {
  if (pam.length === 0) return 'Enter a PAM.';
  if (pam.length > MAX_PAM) return `A PAM is at most ${String(MAX_PAM)} bases.`;
  for (const c of pam) if (codeMask(c) === 0) return `“${c}” is not an IUPAC base.`;
  if (!Number.isInteger(spacerLength) || spacerLength < MIN_SPACER || spacerLength > MAX_SPACER) {
    return `A spacer is ${String(MIN_SPACER)}–${String(MAX_SPACER)} bases.`;
  }
  return null;
}

/** GC fraction outside this band is flagged. */
export const GC_LOW = 0.4;
export const GC_HIGH = 0.8;
/** A run of a single base at least this long is flagged. */
export const HOMOPOLYMER_FLAG = 5;

/** A place in the searched documents a guide could also bind, PAM and all. */
export interface OffTargetSite {
  /** 0 is the document searched, 1… the `background` documents in order. */
  readonly doc: number;
  readonly strand: Strand;
  /** The protospacer, forward coordinates, unrolled. */
  readonly range: Range;
  readonly mismatches: number;
}

export interface CrisprGuide {
  /** The protospacer, forward coordinates, unrolled (may run past the end on a circle). */
  readonly range: Range;
  /** The strand the protospacer and PAM read on. */
  readonly strand: Strand;
  /** The guide's spacer, 5'→3', as it would be ordered (DNA). */
  readonly spacer: string;
  /** The PAM bases as they are in the document, 5'→3' on `strand`. */
  readonly pam: string;
  readonly pamRange: Range;
  /**
   * The breaks, as forward-coordinate positions between bases (0…length):
   * the forward strand is cut between `cut.forward - 1` and `cut.forward`.
   * Equal for a blunt cutter.
   */
  readonly cut: { readonly forward: number; readonly reverse: number };
  readonly gc: number;
  /** TTTT in the spacer: a Pol III (U6) terminator. */
  readonly polyT: boolean;
  /** The longest run of one base in the spacer. */
  readonly longestRun: number;
  /**
   * Other sites with at most `maxMismatches` mismatches, by mismatch count:
   * `offTargets[0]` is how many exact copies there are besides this one.
   */
  readonly offTargets: readonly number[];
  /** The off-target sites, fewest mismatches first, at most `MAX_LISTED_SITES`. */
  readonly sites: readonly OffTargetSite[];
}

export const MAX_LISTED_SITES = 50;

export interface BackgroundSequence {
  readonly sequence: string;
  readonly topology: Topology;
}

export interface CrisprOptions {
  /** Only guides whose cut on their own strand falls in this range. Default: anywhere. */
  readonly region?: Range;
  /** Off-target mismatches counted, 0–4. Default 3. */
  readonly maxMismatches?: number;
  /** Other documents to count off-targets in as well. */
  readonly background?: readonly BackgroundSequence[];
  readonly onProgress?: (fraction: number) => void;
}

/** One window of a strand's text that holds a PAM, in that strand's coordinates. */
interface Window {
  /** Where the protospacer starts in the strand's text. */
  readonly spacerAt: number;
  readonly pamAt: number;
}

/** The text a strand is read from: a circle has its start appended so windows can cross the origin. */
function strandText(text: string, topology: Topology, windowLength: number): string {
  return topology === 'circular' && text.length >= windowLength
    ? text + text.slice(0, windowLength - 1)
    : text;
}

/**
 * Windows of `text` whose PAM matches. `strict` takes a base only when it
 * is one the PAM allows (an N in the document never makes a guide);
 * otherwise a base that could be one does (an N may be an off-target).
 */
function pamWindows(
  text: string,
  length: number,
  topology: Topology,
  nuclease: Nuclease,
  strict: boolean,
): Window[] {
  const P = nuclease.pam.length;
  const W = P + nuclease.spacerLength;
  if (length < W) return [];
  const read = strandText(text, topology, W);
  const pam: number[] = [];
  for (let j = 0; j < P; j++) pam.push(codeMask(nuclease.pam.charAt(j)));
  const starts = topology === 'circular' ? length : length - W + 1;
  const out: Window[] = [];
  outer: for (let i = 0; i < starts; i++) {
    const pamAt = nuclease.pamSide === '3prime' ? i + nuclease.spacerLength : i;
    for (let j = 0; j < P; j++) {
      const s = codeMask(read.charAt(pamAt + j));
      const p = pam[j] ?? 0;
      if (s === 0 || (strict ? (s & ~p) !== 0 : (s & p) === 0)) continue outer;
    }
    out.push({ spacerAt: nuclease.pamSide === '3prime' ? i : i + P, pamAt });
  }
  return out;
}

/** A strand-local range [a, a + n) in forward coordinates, unrolled. */
function toForward(strand: Strand, a: number, n: number, L: number, topology: Topology): Range {
  if (strand === 'forward') {
    const start = topology === 'circular' ? a % L : a;
    return { start, end: start + n };
  }
  let start = L - (a + n);
  if (topology === 'circular') start = ((start % L) + L) % L;
  return { start, end: start + n };
}

/** A strand-local boundary (between bases) as a forward one, 0…L. */
function boundaryToForward(strand: Strand, x: number, L: number, topology: Topology): number {
  const b = strand === 'forward' ? x : L - x;
  return topology === 'circular' ? ((b % L) + L) % L : b;
}

/** Four bit planes, one per base: bit j set when the base at j could be that base. */
interface Packed {
  readonly a: number;
  readonly c: number;
  readonly g: number;
  readonly t: number;
}

function pack(text: string, at: number, n: number): Packed {
  let a = 0;
  let c = 0;
  let g = 0;
  let t = 0;
  for (let j = 0; j < n; j++) {
    const m = codeMask(text.charAt(at + j));
    const bit = 1 << j;
    if ((m & 1) !== 0) a |= bit;
    if ((m & 2) !== 0) c |= bit;
    if ((m & 4) !== 0) g |= bit;
    if ((m & 8) !== 0) t |= bit;
  }
  return { a, c, g, t };
}

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function longestRun(s: string): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < s.length; i++) {
    run = i > 0 && s.charAt(i) === s.charAt(i - 1) ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** A candidate binding site for the off-target scan. */
interface Site {
  readonly doc: number;
  readonly strand: Strand;
  readonly spacerAt: number;
  readonly spacer: string;
  readonly packed: Packed;
  readonly length: number;
  readonly topology: Topology;
}

function sitesOf(doc: number, sequence: string, topology: Topology, nuclease: Nuclease): Site[] {
  const L = sequence.length;
  const W = nuclease.pam.length + nuclease.spacerLength;
  const out: Site[] = [];
  for (const strand of ['forward', 'reverse'] as const) {
    const text = strand === 'forward' ? sequence : reverseComplement(sequence);
    const read = strandText(text, topology, W);
    for (const w of pamWindows(text, L, topology, nuclease, false)) {
      out.push({
        doc,
        strand,
        spacerAt: w.spacerAt,
        spacer: read.slice(w.spacerAt, w.spacerAt + nuclease.spacerLength),
        packed: pack(read, w.spacerAt, nuclease.spacerLength),
        length: L,
        topology,
      });
    }
  }
  return out;
}

/**
 * Where the spacer is cut into `n` blocks for the seed index: as evenly as
 * it divides, the remainder spread over the first blocks.
 */
function blockBounds(spacerLength: number, n: number): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let b = 0; b < n; b++) {
    out.push([Math.floor((b * spacerLength) / n), Math.floor(((b + 1) * spacerLength) / n)]);
  }
  return out;
}

/**
 * The sites worth comparing with a guide, by the pigeonhole principle: two
 * spacers that differ in at most k places must have one of any k + 1
 * blocks in common, so only the sites sharing a block with the guide can
 * be off-targets of it. Without this the scan is every site against every
 * other, which on a 200 kb record is 25,000² comparisons
 * (docs/perf-notes.md).
 *
 * A site whose spacer has an ambiguous base is in no block — it could read
 * as several — so those few are kept aside and compared with every guide.
 */
class SeedIndex {
  private readonly byBlock = new Map<string, number[]>();
  private readonly ambiguous: number[] = [];
  /** The guide each site was last offered to, so none is offered twice. */
  private readonly stamp: Int32Array;

  constructor(
    private readonly sites: readonly Site[],
    private readonly bounds: readonly (readonly [number, number])[],
  ) {
    this.stamp = new Int32Array(sites.length).fill(-1);
    sites.forEach((s, i) => {
      if (!PLAIN_BASES.test(s.spacer)) {
        this.ambiguous.push(i);
        return;
      }
      for (let b = 0; b < bounds.length; b++) {
        const key = this.key(b, s.spacer);
        const list = this.byBlock.get(key);
        if (list === undefined) this.byBlock.set(key, [i]);
        else list.push(i);
      }
    });
  }

  private key(block: number, spacer: string): string {
    const bound = this.bounds[block];
    return bound === undefined ? '' : `${String(block)}:${spacer.slice(bound[0], bound[1])}`;
  }

  /** The sites that could be within the mismatch limit of `spacer`, each once. */
  candidates(spacer: string, guideIndex: number): Site[] {
    const out: Site[] = [];
    const take = (i: number): void => {
      if (this.stamp[i] === guideIndex) return;
      this.stamp[i] = guideIndex;
      const site = this.sites[i];
      if (site !== undefined) out.push(site);
    };
    for (let b = 0; b < this.bounds.length; b++) {
      for (const i of this.byBlock.get(this.key(b, spacer)) ?? []) take(i);
    }
    for (const i of this.ambiguous) take(i);
    return out;
  }
}

const PLAIN_BASES = /^[ACGT]+$/;

/**
 * Finds CRISPR guides for `nuclease` on both strands of `sequence`, through
 * the origin of a circle, and counts for each how many other sites in the
 * document (and in `background`) it could bind with up to `maxMismatches`
 * mismatches next to a PAM. Only guides whose spacer is plain ACGT and
 * whose PAM is certain are listed; an ambiguous base at a candidate
 * off-target counts as a match, so an N never hides one. Coordinates are
 * forward-strand, 0-based, unrolled. Sorted by position.
 */
export function findCrisprGuides(
  sequence: string,
  topology: Topology,
  nuclease: Nuclease,
  options: CrisprOptions = {},
): CrisprGuide[] {
  const asked = Math.trunc(options.maxMismatches ?? 3);
  const maxMismatches = Number.isFinite(asked) ? Math.max(0, Math.min(4, asked)) : 3;
  const upper = sequence.toUpperCase();
  const L = upper.length;
  const N = nuclease.spacerLength;
  const P = nuclease.pam.length;
  const W = N + P;

  // The guides themselves.
  interface Found {
    readonly guide: Omit<CrisprGuide, 'offTargets' | 'sites'>;
    readonly spacerAt: number;
    readonly packed: Packed;
  }
  const found: Found[] = [];
  for (const strand of ['forward', 'reverse'] as const) {
    const text = strand === 'forward' ? upper : reverseComplement(upper);
    const read = strandText(text, topology, W);
    for (const w of pamWindows(text, L, topology, nuclease, true)) {
      const spacer = read.slice(w.spacerAt, w.spacerAt + N);
      if (!/^[ACGT]+$/.test(spacer)) continue;
      const pamStrandCut = boundaryToForward(
        strand,
        w.spacerAt + nuclease.cut.pamStrand,
        L,
        topology,
      );
      const targetStrandCut = boundaryToForward(
        strand,
        w.spacerAt + nuclease.cut.targetStrand,
        L,
        topology,
      );
      if (options.region !== undefined && !cutInRegion(pamStrandCut, options.region, L, topology)) {
        continue;
      }
      let gcCount = 0;
      for (const ch of spacer) if (ch === 'G' || ch === 'C') gcCount++;
      found.push({
        spacerAt: w.spacerAt,
        packed: pack(read, w.spacerAt, N),
        guide: {
          range: toForward(strand, w.spacerAt, N, L, topology),
          strand,
          spacer,
          pam: read.slice(w.pamAt, w.pamAt + P),
          pamRange: toForward(strand, w.pamAt, P, L, topology),
          cut:
            strand === 'forward'
              ? { forward: pamStrandCut, reverse: targetStrandCut }
              : { forward: targetStrandCut, reverse: pamStrandCut },
          gc: gcCount / N,
          polyT: spacer.includes('TTTT'),
          longestRun: longestRun(spacer),
        },
      });
    }
  }

  // Off-targets: the PAM-adjacent sites of every document that share a seed
  // block with the guide, compared as bit planes, so one comparison is a few
  // ANDs and a popcount.
  const sites = [
    ...sitesOf(0, upper, topology, nuclease),
    ...(options.background ?? []).flatMap((b, i) =>
      sitesOf(i + 1, b.sequence.toUpperCase(), b.topology, nuclease),
    ),
  ];
  const index = new SeedIndex(sites, blockBounds(N, maxMismatches + 1));
  const guides: CrisprGuide[] = [];
  const step = Math.max(1, Math.floor(found.length / 50));
  found.forEach((f, gi) => {
    if (options.onProgress !== undefined && gi % step === 0) {
      options.onProgress(gi / Math.max(1, found.length));
    }
    const counts = new Array<number>(maxMismatches + 1).fill(0);
    const hits: OffTargetSite[] = [];
    const g = f.packed;
    for (const s of index.candidates(f.guide.spacer, gi)) {
      if (s.doc === 0 && s.strand === f.guide.strand && s.spacerAt === f.spacerAt) continue;
      const same =
        (g.a & s.packed.a) | (g.c & s.packed.c) | (g.g & s.packed.g) | (g.t & s.packed.t);
      const mm = N - popcount(same);
      if (mm > maxMismatches) continue;
      counts[mm] = (counts[mm] ?? 0) + 1;
      hits.push({
        doc: s.doc,
        strand: s.strand,
        range: toForward(s.strand, s.spacerAt, N, s.length, s.topology),
        mismatches: mm,
      });
    }
    hits.sort(
      (a, b) => a.mismatches - b.mismatches || a.doc - b.doc || a.range.start - b.range.start,
    );
    guides.push({ ...f.guide, offTargets: counts, sites: hits.slice(0, MAX_LISTED_SITES) });
  });
  options.onProgress?.(1);
  guides.sort(
    (a, b) =>
      a.range.start - b.range.start ||
      (a.strand === b.strand ? 0 : a.strand === 'forward' ? -1 : 1),
  );
  return guides;
}

/** Whether a break at boundary `cut` is in `region`: a base on either side of it is. */
function cutInRegion(cut: number, region: Range, L: number, topology: Topology): boolean {
  if (L === 0) return false;
  const after = topology === 'circular' ? cut % L : cut;
  const before = topology === 'circular' ? (cut - 1 + L) % L : cut - 1;
  return (
    (after < L && rangeContains(region, after, L)) ||
    (before >= 0 && rangeContains(region, before, L))
  );
}

/** How a guide's spacer is cloned: the overhangs its annealed oligos carry. */
export interface OligoScheme {
  readonly id: string;
  readonly name: string;
  /** 5' of the top oligo, before the spacer. */
  readonly top: string;
  /** 5' of the bottom oligo, before the spacer's reverse complement. */
  readonly bottom: string;
  /** A G is put in front of a spacer that does not start with one, for the U6 promoter. */
  readonly leadingG: boolean;
  /** The nucleases it is for, by PAM side: a Cas9 sgRNA vector is no use to Cas12a. */
  readonly pamSides: readonly Nuclease['pamSide'][];
}

/**
 * pX330 and lentiCRISPRv2 take BbsI or BsmBI overhangs CACC/AAAC with a
 * leading G for U6 (Zhang lab protocols, Ran 2013), as SaCas9's pX601 does
 * with BsaI; a Cas12a crRNA vector takes others, so that scheme is for the
 * 3'-PAM nucleases only. "none" is the bare spacer and its reverse
 * complement, for any.
 */
export const OLIGO_SCHEMES: readonly OligoScheme[] = [
  {
    id: 'px330',
    name: 'pX330 / lentiCRISPRv2 (CACC / AAAC, U6 G)',
    top: 'CACC',
    bottom: 'AAAC',
    leadingG: true,
    pamSides: ['3prime'],
  },
  {
    id: 'none',
    name: 'No overhangs',
    top: '',
    bottom: '',
    leadingG: false,
    pamSides: ['3prime', '5prime'],
  },
];

/** The oligo schemes that fit `nuclease`. */
export function oligoSchemesFor(nuclease: Pick<Nuclease, 'pamSide'>): readonly OligoScheme[] {
  return OLIGO_SCHEMES.filter((s) => s.pamSides.includes(nuclease.pamSide));
}

/** The two oligos to order for `spacer`, 5'→3'. */
export function guideOligos(
  spacer: string,
  scheme: Pick<OligoScheme, 'top' | 'bottom' | 'leadingG'>,
): { readonly top: string; readonly bottom: string } {
  const insert = scheme.leadingG && !spacer.startsWith('G') ? `G${spacer}` : spacer;
  return {
    top: scheme.top.toUpperCase() + insert,
    bottom: scheme.bottom.toUpperCase() + reverseComplement(insert),
  };
}
