import {
  type AlignmentOptions,
  type StrandedAlignment,
  TRIM_CUTOFF,
  CONFIDENT_QUALITY,
  trimByQuality,
} from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { type ColumnVote, callColumn } from './consensus';

/**
 * Assembling Sanger reads into contigs with no reference (#208): greedy
 * overlap-layout-consensus for a few to a few dozen reads. The reads are
 * trimmed by quality, the best read seeds a contig, and each other read is
 * aligned (locally, on whichever strand fits) to the contig's consensus and
 * joined if it overlaps an end, or lies inside, with enough identity. The
 * layout is a multiple alignment kept column by column, so the consensus of
 * each column is called from every read at once with their qualities
 * (`callColumn`), and a read's insertion or deletion is a column of its own.
 * Reads that join nothing seed contigs of their own.
 *
 * Alignment is a parameter, so the browser runs it in the analysis worker
 * and the tests run it inline.
 */

export interface AssemblyRead {
  readonly name: string;
  /** Bases; any case, IUPAC codes allowed (they vote for nothing). */
  readonly sequence: string;
  /** Phred qualities, one per base; absent for a read without them. */
  readonly qualities?: ArrayLike<number> | null;
}

export type AssemblyAlign = (
  a: string,
  b: string,
  options: AlignmentOptions,
) => Promise<StrandedAlignment>;

export interface AssemblyOptions {
  readonly align: AssemblyAlign;
  /** Error rate to trim reads with qualities at (Mott), or null not to trim. Default `TRIM_CUTOFF`. */
  readonly trimCutoff?: number | null;
  /** Fewest aligned bases for a read to join a contig. Default 25. */
  readonly minOverlap?: number;
  /** Lowest identity over the overlap. Default 0.9. */
  readonly minIdentity?: number;
  /** Quality from which a dissenting base is flagged. Default Q20. */
  readonly confidentFrom?: number;
  /** Told the fraction of the work done. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** Quality assumed for a read that has none: Sanger's usual line for a good base. */
export const ASSUMED_QUALITY = 20;

/**
 * The bases at an end of a read that may be left out, or paired off one to
 * one with the contig, when the local alignment stopped short of the end.
 */
const END_SLACK = 8;

export interface ContigRead {
  /** Index in the reads given. */
  readonly index: number;
  readonly name: string;
  /** 'reverse' when the read was turned over to lie along the consensus. */
  readonly strand: 'forward' | 'reverse';
  /** The stretch of the read kept after trimming, 0-based half-open, in the read as given. */
  readonly trimmed: { readonly start: number; readonly end: number };
  /** The consensus stretch it covers, 0-based half-open. */
  readonly start: number;
  readonly end: number;
  /**
   * The read under each consensus position: its base, '-' for a base it
   * lacks, ' ' outside its stretch. As long as the consensus; a base the
   * read has where the consensus has none (a minority insertion) is not shown.
   */
  readonly row: string;
}

export interface Disagreement {
  /** 0-based position in the consensus. */
  readonly position: number;
  readonly call: string;
  readonly quality: number;
  /** Whether the call is an ambiguity code. */
  readonly ambiguous: boolean;
  /** Each read that has something at this position: its base ('-' for a gap) and quality. */
  readonly votes: readonly {
    readonly read: number;
    readonly base: string;
    readonly quality: number;
  }[];
}

/**
 * Something about a contig the reads cannot settle (#347). A repeat longer
 * than the reads cannot be resolved from them, so the layout may be wrong
 * where it says so.
 */
export interface ContigWarning {
  /**
   * `ambiguous-join`: `read` fits the contig at more than one place (it lies
   * in a sequence the contig has twice) and was put at the best.
   * `possible-repeat-collapse`: the stretch is covered far deeper than the
   * rest, as when reads from two copies of a repeat are laid on one, so the
   * contig may lack what lies between the copies.
   */
  readonly kind: 'ambiguous-join' | 'possible-repeat-collapse';
  /** The stretch of the consensus concerned, 0-based half-open. */
  readonly start: number;
  readonly end: number;
  /** Index of the read, for `ambiguous-join`. */
  readonly read?: number;
  readonly message: string;
}

export interface Contig {
  /** Upper-case, with IUPAC codes where confident reads disagree. */
  readonly consensus: string;
  /** Phred quality of each consensus base, 0–60. */
  readonly qualities: readonly number[];
  readonly reads: readonly ContigRead[];
  /** Where the reads disagree: an ambiguity call or a dissenting base at or above `confidentFrom`. */
  readonly disagreements: readonly Disagreement[];
  /** Reads covering each consensus position. */
  readonly depth: readonly number[];
  /** Where the layout may be wrong because of a repeat; empty when nothing suggests it. */
  readonly warnings: readonly ContigWarning[];
}

export interface Assembly {
  /** Biggest first (most reads, then longest). */
  readonly contigs: readonly Contig[];
  /** Reads with nothing left after trimming, with the reason. */
  readonly skipped: readonly {
    readonly index: number;
    readonly name: string;
    readonly reason: string;
  }[];
  /** Whether any read had qualities; if none did the call qualities are only a model of Q20 reads. */
  readonly hasQualities: boolean;
}

interface Prepared {
  readonly index: number;
  readonly name: string;
  readonly trimmed: { readonly start: number; readonly end: number };
  readonly bases: string;
  /** Qualities of the trimmed read, or null when it had none. */
  readonly quals: readonly number[] | null;
}

interface Oriented {
  readonly bases: string;
  readonly quals: readonly number[];
  readonly strand: 'forward' | 'reverse';
}

/** One read's cells in the multiple alignment: a base, '-' inside its stretch, ' ' outside. */
interface Row {
  readonly read: Prepared;
  readonly strand: 'forward' | 'reverse';
  cells: string[];
  quals: number[];
}

class Layout {
  rows: Row[] = [];
  /** Reads placed while another place fitted them as well (indexes in the reads given). */
  ambiguous: number[] = [];

  get columns(): number {
    return this.rows[0]?.cells.length ?? 0;
  }

  static seed(read: Prepared, o: Oriented): Layout {
    const l = new Layout();
    l.rows.push({ read, strand: o.strand, cells: Array.from(o.bases), quals: [...o.quals] });
    return l;
  }

  /** Quality of each cell; a gap takes the lower of the nearest bases either side in its row. */
  private effectiveQuals(row: Row): number[] {
    const n = row.cells.length;
    const left = new Array<number>(n).fill(Infinity);
    let last = Infinity;
    for (let c = 0; c < n; c++) {
      const ch = row.cells[c];
      if (ch === ' ') last = Infinity;
      else if (ch !== '-') last = row.quals[c] ?? 0;
      left[c] = last;
    }
    const out = new Array<number>(n).fill(0);
    last = Infinity;
    for (let c = n - 1; c >= 0; c--) {
      const ch = row.cells[c];
      if (ch === ' ') last = Infinity;
      else if (ch !== '-') last = row.quals[c] ?? 0;
      const q = ch === '-' ? Math.min(left[c] ?? Infinity, last) : (row.quals[c] ?? 0);
      out[c] = Number.isFinite(q) ? q : 0;
    }
    return out;
  }

  /** What every column is, as called from all the reads in it. */
  calls(): { votes: { row: number; vote: ColumnVote }[][]; call: ReturnType<typeof callColumn>[] } {
    const n = this.columns;
    const votes: { row: number; vote: ColumnVote }[][] = Array.from({ length: n }, () => []);
    this.rows.forEach((row, r) => {
      const eq = this.effectiveQuals(row);
      for (let c = 0; c < n; c++) {
        const ch = row.cells[c] ?? ' ';
        if (ch === ' ') continue;
        votes[c]?.push({ row: r, vote: { base: ch, quality: eq[c] ?? 0 } });
      }
    });
    return { votes, call: votes.map((v) => callColumn(v.map((x) => x.vote))) };
  }

  /** The consensus string, the layout column of each of its bases and the quality each is called at. */
  consensus(): { text: string; column: number[]; quals: number[] } {
    const { call } = this.calls();
    let text = '';
    const column: number[] = [];
    const quals: number[] = [];
    call.forEach((c, i) => {
      if (c.symbol === '') return;
      text += c.symbol;
      column.push(i);
      quals.push(c.quality);
    });
    return { text, column, quals };
  }

  /** Inserts `count` columns before `at`; a row has a gap there if it covers both sides. */
  private insertColumns(
    at: number,
    count: number,
    into: Row,
    bases: string,
    quals: number[],
  ): void {
    for (const row of this.rows) {
      const covered =
        row.cells[at - 1] !== undefined &&
        row.cells[at - 1] !== ' ' &&
        row.cells[at] !== ' ' &&
        row.cells[at] !== undefined;
      if (row === into) {
        row.cells.splice(at, 0, ...Array.from(bases));
        row.quals.splice(at, 0, ...quals);
      } else {
        row.cells.splice(at, 0, ...new Array<string>(count).fill(covered ? '-' : ' '));
        row.quals.splice(at, 0, ...new Array<number>(count).fill(0));
      }
    }
  }

  /**
   * Adds `read`, aligned by `hit` to the consensus `cons` whose bases sit
   * in the layout columns `cons.column`. The caller has checked the hit.
   */
  add(read: Prepared, o: Oriented, hit: Hit, cons: { column: number[] }): void {
    const n = this.columns;
    const row: Row = {
      read,
      strand: o.strand,
      cells: new Array<string>(n).fill(' '),
      quals: new Array<number>(n).fill(0),
    };
    const colOf = (a: number): number => cons.column[a] ?? -1;
    const { alignment: al } = hit;
    // Inside the alignment: matches and read gaps go in the columns of the
    // consensus bases; read insertions are runs to give columns of their own.
    const inserts: { before: number; bases: string; quals: number[] }[] = [];
    let a = al.startA;
    let b = al.startB;
    let run: { before: number; bases: string; quals: number[] } | null = null;
    for (let c = 0; c < al.columns; c++) {
      const x = al.alignedA.charAt(c);
      const y = al.alignedB.charAt(c);
      if (x === '-') {
        // The read has a base the consensus lacks.
        if (run === null) {
          run = { before: colOf(a) >= 0 ? colOf(a) : n, bases: '', quals: [] };
          inserts.push(run);
        }
        run.bases += o.bases.charAt(b);
        run.quals.push(o.quals[b] ?? 0);
        b++;
        continue;
      }
      run = null;
      const col = colOf(a);
      if (y === '-') {
        row.cells[col] = '-';
      } else {
        row.cells[col] = o.bases.charAt(b);
        row.quals[col] = o.quals[b] ?? 0;
        b++;
      }
      a++;
    }
    // The ends of the read the alignment did not reach.
    const left = planEnd(al.startA, al.startB);
    const right = planEnd(hit.consLength - al.endA, o.bases.length - al.endB);
    const leftBases: string[] = [];
    const leftQuals: number[] = [];
    for (let k = 1; k <= left.pair; k++) {
      const col = colOf(al.startA - k);
      row.cells[col] = o.bases.charAt(al.startB - k);
      row.quals[col] = o.quals[al.startB - k] ?? 0;
    }
    for (let k = 0; k < left.extend; k++) {
      const i = al.startB - left.pair - left.extend + k;
      leftBases.push(o.bases.charAt(i));
      leftQuals.push(o.quals[i] ?? 0);
    }
    const rightBases: string[] = [];
    const rightQuals: number[] = [];
    for (let k = 0; k < right.pair; k++) {
      const col = colOf(al.endA + k);
      row.cells[col] = o.bases.charAt(al.endB + k);
      row.quals[col] = o.quals[al.endB + k] ?? 0;
    }
    for (let k = 0; k < right.extend; k++) {
      const i = al.endB + right.pair + k;
      rightBases.push(o.bases.charAt(i));
      rightQuals.push(o.quals[i] ?? 0);
    }
    // Between the first and last column the read covers, any column it did
    // not put a base in (one the consensus left out) is a gap in the read.
    const cov2 = row.cells.map((ch) => ch !== ' ');
    const f2 = cov2.indexOf(true);
    const l2 = cov2.lastIndexOf(true);
    for (let c = f2; c <= l2; c++) if (row.cells[c] === ' ') row.cells[c] = '-';

    this.rows.push(row);
    // Right to left so the columns still to insert keep their numbers.
    for (const ins of [...inserts].sort((p, q) => q.before - p.before)) {
      this.insertColumns(ins.before, ins.bases.length, row, ins.bases, ins.quals);
    }
    if (leftBases.length > 0) {
      for (const r of this.rows) {
        if (r === row) {
          r.cells.unshift(...leftBases);
          r.quals.unshift(...leftQuals);
        } else {
          r.cells.unshift(...new Array<string>(leftBases.length).fill(' '));
          r.quals.unshift(...new Array<number>(leftBases.length).fill(0));
        }
      }
    }
    if (rightBases.length > 0) {
      for (const r of this.rows) {
        if (r === row) {
          r.cells.push(...rightBases);
          r.quals.push(...rightQuals);
        } else {
          r.cells.push(...new Array<string>(rightBases.length).fill(' '));
          r.quals.push(...new Array<number>(rightBases.length).fill(0));
        }
      }
    }
  }
}

interface Candidate {
  readonly alignment: StrandedAlignment['alignment'];
  readonly o: Oriented;
  /** Whether it is an overlap at an end of the consensus, or the read lying inside it. */
  readonly valid: boolean;
}

/**
 * With the default gap costs a local alignment runs on past a repeat through
 * unrelated sequence (a gap costs half a base to extend), which hides a short
 * true overlap beside it, so places are searched with a gap that costs as
 * much as a mismatch to extend.
 */
const PLACEMENT_ALIGN: AlignmentOptions = { mode: 'local', fast: true, gapExtend: -4 };

/** Bases of an end of the consensus and of an end of a read that are aligned to look for an overlap. */
const CORNER = 300;

type PairAlignment = StrandedAlignment['alignment'];

/** The consensus a read is placed on: its bases and the quality each is called at. */
interface Consensus {
  readonly text: string;
  readonly quals: readonly number[];
}

/**
 * The stretch of an alignment that holds identity `minIdentity` or better
 * with the most bases matched (a column that is not a match costs what the
 * identity allows per match), or null when no column matches.
 */
function core(a: PairAlignment, minIdentity: number): PairAlignment | null {
  const miss = minIdentity / (1 - minIdentity);
  let best = 0;
  let from = 0;
  let to = 0;
  let run = 0;
  let begin = 0;
  for (let c = 0; c < a.columns; c++) {
    const mark = a.matchLine.charAt(c);
    run += mark === '|' ? 1 : -miss;
    if (run <= 0) {
      run = 0;
      begin = c + 1;
    } else if (run > best) {
      best = run;
      from = begin;
      to = c + 1;
    }
  }
  if (to <= from) return null;
  const line = a.matchLine.slice(from, to);
  const sa = a.alignedA.slice(from, to);
  const sb = a.alignedB.slice(from, to);
  const used = (text: string): number => text.length - (text.match(/-/g)?.length ?? 0);
  const startA = a.startA + used(a.alignedA.slice(0, from));
  const startB = a.startB + used(a.alignedB.slice(0, from));
  const identities = line.match(/\|/g)?.length ?? 0;
  const ambiguous = line.match(/:/g)?.length ?? 0;
  const gaps = (sa.match(/-/g)?.length ?? 0) + (sb.match(/-/g)?.length ?? 0);
  return {
    ...a,
    alignedA: sa,
    alignedB: sb,
    matchLine: line,
    startA,
    endA: startA + used(sa),
    startB,
    endB: startB + used(sb),
    identities,
    ambiguous,
    gaps,
    columns: line.length,
    identity: identities / line.length,
    score: 5 * identities - 4 * (line.length - identities - gaps),
  };
}

/** Chance a base of Phred quality `q` is wrong. */
const errorOf = (q: number | undefined): number =>
  Math.min(0.75, 10 ** (-Math.min(60, Math.max(1, q ?? ASSUMED_QUALITY)) / 10));

/**
 * The lowest identity an overlap may have when the qualities of its bases
 * account for the columns that do not match (#349). Unrelated sequence
 * matches at about 25 to 60 %, so this leaves it far out of reach.
 */
const QUALITY_FLOOR = 0.8;

/**
 * Whether the columns of `a` that are not a match are about as many as the
 * qualities of the bases in them lead to expect (#349): each column is wrong
 * with the chance of either base being wrong (a gap column, the chance of the
 * base that is there), and the count allowed is that sum plus two standard
 * deviations and one. Two reads whose overlap is all poor ends can fall under
 * 90 % identity on errors they say they have; a pair of good reads that
 * differ as much cannot. `consFrom` and `readFrom` are where the alignment's
 * first columns sit in `consQ` and `readQ`.
 */
function explainedByQuality(
  a: PairAlignment,
  consQ: readonly number[],
  consFrom: number,
  readQ: readonly number[],
  readFrom: number,
  slack: number,
  floor = QUALITY_FLOOR,
): boolean {
  if (a.identity < floor) return false;
  let i = consFrom;
  let j = readFrom;
  let expected = 0;
  let miss = 0;
  for (let c = 0; c < a.columns; c++) {
    const x = a.alignedA.charCodeAt(c) === 45;
    const y = a.alignedB.charCodeAt(c) === 45;
    if (x) {
      expected += errorOf(readQ[j]);
      miss++;
    } else if (y) {
      expected += errorOf(consQ[i]);
      miss++;
    } else {
      expected += errorOf(consQ[i]) + errorOf(readQ[j]);
      const mark = a.matchLine.charAt(c);
      if (mark !== '|' && mark !== ':') miss++;
    }
    if (!x) i++;
    if (!y) j++;
  }
  return miss <= expected + slack * Math.sqrt(expected) + 1;
}

/**
 * The best place a stretch `[from, to)` of the read, as given, fits the part
 * `[lo, hi)` of the consensus: its local alignment with the overlap and
 * identity asked for, in the coordinates of the whole consensus and of the
 * whole read turned the way the alignment found it, or null. The identity
 * asked for is `minIdentity`, or less where the qualities of the bases that
 * differ explain it (#349).
 */
async function placeStretch(
  cons: Consensus,
  [lo, hi]: readonly [number, number],
  read: Prepared,
  [from, to]: readonly [number, number],
  align: AssemblyAlign,
  minOverlap: number,
  minIdentity: number,
): Promise<(Candidate & { readonly used: readonly [number, number] }) | null> {
  const piece = lo === 0 && hi === cons.text.length ? cons.text : cons.text.slice(lo, hi);
  const best = await align(
    piece,
    from === 0 && to === read.bases.length ? read.bases : read.bases.slice(from, to),
    PLACEMENT_ALIGN,
  );
  const n = read.bases.length;
  const o = orient(read, best.strand);
  // Bases of the whole read, turned as aligned, before the stretch.
  const shift = best.strand === 'forward' ? from : n - to;
  const place = (a: PairAlignment): PairAlignment => ({
    ...a,
    startA: a.startA + lo,
    endA: a.endA + lo,
    startB: a.startB + shift,
    endB: a.endB + shift,
  });
  const passes = (a: PairAlignment): boolean =>
    a.endA - a.startA >= minOverlap &&
    (a.identity >= minIdentity ||
      explainedByQuality(a, cons.quals, a.startA, o.quals, a.startB, 3));
  let alignment = place(best.alignment);
  if (alignment.identity < minIdentity && !passes(alignment)) {
    // A local alignment can run on past a repeat into unrelated sequence while
    // that still adds score; what is left of it above the identity asked is
    // the overlap.
    const core0 = core(best.alignment, minIdentity);
    if (core0 === null) return null;
    alignment = place(core0);
  }
  if (!passes(alignment)) return null;
  return {
    alignment,
    o,
    valid:
      planEnd(alignment.startA, alignment.startB).ok &&
      planEnd(cons.text.length - alignment.endA, o.bases.length - alignment.endB).ok,
    used:
      best.strand === 'forward'
        ? [alignment.startB, alignment.endB]
        : [n - alignment.endB, n - alignment.startB],
  };
}

/**
 * Where the read joins the consensus (#348), best first, or nothing: its best
 * local alignment to all of it and, when that is an alignment but no overlap, the best
 * alignment of each end of the read to each end of the consensus, `CORNER`
 * bases of each. A read that spans a repeat aligns best to a copy of the
 * repeat inside the consensus, which is no overlap, and the shorter overlap
 * that joins it would never be tried; an end of the consensus is short enough
 * that it is not shadowed by a copy deeper in. A candidate is `valid` when it
 * reaches an end of the consensus or the read lies inside it.
 */
async function findPlacements(
  cons: Consensus,
  read: Prepared,
  align: AssemblyAlign,
  minOverlap: number,
  minIdentity: number,
): Promise<Candidate[]> {
  const n = read.bases.length;
  const whole = await placeStretch(
    cons,
    [0, cons.text.length],
    read,
    [0, n],
    align,
    minOverlap,
    minIdentity,
  );
  if (whole === null) return [];
  if (whole.valid) return [whole];
  const out: Candidate[] = [whole];
  const ends: [number, number][] = [
    [0, Math.min(CORNER, cons.text.length)],
    [Math.max(0, cons.text.length - CORNER), cons.text.length],
  ];
  const reads: [number, number][] = [
    [0, Math.min(CORNER, n)],
    [Math.max(0, n - CORNER), n],
  ];
  for (const span of ends) {
    for (const stretch of reads) {
      const found = await placeStretch(cons, span, read, stretch, align, minOverlap, minIdentity);
      if (found !== null) out.push(found);
    }
  }
  return out;
}

/**
 * Whether the read, placed at `chosen`, fits the consensus as well somewhere
 * else (#347): the whole read aligned to what is left of the consensus either
 * side of the chosen place, valid there too. A read inside a sequence the
 * consensus has twice does.
 */
async function fitsElsewhere(
  cons: Consensus,
  read: Prepared,
  chosen: Candidate,
  align: AssemblyAlign,
  minOverlap: number,
  minIdentity: number,
): Promise<boolean> {
  const { startA, endA } = chosen.alignment;
  for (const span of [
    [0, startA],
    [endA, cons.text.length],
  ] as const) {
    if (span[1] - span[0] < minOverlap) continue;
    const other = await placeStretch(
      cons,
      span,
      read,
      [0, read.bases.length],
      align,
      minOverlap,
      minIdentity,
    );
    if (other?.valid === true) return true;
  }
  return false;
}

interface Hit {
  readonly alignment: StrandedAlignment['alignment'];
  readonly consLength: number;
}

/**
 * What to do at one end where the alignment stopped with `cons` bases of the
 * consensus and `read` bases of the read still beyond it: nothing is
 * `ok: false` when both are long (the read is not an overlap there). Within
 * `END_SLACK` of the consensus end the read's bases are paired off with it
 * one to one and any further ones extend it; at a read's own end within
 * slack, the few bases are left out.
 */
function planEnd(cons: number, read: number): { ok: boolean; pair: number; extend: number } {
  if (cons <= END_SLACK) {
    const pair = Math.min(cons, read);
    return { ok: true, pair, extend: read - pair };
  }
  return { ok: read <= END_SLACK, pair: 0, extend: 0 };
}

function orient(read: Prepared, strand: 'forward' | 'reverse'): Oriented {
  const quals = read.quals ?? new Array<number>(read.bases.length).fill(ASSUMED_QUALITY);
  return strand === 'forward'
    ? { bases: read.bases, quals, strand }
    : { bases: reverseComplement(read.bases), quals: [...quals].reverse(), strand };
}

function prepare(
  reads: readonly AssemblyRead[],
  trimCutoff: number | null,
): { prepared: Prepared[]; skipped: Assembly['skipped'] } {
  const prepared: Prepared[] = [];
  const skipped: { index: number; name: string; reason: string }[] = [];
  reads.forEach((r, index) => {
    const seq = r.sequence.toUpperCase().replace(/U/g, 'T');
    const q = r.qualities === undefined || r.qualities === null ? null : Array.from(r.qualities);
    if (q !== null && q.length !== seq.length) {
      skipped.push({ index, name: r.name, reason: 'Its qualities do not match its bases' });
      return;
    }
    const range =
      q === null || trimCutoff === null
        ? { start: 0, end: seq.length }
        : trimByQuality(q, trimCutoff);
    if (range.end - range.start === 0) {
      skipped.push({
        index,
        name: r.name,
        reason: q === null ? 'It is empty' : 'No base of it is good enough to keep after trimming',
      });
      return;
    }
    prepared.push({
      index,
      name: r.name,
      trimmed: range,
      bases: seq.slice(range.start, range.end),
      quals: q === null ? null : q.slice(range.start, range.end),
    });
  });
  return { prepared, skipped };
}

export async function assembleReads(
  reads: readonly AssemblyRead[],
  options: AssemblyOptions,
): Promise<Assembly> {
  const {
    align,
    trimCutoff = TRIM_CUTOFF,
    minOverlap = 25,
    minIdentity = 0.9,
    confidentFrom = CONFIDENT_QUALITY,
    onProgress,
    signal,
  } = options;
  const { prepared, skipped } = prepare(reads, trimCutoff);
  const hasQualities = reads.some((r) => r.qualities !== undefined && r.qualities !== null);
  // Longest first: the seed, and the order reads are tried in.
  const pool = [...prepared].sort((a, b) => b.bases.length - a.bases.length || a.index - b.index);
  const total = pool.length;
  let done = 0;
  const layouts: Layout[] = [];
  while (pool.length > 0) {
    const seed = pool.shift();
    if (seed === undefined) break;
    const layout = Layout.seed(seed, orient(seed, 'forward'));
    done++;
    onProgress?.(done / total);
    // The read with the best overlap joins first, not the first that fits: a
    // repeat gives a short read an overlap as long as a true one, but a long
    // true overlap elsewhere wins, and by the time the read is reached the
    // contig has grown to where it belongs (#347).
    // A read that fits nothing in the contig stays out of the rounds until a
    // read that joins overlaps it (a rough test, but one that saves aligning
    // every unrelated read to a growing consensus once per join).
    const unrelated = new Set<Prepared>();
    while (pool.length > 0) {
      const cons = layout.consensus();
      const picks: { read: Prepared; at: number; pick: Candidate }[] = [];
      for (let i = 0; i < pool.length; i++) {
        signal?.throwIfAborted();
        const read = pool[i];
        if (read === undefined || unrelated.has(read)) continue;
        const found = await findPlacements(cons, read, align, minOverlap, minIdentity);
        if (found.length === 0) unrelated.add(read);
        const pick = found
          .filter((c) => c.valid)
          .reduce<Candidate | undefined>(
            (best, c) =>
              best === undefined || c.alignment.score > best.alignment.score ? c : best,
            undefined,
          );
        if (pick !== undefined) picks.push({ read, at: i, pick });
      }
      if (picks.length === 0) break;
      picks.sort((p, q) => q.pick.alignment.score - p.pick.alignment.score || p.at - q.at);
      // One that fits at a second place waits for one that does not; if
      // every one does, the best goes in, with a warning.
      let chosen = picks[0];
      let ambiguous = true;
      for (const p of picks) {
        const elsewhere = await fitsElsewhere(cons, p.read, p.pick, align, minOverlap, minIdentity);
        if (!elsewhere) {
          chosen = p;
          ambiguous = false;
          break;
        }
      }
      if (chosen === undefined) break;
      layout.add(
        chosen.read,
        chosen.pick.o,
        { alignment: chosen.pick.alignment, consLength: cons.text.length },
        cons,
      );
      if (ambiguous) layout.ambiguous.push(chosen.read.index);
      pool.splice(chosen.at, 1);
      for (const read of [...unrelated]) {
        const hit = (await align(read.bases, chosen.read.bases, PLACEMENT_ALIGN)).alignment;
        const a = hit.identity < minIdentity ? core(hit, minIdentity) : hit;
        if (a !== null && a.endA - a.startA >= minOverlap && a.identity >= minIdentity) {
          unrelated.delete(read);
        }
      }
      done++;
      onProgress?.(done / total);
    }
    layouts.push(layout);
  }
  const contigs = layouts.map((l) => finish(l, confidentFrom));
  contigs.sort(
    (a, b) => b.reads.length - a.reads.length || b.consensus.length - a.consensus.length,
  );
  return { contigs, skipped, hasQualities };
}

function finish(layout: Layout, confidentFrom: number): Contig {
  const { votes, call } = layout.calls();
  const column: number[] = [];
  call.forEach((c, i) => {
    if (c.symbol !== '') column.push(i);
  });
  const consensus = column.map((c) => call[c]?.symbol ?? 'N').join('');
  const qualities = column.map((c) => call[c]?.quality ?? 0);
  const depth = column.map((c) => votes[c]?.filter((v) => v.vote.base !== '-').length ?? 0);
  const disagreements: Disagreement[] = [];
  column.forEach((c, position) => {
    const cc = call[c];
    const vs = votes[c] ?? [];
    if (cc === undefined) return;
    const dissent = vs.some(
      (v) =>
        v.vote.quality >= confidentFrom &&
        (v.vote.base === '-' || 'ACGT'.includes(v.vote.base)) &&
        !(v.vote.base !== '-' && ambiguityIncludes(cc.symbol, v.vote.base)),
    );
    if (!cc.ambiguous && !dissent) return;
    disagreements.push({
      position,
      call: cc.symbol,
      quality: cc.quality,
      ambiguous: cc.ambiguous,
      votes: vs.map((v) => ({
        read: layout.rows[v.row]?.read.index ?? -1,
        base: v.vote.base,
        quality: v.vote.quality,
      })),
    });
  });
  const reads: ContigRead[] = layout.rows.map((row) => {
    const cells = column.map((c) => row.cells[c] ?? ' ');
    const covered = cells.map((ch) => ch !== ' ');
    const start = Math.max(0, covered.indexOf(true));
    const end = covered.lastIndexOf(true) + 1;
    return {
      index: row.read.index,
      name: row.read.name,
      strand: row.strand,
      trimmed: row.read.trimmed,
      start,
      end,
      row: cells.join(''),
    };
  });
  reads.sort((a, b) => a.start - b.start || a.index - b.index);
  const warnings: ContigWarning[] = [];
  for (const index of layout.ambiguous) {
    const r = reads.find((x) => x.index === index);
    if (r === undefined) continue;
    warnings.push({
      kind: 'ambiguous-join',
      start: r.start,
      end: r.end,
      read: index,
      message: `${r.name} fits this contig at more than one place, so it may belong to another copy of a repeat.`,
    });
  }
  warnings.push(...collapseWarnings(depth, reads.length));
  return { consensus, qualities, reads, disagreements, depth, warnings };
}

/** Reads at least a stretch of this depth is made of before it is told from an ordinary pile-up. */
const COLLAPSE_DEPTH = 3;
/** Bases a stretch of that depth must run for. */
const COLLAPSE_WIDTH = 100;
/** The deepest point in the stretch must reach this. */
const COLLAPSE_PEAK = 4;
/** How many times the contig's median depth the stretch must average. */
const COLLAPSE_RATIO = 3;

/**
 * Where a contig is covered far deeper than it is anywhere else (#347):
 * reads from two copies of a repeat laid on one copy pile up there, and the
 * contig lacks what lay between the copies. Reads cannot tell the copies
 * apart when none of them reaches out of the repeat on both sides, so this
 * only says it may be so. It looks for a stretch of `COLLAPSE_WIDTH` bases
 * or more at depth `COLLAPSE_DEPTH` or more, reaching `COLLAPSE_PEAK`, whose
 * mean depth is `COLLAPSE_RATIO` times the contig's median, in a contig of
 * four reads or more. Four or more reads piled on one region on purpose look
 * the same.
 */
function collapseWarnings(depth: readonly number[], readCount: number): ContigWarning[] {
  if (readCount < 4 || depth.length === 0) return [];
  const median = [...depth].sort((p, q) => p - q)[depth.length >> 1] ?? 0;
  const out: ContigWarning[] = [];
  let from = -1;
  const close = (to: number): void => {
    if (from < 0) return;
    const width = to - from;
    if (width >= COLLAPSE_WIDTH) {
      let sum = 0;
      let peak = 0;
      for (let i = from; i < to; i++) {
        sum += depth[i] ?? 0;
        peak = Math.max(peak, depth[i] ?? 0);
      }
      const mean = sum / width;
      if (peak >= COLLAPSE_PEAK && mean >= COLLAPSE_RATIO * Math.max(1, median)) {
        out.push({
          kind: 'possible-repeat-collapse',
          start: from,
          end: to,
          message: `${from + 1}–${to} is covered ${Math.round(mean * 10) / 10}× deep where the contig is ${median}× deep: reads from two copies of a repeat may have been laid on one, and the sequence between the copies may be missing.`,
        });
      }
    }
    from = -1;
  };
  depth.forEach((d, i) => {
    if (d >= COLLAPSE_DEPTH) {
      if (from < 0) from = i;
    } else close(i);
  });
  close(depth.length);
  return out;
}

const IUPAC_SETS: Readonly<Record<string, string>> = {
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

function ambiguityIncludes(code: string, base: string): boolean {
  return (IUPAC_SETS[code] ?? code).includes(base);
}
