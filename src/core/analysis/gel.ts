import { type Topology } from '../range';
import { type CutSite } from './restriction';
import { digestFragments } from './restriction';

/**
 * What a digest would look like on an agarose gel, and whether it answers
 * the question a diagnostic digest is run to answer: are the bands far
 * enough apart to tell one construct from another by eye.
 *
 * The Enzymes tab could already narrow the list to the enzymes that cut a
 * given number of times (item 30), which is half of it. The other half is
 * that a cut count says nothing about the bands: BsaI cutting a 4.4 kb
 * plasmid twice is useless if the two pieces are 2,180 and 2,181 bp, and a
 * 4,000 + 361 bp pair is read off the gel in a second.
 *
 * The numbers below are rules of thumb for a standard 1 % agarose gel, not
 * a simulation of one. They are options rather than constants so that a
 * caller working at another percentage can say so, and so that the
 * judgement is in one place instead of spread through the UI.
 */
export interface GelOptions {
  /**
   * How different in length two fragments must be to run as two bands,
   * as a ratio of the larger to the smaller. Below about 10 % difference
   * two bands touch on a 1 % gel; 1.15 leaves a little room.
   */
  readonly resolution?: number;
  /** Below this a band runs with the dye front and is easily missed. */
  readonly minVisible?: number;
  /** Above this the large fragments compress together near the well. */
  readonly maxResolved?: number;
  /**
   * Length that runs with the dye front. Nothing shorter is any further
   * down the lane, because there is no further down: this is where the
   * picture ends.
   */
  readonly frontLength?: number;
  /**
   * Bands this far apart, as a ratio, are told apart at a glance, and
   * further apart is no easier: 4,000 + 2,000 reads as well as 4,000 + 100.
   * Ranking by the raw ratio rewarded the second, which is a lane with a
   * faint sliver at the foot of it.
   */
  readonly plenty?: number;
  /**
   * The shortest band that stains brightly enough not to be looked for.
   * A stain binds by mass, so a 150 bp band beside a 4 kb one is a
   * thirtieth of its brightness (see `bandIntensities`).
   */
  readonly bright?: number;
}

export const DEFAULT_GEL: Required<GelOptions> = {
  resolution: 1.15,
  minVisible: 100,
  maxResolved: 10_000,
  frontLength: 50,
  plenty: 2,
  bright: 500,
};

/** The agarose percentages offered, as a bench keeps them. */
export const AGAROSE_PERCENTAGES = [0.7, 1, 1.5, 2] as const;
export type AgarosePercent = (typeof AGAROSE_PERCENTAGES)[number];

export function isAgarosePercent(v: unknown): v is AgarosePercent {
  return typeof v === 'number' && (AGAROSE_PERCENTAGES as readonly number[]).includes(v);
}

/**
 * The range each percentage separates well, from supplier tables (NEB,
 * Thermo): a thinner gel opens up the large fragments and loses the small
 * ones off the bottom, a thicker one the reverse. 1 % is `DEFAULT_GEL`.
 */
const AGAROSE_RANGE: Readonly<Record<AgarosePercent, readonly [number, number]>> = {
  0.7: [800, 12_000],
  1: [500, 10_000],
  1.5: [200, 4000],
  2: [100, 2000],
};

/**
 * The gel rules for a percentage. The resolved range is the table's; below
 * it, the numbers scale as `DEFAULT_GEL`'s do at 1 %: a band is easily
 * missed under a fifth of the range's foot and runs with the dye at a
 * tenth, and bright means inside the range. Resolution stays at 15 %: a
 * thicker gel moves the range down rather than sharpening it.
 */
export function gelForAgarose(percent: AgarosePercent): Required<GelOptions> {
  const [low, high] = AGAROSE_RANGE[percent];
  return {
    ...DEFAULT_GEL,
    minVisible: low / 5,
    frontLength: low / 10,
    maxResolved: high,
    bright: low,
  };
}

/** One band of the gel: the fragments that would run together at one place. */
export interface GelBand {
  /** Length to label it by: the largest of the fragments that run here. */
  readonly length: number;
  /** The fragment lengths that co-migrate, longest first. */
  readonly fragments: readonly number[];
}

export interface DigestProfile {
  /** Fragment lengths, longest first. */
  readonly fragments: readonly number[];
  /** What is seen: co-migrating fragments merged into one band. */
  readonly bands: readonly GelBand[];
  /**
   * The tightest pair of neighbouring bands, as the ratio of the larger to
   * the smaller. Infinity when there is at most one band, since there is no
   * pair to tell apart. This is what "far enough apart" means, and what the
   * Enzymes tab sorts by.
   */
  readonly separation: number;
  /** Fragments too short to see, and too long to resolve from each other. */
  readonly tooSmall: number;
  readonly tooLarge: number;
  /** Fragments sharing a band with another, which read as one. */
  readonly comigrating: number;
  /**
   * Whether the lane hides something: fragments running as one band, bands
   * off the bottom of the gel, or a clutch of them compressed at the top.
   * This is the one worth warning about, because it is where a gel is read
   * wrongly rather than merely uninformatively.
   */
  readonly misleading: boolean;
  /**
   * Whether the gel answers "which construct is this" by itself: at least
   * two bands, and nothing hidden. An enzyme that linearises a plasmid is
   * not `misleading` and not `readable` — there is simply nothing to tell
   * apart, which is a fact about the question, not a fault of the enzyme.
   */
  readonly readable: boolean;
}

/**
 * Groups fragment lengths into the bands a gel would show. Single linkage
 * down the sorted list: a fragment joins the band above it when the two are
 * closer than `resolution`, which is what running together means. A chain
 * of near-equal fragments is one smear, and calling it one band is the
 * honest reading of it.
 */
function bandsOf(lengths: readonly number[], resolution: number): GelBand[] {
  const bands: GelBand[] = [];
  let current: number[] = [];
  for (const length of lengths) {
    const last = current[current.length - 1];
    if (last !== undefined && length > 0 && last / length < resolution) {
      current.push(length);
      continue;
    }
    if (current.length > 0) bands.push({ length: current[0] ?? 0, fragments: current });
    current = [length];
  }
  if (current.length > 0) bands.push({ length: current[0] ?? 0, fragments: current });
  return bands;
}

/** What `lengths` would look like on a gel. */
export function gelProfile(lengths: readonly number[], options: GelOptions = {}): DigestProfile {
  const { resolution, minVisible, maxResolved } = { ...DEFAULT_GEL, ...options };
  const fragments = [...lengths].sort((a, b) => b - a);
  const bands = bandsOf(fragments, resolution);
  let separation = Infinity;
  for (let i = 1; i < bands.length; i++) {
    const above = bands[i - 1]?.fragments;
    const below = bands[i]?.length;
    const smallest = above?.[above.length - 1];
    if (smallest === undefined || below === undefined || below <= 0) continue;
    separation = Math.min(separation, smallest / below);
  }
  const tooSmall = fragments.filter((n) => n < minVisible).length;
  const tooLarge = fragments.filter((n) => n > maxResolved).length;
  const comigrating = bands.reduce(
    (n, b) => n + (b.fragments.length > 1 ? b.fragments.length : 0),
    0,
  );
  // Two fragments too long to resolve are only a problem when they are
  // meant to be told apart, which is what the band count already says.
  const misleading = tooSmall > 0 || comigrating > 0 || tooLarge > 1;
  return {
    fragments,
    bands,
    separation,
    tooSmall,
    tooLarge,
    comigrating,
    misleading,
    readable: bands.length >= 2 && !misleading,
  };
}

/** The profile of cutting a molecule of `seqLength` at the given positions. */
export function digestProfile(
  cuts: readonly number[],
  seqLength: number,
  topology: Topology,
  options: GelOptions = {},
): DigestProfile {
  return gelProfile(
    digestFragments(cuts, seqLength, topology).map((f) => f.length),
    options,
  );
}

/** The profile one enzyme's own cut sites would give. */
export function enzymeProfile(
  sites: readonly CutSite[],
  seqLength: number,
  topology: Topology,
  options: GelOptions = {},
): DigestProfile {
  return digestProfile(
    sites.map((s) => s.cut),
    seqLength,
    topology,
    options,
  );
}

/**
 * Orders two digests by how well they answer "which construct is this".
 * Best first, for the Enzymes tab's "Band separation" sort and its double
 * digests:
 *
 * 1. A gel that can be read by itself beats one that cannot.
 * 2. Bands further apart beat bands that nearly touch — up to `plenty`,
 *    past which two bands are as distinct as they will ever be.
 * 3. A brighter smallest band beats a fainter one, up to `bright`: among
 *    lanes that separate plenty, the one without a sliver at the foot.
 * 4. Then the separation itself, so that among lanes equal on both counts
 *    the wider still comes first.
 * 5. Fewer bands beat more: a lane of eight is a ladder, not an answer.
 * 6. Fewer pieces hidden under a shared band beat more, which only
 *    separates the digests rule 1 has already set aside: a lane where two
 *    fragments run as one is more misleading than a lane with one band.
 *
 * Rules 2 and 3 are capped because the first version was not, and ranked a
 * double digest of pBR322 into 4,259 + 102 bp first: 41 times apart, and a
 * band nobody would see.
 *
 * A digest with one band — an enzyme that linearises a plasmid — has no
 * pair to separate, so it is never `readable` and sorts below anything
 * that gives two. That is right for this question and says nothing about
 * the enzyme: linearising is what the "Cuts: once" filter is for.
 */
export function compareDiagnostic(
  a: DigestProfile,
  b: DigestProfile,
  options: GelOptions = {},
): number {
  const { plenty, bright } = { ...DEFAULT_GEL, ...options };
  if (a.readable !== b.readable) return a.readable ? -1 : 1;
  const sa = Number.isFinite(a.separation) ? a.separation : 0;
  const sb = Number.isFinite(b.separation) ? b.separation : 0;
  const enough = Math.min(sb, plenty) - Math.min(sa, plenty);
  if (enough !== 0) return enough;
  const faintest = (p: DigestProfile): number =>
    Math.min(p.fragments[p.fragments.length - 1] ?? 0, bright);
  const brighter = faintest(b) - faintest(a);
  if (brighter !== 0) return brighter;
  if (sa !== sb) return sb - sa;
  if (a.bands.length !== b.bands.length) return a.bands.length - b.bands.length;
  return a.comigrating - b.comigrating;
}

/**
 * The lengths `digestFragments` would give for sorted, distinct cuts, without
 * building a fragment for each: this is the inner loop of `bestPairs`.
 */
function fragmentLengths(cuts: readonly number[], seqLength: number, topology: Topology): number[] {
  const inner = topology === 'linear' ? cuts.filter((c) => c > 0 && c < seqLength) : cuts;
  const first = inner[0];
  if (first === undefined) return seqLength > 0 ? [seqLength] : [];
  const out: number[] = [];
  for (let k = 1; k < inner.length; k++) out.push((inner[k] ?? 0) - (inner[k - 1] ?? 0));
  const last = inner[inner.length - 1] ?? first;
  if (topology === 'linear') out.push(first, seqLength - last);
  else out.push(seqLength - last + first);
  return out;
}

/**
 * Whether lengths sorted longest first could make a readable lane: nothing
 * under `minVisible`, at most one over `maxResolved`, and no neighbours close
 * enough to run together. The same three tests `gelProfile` makes, without
 * the bands it builds to make them.
 */
function mayBeReadable(lengths: readonly number[], gel: Required<GelOptions>): boolean {
  if (lengths.length < 2) return false;
  let large = 0;
  for (let k = 0; k < lengths.length; k++) {
    const n = lengths[k] ?? 0;
    if (n < gel.minVisible) return false;
    if (n > gel.maxResolved && ++large > 1) return false;
    const above = lengths[k - 1];
    if (above !== undefined && above / n < gel.resolution) return false;
  }
  return true;
}

/** An enzyme a double digest could be made with, and where it cuts. */
export interface PairCandidate {
  readonly name: string;
  readonly cuts: readonly number[];
}

/** Two enzymes and the gel they would give together. */
export interface RankedPair {
  readonly first: string;
  readonly second: string;
  readonly profile: DigestProfile;
}

/**
 * The enzyme pairs whose double digest reads best on a gel, best first.
 *
 * The single-enzyme sort answers "which enzyme gives bands I can tell
 * apart"; a double digest is the answer when none does, and the one a
 * cloner reaches for anyway, since two enzymes that each cut once cut out
 * the piece between them. Every pair is judged by `compareDiagnostic` on the
 * digest together, the same rule the list is sorted by.
 *
 * Two kinds of pair are left out because running them says nothing a
 * single digest does not: one whose cuts all fall where the other's do (an
 * isoschizomer, or an enzyme whose site sits inside the other's), and one
 * whose gel cannot be read. Ties keep the order the candidates came in, so
 * the list is stable as it is recomputed.
 */
export function bestPairs(
  candidates: readonly PairCandidate[],
  seqLength: number,
  topology: Topology,
  limit = 5,
  options: GelOptions = {},
): RankedPair[] {
  const judge = pairJudge(seqLength, topology, options);
  const sorted = candidates.map((c) => sortedCuts(c.cuts, seqLength, topology));
  const pairs: RankedPair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const profile = judge(sorted[i] ?? [], sorted[j] ?? []);
      const a = candidates[i];
      const b = candidates[j];
      if (profile !== null && a !== undefined && b !== undefined)
        pairs.push({ first: a.name, second: b.name, profile });
    }
  }
  // Stable, so candidates earlier in the list win a tie.
  pairs.sort((x, y) => compareDiagnostic(x.profile, y.profile, options));
  return pairs.slice(0, limit);
}

/**
 * The best partners for one enzyme: `bestPairs` with one side fixed, for
 * "what do I cut with EcoRI to check this". Linear in the candidates rather
 * than quadratic, so it can look through a whole imported table instead of
 * the handful `bestPairs` is given. `first` is always the anchor; a
 * candidate of the anchor's own name is passed over.
 */
export function bestPartners(
  anchor: PairCandidate,
  candidates: readonly PairCandidate[],
  seqLength: number,
  topology: Topology,
  limit = 5,
  options: GelOptions = {},
): RankedPair[] {
  const judge = pairJudge(seqLength, topology, options);
  const cutsA = sortedCuts(anchor.cuts, seqLength, topology);
  const pairs: RankedPair[] = [];
  for (const c of candidates) {
    if (c.name === anchor.name) continue;
    const profile = judge(cutsA, sortedCuts(c.cuts, seqLength, topology));
    if (profile !== null) pairs.push({ first: anchor.name, second: c.name, profile });
  }
  pairs.sort((x, y) => compareDiagnostic(x.profile, y.profile, options));
  return pairs.slice(0, limit);
}

/**
 * An enzyme's cuts once, sorted and inside the molecule, so a pair is a
 * merge rather than a set built and a digest cut for every one of the tens
 * of thousands of pairs a big table has (docs/perf-notes.md). On a circle a
 * cut at the end is a cut at the origin.
 */
function sortedCuts(cuts: readonly number[], seqLength: number, topology: Topology): number[] {
  return [
    ...new Set(
      cuts
        .filter((x) => x >= 0 && x <= seqLength)
        .map((x) => (topology === 'circular' && seqLength > 0 ? x % seqLength : x)),
    ),
  ].sort((x, y) => x - y);
}

/**
 * The gel two enzymes' sorted cuts would give together, or null for a pair
 * not worth offering: one whose cuts all fall where the other's do (it is a
 * single digest), or one whose lane cannot be read.
 */
function pairJudge(
  seqLength: number,
  topology: Topology,
  options: GelOptions,
): (cutsA: readonly number[], cutsB: readonly number[]) => DigestProfile | null {
  const gel = { ...DEFAULT_GEL, ...options };
  const merged: number[] = [];
  return (cutsA, cutsB) => {
    merged.length = 0;
    let p = 0;
    let q = 0;
    while (p < cutsA.length || q < cutsB.length) {
      const x = cutsA[p] ?? Infinity;
      const y = cutsB[q] ?? Infinity;
      const next = Math.min(x, y);
      if (x === next) p++;
      if (y === next) q++;
      merged.push(next);
    }
    if (merged.length === cutsA.length || merged.length === cutsB.length) return null;
    const lengths = fragmentLengths(merged, seqLength, topology).sort((x, y) => y - x);
    // Most pairs of a big table fail, so the cheap half of `readable` is
    // asked first and a profile is built only for a lane worth ranking.
    if (!mayBeReadable(lengths, gel)) return null;
    const profile = gelProfile(lengths, options);
    return profile.readable ? profile : null;
  };
}

/** "3,224 + 1,137 bp", the band sizes as a gel would show them. */
export function describeBands(profile: DigestProfile, max = 4): string {
  const shown = profile.bands
    .slice(0, max)
    .map(
      (b) =>
        `${b.length.toLocaleString()}${b.fragments.length > 1 ? ` ×${b.fragments.length}` : ''}`,
    );
  const rest = profile.bands.length - shown.length;
  return `${shown.join(' + ')}${rest > 0 ? ` + ${rest} more` : ''} bp`;
}

/** Why a gel would not be read at a glance; empty when it would. */
export function bandProblems(profile: DigestProfile, options: GelOptions = {}): string[] {
  const { minVisible, maxResolved } = { ...DEFAULT_GEL, ...options };
  const out: string[] = [];
  if (profile.bands.length < 2) out.push('one band, so there is nothing to tell apart');
  const shared = profile.bands.filter((b) => b.fragments.length > 1);
  const one = shared[0];
  if (one !== undefined) {
    // One pair or triple is worth naming; a lane full of them is a count.
    // A digest of every single cutter of a plasmid has a dozen such groups,
    // and listing them all is a paragraph nobody reads.
    out.push(
      shared.length === 1 && one.fragments.length <= 3
        ? `${one.fragments.map((n) => n.toLocaleString()).join(' and ')} run together`
        : `${profile.comigrating} fragments run together under ${shared.length} bands`,
    );
  }
  if (profile.tooSmall > 0) {
    out.push(
      `${profile.tooSmall} ${profile.tooSmall === 1 ? 'band is' : 'bands are'} under ${minVisible.toLocaleString()} bp and may run off`,
    );
  }
  if (profile.tooLarge > 1) {
    out.push(`${profile.tooLarge} bands are over ${maxResolved.toLocaleString()} bp and compress`);
  }
  return out;
}

// ------------------------------------------------------- the picture of it

/**
 * How far down the lane a fragment of `length` runs: 0 at the well, 1 at
 * the dye front.
 *
 * Mobility goes as the log of the length over the range a gel resolves, and
 * outside that range everything piles up at one end or the other — which is
 * the clamping, and is also what `maxResolved` and `minVisible` already say
 * in words. So the drawing and the warnings cannot disagree about where the
 * gel stops being informative: they are the same two numbers.
 */
export function migration(length: number, options: GelOptions = {}): number {
  const { maxResolved, frontLength } = { ...DEFAULT_GEL, ...options };
  const top = Math.log10(maxResolved);
  const bottom = Math.log10(Math.max(1, frontLength));
  if (top <= bottom) return 0;
  const x = Math.log10(Math.max(1, length));
  return Math.min(1, Math.max(0, (top - x) / (top - bottom)));
}

/** A size standard: the bands of one, longest first. */
export interface Ladder {
  readonly name: string;
  readonly bands: readonly number[];
}

/**
 * The two ladders a molecular biology bench has in the freezer. They are
 * here so a drawn gel has a scale beside it — a lane of bands with nothing
 * to measure against is a picture, not a reading.
 */
export const LADDERS: readonly Ladder[] = [
  {
    name: '1 kb',
    bands: [10_000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500],
  },
  {
    name: '100 bp',
    bands: [1500, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
  },
  {
    // Both scales in one lane, for a digest with a large and a small piece.
    name: '1 kb Plus',
    bands: [
      10_000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400,
      300, 200, 100,
    ],
  },
];

/** A ladder by name, or `auto` for whichever spans what is being run. */
export type LadderChoice = 'auto' | '1 kb' | '100 bp' | '1 kb Plus';

export const LADDER_CHOICES: readonly LadderChoice[] = ['auto', '1 kb', '1 kb Plus', '100 bp'];

export function isLadderChoice(v: unknown): v is LadderChoice {
  return typeof v === 'string' && (LADDER_CHOICES as readonly string[]).includes(v);
}

/**
 * The ladder to draw: the one asked for, or with `auto` the one that spans
 * what is being run — the 100 bp one for small stuff.
 */
export function chooseLadder(lengths: readonly number[], choice: LadderChoice = 'auto'): Ladder {
  const named = LADDERS.find((l) => l.name === choice);
  if (named !== undefined) return named;
  const longest = lengths.reduce((n, x) => Math.max(n, x), 0);
  const fine = LADDERS[1];
  const coarse = LADDERS[0];
  if (coarse === undefined || fine === undefined) throw new Error('No ladders');
  return longest <= 1500 ? fine : coarse;
}

/**
 * How brightly each band stains, 0–1 against the brightest in the lane.
 *
 * A stain binds DNA by mass, not by molarity, so a 4 kb band and a 200 bp
 * band at the same molar amount are not equally bright — the short one is
 * faint, and on a real gel it is the one people miss. The square root
 * compresses that twentyfold difference into something a drawing can show
 * without making the faint band invisible, which would be truthful and
 * useless.
 */
export function bandIntensities(bands: readonly GelBand[]): number[] {
  const mass = bands.map((b) => b.fragments.reduce((n, x) => n + x, 0));
  const brightest = mass.reduce((n, x) => Math.max(n, x), 0);
  if (brightest <= 0) return mass.map(() => 0);
  return mass.map((m) => Math.sqrt(m / brightest));
}

/** "2,181 ×2", the label a band carries beside the lane. */
export function bandLabel(band: GelBand): string {
  return `${band.length.toLocaleString()}${band.fragments.length > 1 ? ` \u00d7${band.fragments.length}` : ''}`;
}
