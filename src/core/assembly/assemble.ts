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

  /** The consensus string and the layout column of each of its bases. */
  consensus(): { text: string; column: number[] } {
    const { call } = this.calls();
    let text = '';
    const column: number[] = [];
    call.forEach((c, i) => {
      if (c.symbol === '') return;
      text += c.symbol;
      column.push(i);
    });
    return { text, column };
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
    // Between the first and last column the read covers, any column it did
    // not put a base in (a consensus-only column) is a gap in the read.
    const covered = row.cells.map((ch) => ch !== ' ');
    const first = covered.indexOf(true);
    const last = covered.lastIndexOf(true);
    for (let c = first; c <= last; c++) if (row.cells[c] === ' ') row.cells[c] = '-';

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
    // Fill gaps across paired ends the same way as inside.
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
    let placed = true;
    while (placed && pool.length > 0) {
      placed = false;
      let cons = layout.consensus();
      for (let i = 0; i < pool.length; i++) {
        signal?.throwIfAborted();
        const read = pool[i];
        if (read === undefined) continue;
        const best = await align(cons.text, read.bases, { mode: 'local', fast: true });
        const al = best.alignment;
        const o = orient(read, best.strand);
        const ok =
          al.endA - al.startA >= minOverlap &&
          al.identity >= minIdentity &&
          planEnd(al.startA, al.startB).ok &&
          planEnd(cons.text.length - al.endA, o.bases.length - al.endB).ok;
        if (!ok) continue;
        layout.add(read, o, { alignment: al, consLength: cons.text.length }, cons);
        pool.splice(i, 1);
        i--;
        placed = true;
        done++;
        onProgress?.(done / total);
        cons = layout.consensus();
      }
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
  return { consensus, qualities, reads, disagreements, depth };
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
