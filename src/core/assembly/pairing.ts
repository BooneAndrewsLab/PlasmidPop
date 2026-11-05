/**
 * Read pairs for assembly (#347, item 130). Two Sanger reads from the two
 * ends of one template (a forward and a reverse primer on one clone) lie on
 * opposite strands, facing each other, about one insert size apart. That is
 * the one thing a repeat longer than the reads cannot hide: a read inside a
 * copy of the repeat has a mate somewhere that says which copy, and a contig
 * that has lost the stretch between two copies puts mates too close.
 *
 * Mates are found by name (`findReadPairs`), checked against a contig's
 * layout (`checkPairs`), and the contigs they link are reported. Nothing
 * here aligns; the layout it reads is `Contig.reads`.
 */

/** Two reads that are the ends of one template: indexes in the reads given. */
export interface ReadPair {
  /** The mate named forward (F, fwd, 1, ...). */
  readonly first: number;
  /** The mate named reverse (R, rev, 2, ...). */
  readonly second: number;
  /** What the two names share, as written in the first mate's name. */
  readonly stem: string;
}

export interface PairNames {
  readonly pairs: readonly ReadPair[];
  /**
   * Names that share a stem but cannot be told apart as two mates: three or
   * more of them, two forward ones, or a forward-named and a number-named
   * read. None of them is paired.
   */
  readonly ambiguous: readonly { readonly stem: string; readonly names: readonly string[] }[];
}

const EXTENSION = /\.(?:ab1|abi|scf|seq|fasta|fa|fas|fastq|fq|txt|gb|gbk|dna)(?:\.gz)?$/i;
const FIRST = new Set(['f', 'fwd', 'for', 'forward', 'fp', '1']);
const SECOND = new Set(['r', 'rev', 'reverse', 'rvs', 'rp', '2']);
/** A mate's token after a separator: `clone_F`, `clone.rev`, `clone/2`. */
const SEPARATED = /^(.*[^\s_.\-/])[\s_.\-/]+(f|r|fwd|rev|for|rvs|forward|reverse|fp|rp|\d+)$/i;
/** Joined to a digit, as a primer is named: `M13F`, `clone5R`. */
const JOINED = /^(.*\d)(f|r|fwd|rev|for|rvs|fp|rp)$/i;
/** An Illumina header's read number: `NAME 1:N:0:ACGT`. */
const CASAVA = /^(.*\S)\s+([12]):[YN]:\d+:\S*$/;

interface Parsed {
  readonly stem: string;
  readonly mate: 'first' | 'second' | 'other';
  /** Letters and numbers are not mixed: `A_F` is not the mate of `A_2`. */
  readonly family: 'letters' | 'numbers';
}

function parseName(raw: string): Parsed | null {
  const name = raw.trim().replace(EXTENSION, '');
  const casava = CASAVA.exec(name);
  if (casava !== null) {
    return {
      stem: casava[1] ?? '',
      mate: casava[2] === '1' ? 'first' : 'second',
      family: 'numbers',
    };
  }
  const m = SEPARATED.exec(name) ?? JOINED.exec(name);
  if (m === null) return null;
  const token = (m[2] ?? '').toLowerCase();
  const numeric = /^\d+$/.test(token);
  // A number past 2 is no mate, but it says the stem is a series (clone_1,
  // clone_2, clone_3), so that clone_1 and clone_2 are not taken for a pair.
  const mate = FIRST.has(token) ? 'first' : SECOND.has(token) ? 'second' : numeric ? 'other' : null;
  if (mate === null) return null;
  return { stem: m[1] ?? '', mate, family: numeric ? 'numbers' : 'letters' };
}

/**
 * Finds the pairs among reads by their names. Two reads are mates when their
 * names are the same but for a trailing mate token, one forward (`F`, `fwd`,
 * `for`, `forward`, `FP`, `1`) and one reverse (`R`, `rev`, `reverse`, `RP`,
 * `2`), after a `_`, `.`, `-`, `/` or space, or joined to a digit as in
 * `M13F`; a file extension is ignored and case does not matter. Several
 * reads of one stem that are not exactly one of each are not guessed at.
 */
export function findReadPairs(names: readonly string[]): PairNames {
  const groups = new Map<
    string,
    { stem: string; first: number[]; second: number[]; other: number[]; all: number[] }
  >();
  names.forEach((name, index) => {
    const p = parseName(name);
    if (p === null) return;
    const key = `${p.family}\u0000${p.stem.toLowerCase()}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = { stem: p.stem, first: [], second: [], other: [], all: [] };
      groups.set(key, g);
    }
    g[p.mate].push(index);
    g.all.push(index);
  });
  // A forward-named and a number-named read of one stem are not mates, but
  // nor may they be silently let go: they share a stem.
  const byStem = new Map<string, number>();
  for (const key of groups.keys()) {
    const stem = key.split('\u0000')[1] ?? '';
    byStem.set(stem, (byStem.get(stem) ?? 0) + 1);
  }
  const pairs: ReadPair[] = [];
  const ambiguous: { stem: string; names: string[] }[] = [];
  for (const [key, g] of groups) {
    const stem = key.split('\u0000')[1] ?? '';
    const first = g.first[0];
    const second = g.second[0];
    if (
      g.other.length === 0 &&
      g.first.length === 1 &&
      g.second.length === 1 &&
      first !== undefined &&
      second !== undefined &&
      byStem.get(stem) === 1
    ) {
      pairs.push({ first, second, stem: g.stem });
    } else if (g.all.length >= 2 || (byStem.get(stem) ?? 0) > 1) {
      ambiguous.push({
        stem: g.stem,
        names: g.all.map((i) => names[i] ?? ''),
      });
    }
  }
  pairs.sort((a, b) => Math.min(a.first, a.second) - Math.min(b.first, b.second));
  return { pairs, ambiguous };
}

/** Where a read lies along a contig, as `ContigRead` has it. */
export interface Placed {
  readonly index: number;
  readonly strand: 'forward' | 'reverse';
  /** 0-based half-open along the consensus. */
  readonly start: number;
  readonly end: number;
}

/**
 * What a pair's two placements say. `consistent`: on opposite strands and
 * facing each other, at a distance the insert allows (any, with no insert
 * size). `spans-ends`: facing away from each other, but at the distance the
 * insert allows when the contig is closed into a circle: the template runs
 * off one end and in at the other. `too-short`, `too-long`: facing each
 * other, at a distance the insert does not allow. `same-strand`,
 * `facing-away`: not the ends of one template as laid out.
 */
export type PairVerdict =
  'consistent' | 'spans-ends' | 'too-short' | 'too-long' | 'same-strand' | 'facing-away';

/**
 * How far the distance of a pair may be from the insert size: a tenth of it,
 * and not less than 100 bases, because it is measured between the kept ends
 * of two reads, which the trim has already shortened.
 */
export function insertTolerance(insert: number): number {
  return Math.max(100, Math.round(insert * 0.1));
}

export interface PairPlacement {
  readonly verdict: PairVerdict;
  /**
   * Bases from the outer end of one mate to the outer end of the other, when
   * they face each other (the template as the contig lays it), or round the
   * ends of a contig of `length` for `spans-ends`; otherwise null.
   */
  readonly template: number | null;
}

/**
 * Judges two placements on a contig of `length` bases (circular only in the
 * sense of `spans-ends`) against an insert size, or none.
 */
export function judgePair(
  a: Pick<Placed, 'strand' | 'start' | 'end'>,
  b: Pick<Placed, 'strand' | 'start' | 'end'>,
  length: number,
  insert: number | null,
): PairPlacement {
  if (a.strand === b.strand) return { verdict: 'same-strand', template: null };
  // The mate on the forward strand has to be on the left, whatever the names.
  const [fwd, rev] = a.strand === 'forward' ? [a, b] : [b, a];
  const within = (n: number): boolean =>
    insert === null || Math.abs(n - insert) <= insertTolerance(insert);
  if (fwd.start <= rev.start) {
    const template = Math.max(fwd.end, rev.end) - fwd.start;
    if (within(template)) return { verdict: 'consistent', template };
    return { verdict: template < (insert ?? 0) ? 'too-short' : 'too-long', template };
  }
  // The reverse mate is on the left: facing away. Round the ends of the
  // contig they would face each other, if the contig were a circle.
  const around = length - fwd.start + rev.end;
  if (insert !== null && around > 0 && within(around)) {
    return { verdict: 'spans-ends', template: around };
  }
  return { verdict: 'facing-away', template: null };
}

/** One mate's placement was not found: it was left out, or sits in another contig. */
export type PairState = PairVerdict | 'linked' | 'unplaced';

export interface PairCheck {
  readonly pair: ReadPair;
  readonly state: PairState;
  /** The contig (index in the assembly) both mates are in, or the first's for `linked`; null if `unplaced`. */
  readonly contig: number | null;
  /** Distance between the mates' outer ends, for a verdict that has one. */
  readonly template: number | null;
}

/** One side of a link: a contig, and whether the arrangement uses its reverse complement. */
export interface LinkEnd {
  readonly contig: number;
  readonly reversed: boolean;
}

/**
 * Contigs that pairs join, in the order the template runs, as many contigs'
 * worth of consensus as the pairs say follow one another: `from` then `to`.
 */
export interface PairLink {
  readonly from: LinkEnd;
  readonly to: LinkEnd;
  /** How many pairs say so. */
  readonly pairs: number;
  /**
   * Bases between the end of `from` and the start of `to` by the insert size
   * (the median over the pairs; negative when the contigs should overlap),
   * or null with no insert size.
   */
  readonly gap: number | null;
}

export interface PairReport {
  readonly checks: readonly PairCheck[];
  readonly links: readonly PairLink[];
  /** The insert size the pairs were checked against, or null. */
  readonly insert: number | null;
  /** Distances of the pairs that face each other in one contig, shortest first: what to enter as the insert size. */
  readonly templates: readonly number[];
}

interface ContigLike {
  readonly consensus: string;
  readonly reads: readonly {
    readonly index: number;
    readonly strand: 'forward' | 'reverse';
    readonly start: number;
    readonly end: number;
  }[];
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};

/**
 * Where each pair's mates ended up. Both in one contig: judged (`judgePair`).
 * In two: a link (the contigs that follow one another, by which way each mate
 * reads), with a gap when the insert size is known. A mate that was left out:
 * `unplaced`.
 */
export function checkPairs(
  contigs: readonly ContigLike[],
  pairs: readonly ReadPair[],
  insert: number | null,
): PairReport {
  const where = new Map<number, { contig: number; placed: Placed }>();
  contigs.forEach((c, ci) => {
    for (const r of c.reads) where.set(r.index, { contig: ci, placed: r });
  });
  const checks: PairCheck[] = [];
  const templates: number[] = [];
  const arrangements = new Map<
    string,
    { from: LinkEnd; to: LinkEnd; gaps: number[]; pairs: number }
  >();
  for (const pair of pairs) {
    const x = where.get(pair.first);
    const y = where.get(pair.second);
    if (x === undefined || y === undefined) {
      checks.push({ pair, state: 'unplaced', contig: null, template: null });
      continue;
    }
    if (x.contig === y.contig) {
      const length = contigs[x.contig]?.consensus.length ?? 0;
      const j = judgePair(x.placed, y.placed, length, insert);
      if (j.verdict === 'consistent' && j.template !== null) templates.push(j.template);
      checks.push({ pair, state: j.verdict, contig: x.contig, template: j.template });
      continue;
    }
    checks.push({ pair, state: 'linked', contig: x.contig, template: null });
    // Turn contig A to read the first mate forward and contig B to read the
    // second mate backward: the template then runs from A into B.
    const la = contigs[x.contig]?.consensus.length ?? 0;
    const lb = contigs[y.contig]?.consensus.length ?? 0;
    const aReversed = x.placed.strand === 'reverse';
    const bReversed = y.placed.strand === 'forward';
    const aPart = aReversed ? x.placed.end : la - x.placed.start;
    const bPart = bReversed ? lb - y.placed.start : y.placed.end;
    let from: LinkEnd = { contig: x.contig, reversed: aReversed };
    let to: LinkEnd = { contig: y.contig, reversed: bReversed };
    // The same arrangement read from its other end, so that it has one
    // spelling whichever mate is the first.
    if (from.contig > to.contig) {
      [from, to] = [
        { contig: to.contig, reversed: !to.reversed },
        { contig: from.contig, reversed: !from.reversed },
      ];
    }
    const key = `${from.contig}:${String(from.reversed)}>${to.contig}:${String(to.reversed)}`;
    let entry = arrangements.get(key);
    if (entry === undefined) {
      entry = { from, to, gaps: [], pairs: 0 };
      arrangements.set(key, entry);
    }
    entry.pairs++;
    if (insert !== null) entry.gaps.push(insert - aPart - bPart);
  }
  const links: PairLink[] = [...arrangements.values()].map((e) => ({
    from: e.from,
    to: e.to,
    pairs: e.pairs,
    gap: e.gaps.length === 0 ? null : Math.round(median(e.gaps)),
  }));
  links.sort(
    (p, q) => q.pairs - p.pairs || p.from.contig - q.from.contig || p.to.contig - q.to.contig,
  );
  return { checks, links, insert, templates: templates.sort((a, b) => a - b) };
}
