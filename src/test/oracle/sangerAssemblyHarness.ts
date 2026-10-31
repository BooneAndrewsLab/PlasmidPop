import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AssemblyAlign, type Contig, assembleReads } from '@/core/assembly';
import { alignEitherStrand } from '@/core/alignment';
import { parseAbif } from '@/io/abif';

import {
  type ProfileShape,
  type Rng,
  type SimRead,
  CLEAN,
  NOISY,
  genericQualities,
  homopolymerRich,
  randomBases,
  rng,
  simulateRead,
} from './sangerSim';

/**
 * Sanger read assembly against a known construct (item 123, issue #335).
 *
 * Reads are SIMULATED from a seeded synthetic construct, with base errors at
 * the rate their Phred qualities state (`sangerSim.ts`). Simulated reads are
 * less realistic than real chromatograms: there is no peak overlap, no
 * compression, no context-dependent miscalling, and errors are independent
 * given the quality, so a pass here is a floor, not proof on real files.
 *
 * Qualities come from a committed parametric profile (CLEAN, NOISY) and, when
 * the local real AB1 files in fixtures/local/abif are present, from those
 * reads' own qualities too (the quality values are not committed or copied;
 * the part that needs them is skipped without the files).
 *
 * Gate, per scenario and replicate: identity of the consensus to the truth
 * at least 99.5 %, and the layout (contig count, read order, relative
 * orientation) as built. Calibration (reported Phred against observed error)
 * is only reported, never gated: run with ORACLE_REPORT=1 to print the report.
 * A failure class that is a known deviation names its issue and may fail
 * in at most the replicates measured (#349 thin noisy overlaps, where the
 * replicate that is left has no overlap after Q17 trimming; #347 reads
 * inside one copy of a repeat, which no read can place, and which must come
 * with a warning). #348 and the dense-repeat part of #347 were fixed in item
 * 123's second part; #350 (a lost homopolymer base, the gap's quality) and
 * the identity part of #349 in its third.
 */

const GATE_IDENTITY = 0.995;
const REPLICATES = 8;
/** A stretch of the truth this long missing from the consensus is a collapse, not an error. */
const COLLAPSE = 20;
// The deep scenario is about 11 s here and ran past 120 s under coverage on a shared CI runner.
const TIMEOUT = 360_000;

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing element');
  return value;
}

const align: AssemblyAlign = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));

/** Which of the four test files runs it: they are balanced to take about as long as each other. */
type Group = 1 | 2 | 3 | 4;

interface Scenario {
  readonly name: string;
  readonly group: Group;
  readonly truth: string;
  /** Reads for replicate `rep`; the true layout is in their truth coordinates. */
  readonly reads: (rep: number, r: Rng) => readonly SimRead[];
  /** Order and orientation are checked only when the reads are spaced for it. */
  readonly checkOrder: boolean;
  readonly contigs: number;
  /** A failure class recorded as a deviation: it may fail in at most `reps` replicates. */
  readonly known?: { readonly issue: number; readonly reps: number };
  /**
   * The data cannot settle the layout (reads inside a repeat copy join the
   * copies into one): the contig may collapse, and must then say so (#347).
   * Every other scenario must collapse nowhere and warn of nothing.
   */
  readonly ambiguous?: true;
}

interface Call {
  /** Reported Phred of the consensus base. */
  readonly q: number;
  /** A different base (ambiguity codes containing the truth base are right), or an inserted one. */
  readonly wrong: boolean;
  /** Truth bases the consensus lacks right after this one. */
  readonly deleted: number;
  /** Reads covering it. */
  readonly depth: number;
}

interface Score {
  /** Over every consensus base and every truth base the consensus lacks inside the alignment. */
  readonly identity: number;
  /** The same over the consensus bases at least two reads cover: the gated measure. */
  readonly identityCovered: number;
  readonly errors: number;
  readonly errorsCovered: number;
  /** The longest stretch of truth the consensus lacks inside the alignment: a collapsed repeat. */
  readonly longestMissing: number;
  readonly length: number;
  readonly calls: readonly Call[];
}

/**
 * The consensus aligned locally to the truth (either strand). A consensus
 * base is right when it equals, or is an ambiguity code containing, the
 * truth base, and wrong when it differs or is inserted; consensus bases
 * outside the alignment are wrong; a truth base the consensus lacks inside
 * the alignment counts as an error after the base before it (so a collapsed
 * repeat costs its whole length).
 */
function score(contig: Contig, truth: string): Score {
  const a = alignEitherStrand(contig.consensus, truth, { mode: 'local', fast: true }).alignment;
  const n = contig.consensus.length;
  const wrong = new Array<boolean>(n).fill(true);
  const deleted = new Array<number>(n).fill(0);
  let ci = a.startA;
  for (let k = 0; k < a.columns; k++) {
    if (a.alignedA.charAt(k) === '-') {
      const at = Math.max(0, ci - 1);
      deleted[at] = (deleted[at] ?? 0) + 1;
      continue;
    }
    const mark = a.matchLine.charAt(k);
    wrong[ci] = !(mark === '|' || mark === ':') || a.alignedB.charAt(k) === '-';
    ci++;
  }
  const calls: Call[] = wrong.map((w, i) => ({
    q: contig.qualities[i] ?? 0,
    wrong: w,
    deleted: deleted[i] ?? 0,
    depth: contig.depth[i] ?? 0,
  }));
  const errorsOf = (list: readonly Call[]) =>
    list.reduce((t, c) => t + (c.wrong ? 1 : 0) + c.deleted, 0);
  const sizeOf = (list: readonly Call[]) => list.reduce((t, c) => t + 1 + c.deleted, 0);
  const covered = calls.filter((c) => c.depth >= 2);
  return {
    identity: 1 - errorsOf(calls) / sizeOf(calls),
    identityCovered: covered.length === 0 ? 0 : 1 - errorsOf(covered) / sizeOf(covered),
    errors: errorsOf(calls),
    errorsCovered: errorsOf(covered),
    longestMissing: Math.max(0, ...deleted),
    length: n,
    calls,
  };
}

/** Sort key of a read along the truth: its midpoint. */
const mid = (r: SimRead): number => (r.truthStart + r.truthEnd) / 2;

interface Outcome {
  readonly scenario: string;
  readonly rep: number;
  readonly contigs: number;
  readonly identity: number;
  readonly identityAll: number;
  readonly errors: number;
  readonly length: number;
  /** Truth bases missing from the consensus in one stretch. */
  readonly longestMissing: number;
  /** Warnings on the main contig, by kind. */
  readonly warnings: readonly string[];
  readonly orderOk: boolean | null;
  readonly orientationOk: boolean | null;
  readonly calls: readonly Call[];
}

const outcomes: Outcome[] = [];

/** Whether the contig's reads lie in the true order (or its reverse) with the true relative strands. */
function layout(
  contig: Contig,
  sims: readonly SimRead[],
): { order: boolean; orientation: boolean } {
  const placed = contig.reads.map((c) => ({ c, s: must(sims[c.index]) }));
  const byContig = [...placed].sort((p, q) => p.c.start + p.c.end - (q.c.start + q.c.end));
  const byTruth = [...placed].sort((p, q) => mid(p.s) - mid(q.s));
  const idx = (list: typeof placed) => list.map((p) => p.c.index).join(',');
  const order = idx(byContig) === idx(byTruth) || idx(byContig) === idx([...byTruth].reverse());
  const seed = placed[0];
  const rel = (p: (typeof placed)[number]) =>
    ((p.c.strand === 'reverse') !== p.s.reverse) !==
    ((seed?.c.strand === 'reverse') !== seed?.s.reverse);
  return { order, orientation: placed.every((p) => !rel(p)) };
}

async function run(sc: Scenario, rep: number): Promise<Outcome> {
  const r = rng(20261031 + rep * 7919 + sc.name.length * 104729);
  const sims = sc.reads(rep, r);
  const result = await assembleReads(
    sims.map((s) => ({ name: s.name, sequence: s.sequence, qualities: s.qualities })),
    { align },
  );
  const main = result.contigs[0];
  const s = main === undefined ? null : score(main, sc.truth);
  const lay = main === undefined ? null : layout(main, sims);
  const outcome: Outcome = {
    scenario: sc.name,
    rep,
    contigs: result.contigs.length,
    identity: s?.identityCovered ?? 0,
    identityAll: s?.identity ?? 0,
    errors: s?.errorsCovered ?? 0,
    longestMissing: s?.longestMissing ?? 0,
    length: s?.length ?? 0,
    warnings: main?.warnings.map((w) => w.kind) ?? [],
    orderOk: sc.checkOrder && lay !== null ? lay.order : null,
    orientationOk: sc.checkOrder && lay !== null ? lay.orientation : null,
    calls: s?.calls ?? [],
  };
  outcomes.push(outcome);
  return outcome;
}

// Constructs ---------------------------------------------------------------

const CONSTRUCT = randomBases(2400, rng(335), 0.5);
const HOMO = homopolymerRich(2000, rng(336));
const REPEAT = randomBases(400, rng(337));
/** Unique 500 | repeat 400 | unique 300 | the same repeat | unique 500. */
const REPEATED =
  randomBases(500, rng(338)) +
  REPEAT +
  randomBases(300, rng(339)) +
  REPEAT +
  randomBases(500, rng(340));

function generic(shape: ProfileShape, lo: number, hi: number, r: Rng): number[] {
  return genericQualities(lo + Math.floor(r() * (hi - lo)), shape, r);
}

/** Reads of `length` starting at the given points, alternating strands when asked. */
function tiled(
  truth: string,
  starts: readonly number[],
  shape: ProfileShape,
  r: Rng,
  alternate: boolean,
  length: readonly [number, number] = [650, 850],
  indel?: number,
): SimRead[] {
  return starts.map((s, i) => {
    const q = generic(shape, length[0], length[1], r);
    const reverse = alternate && i % 2 === 1;
    // A reverse read starts at the far end of its stretch.
    const at = reverse ? Math.min(truth.length, s + q.length) : s;
    return simulateRead(`r${i}`, truth, at, q, reverse, r, indel === undefined ? {} : { indel });
  });
}

const step = (from: number, to: number, by: number): number[] => {
  const out: number[] = [];
  for (let x = from; x <= to; x += by) out.push(x);
  return out;
};

const scenarios: readonly Scenario[] = [
  {
    name: 'tiling, forward reads, clean',
    group: 2,
    truth: CONSTRUCT,
    contigs: 1,
    checkOrder: true,
    reads: (_, r) => tiled(CONSTRUCT, step(0, 1800, 300), CLEAN, r, false),
  },
  {
    name: 'tiling, alternating strands, clean',
    group: 3,
    truth: CONSTRUCT,
    contigs: 1,
    checkOrder: true,
    reads: (_, r) => tiled(CONSTRUCT, step(0, 1800, 300), CLEAN, r, true),
  },
  {
    name: 'tiling, alternating strands, noisy',
    group: 3,
    truth: CONSTRUCT,
    contigs: 1,
    checkOrder: true,
    reads: (_, r) => tiled(CONSTRUCT, step(0, 1800, 250), NOISY, r, true),
  },
  {
    name: 'tiling, alternating strands, noisy, thin overlaps',
    group: 3,
    truth: CONSTRUCT,
    contigs: 1,
    checkOrder: true,
    known: { issue: 349, reps: 1 },
    reads: (_, r) => tiled(CONSTRUCT, step(0, 1600, 400), NOISY, r, true),
  },
  {
    name: 'deep, 14 reads at jittered starts, both strands',
    group: 1,
    truth: CONSTRUCT,
    contigs: 1,
    checkOrder: false,
    reads: (_, r) => {
      const starts = Array.from({ length: 14 }, (_, i) =>
        Math.max(0, Math.min(1750, Math.round(i * 135 + (r() - 0.5) * 80))),
      );
      return tiled(CONSTRUCT, starts, CLEAN, r, false).map((s, i) =>
        i % 3 === 2
          ? simulateRead(
              s.name,
              CONSTRUCT,
              s.truthEnd,
              genericQualities(s.sequence.length, CLEAN, r),
              true,
              r,
            )
          : s,
      );
    },
  },
  {
    name: 'homopolymer-rich construct, indel-heavy errors',
    group: 4,
    truth: HOMO,
    contigs: 1,
    checkOrder: true,
    reads: (_, r) => tiled(HOMO, step(0, 1300, 300), NOISY, r, true, [650, 850], 0.35),
  },
  {
    name: 'repeat, dense spanning reads',
    group: 2,
    truth: REPEATED,
    contigs: 1,
    checkOrder: true,
    reads: (_, r) => tiled(REPEATED, step(0, 1400, 200), CLEAN, r, false, [750, 850]),
  },
  {
    name: 'repeat, sparse spanning reads',
    group: 4,
    truth: REPEATED,
    contigs: 1,
    checkOrder: true,
    // Each read reaches from unique sequence through a whole repeat copy into unique sequence.
    reads: (_, r) => tiled(REPEATED, [100, 800, 1000, 1600], CLEAN, r, false, [750, 850]),
  },
  {
    name: 'repeat, reads inside a copy plus flanking reads',
    group: 4,
    truth: REPEATED,
    contigs: 1,
    checkOrder: false,
    known: { issue: 347, reps: 8 },
    ambiguous: true,
    reads: (_, r) => [
      ...tiled(REPEATED, [0], CLEAN, r, false, [700, 760]),
      ...tiled(REPEATED, [1250], CLEAN, r, false, [500, 560]).map((s) => ({ ...s, name: 'tail' })),
      // Two reads wholly inside the repeat, one per copy (indistinguishable by sequence).
      ...[560, 1360].map((s, i) => {
        const q = generic(CLEAN, 250, 300, r);
        return { ...simulateRead(`inner${i}`, REPEATED, s, q, false, r), name: `inner${i}` };
      }),
    ],
  },
];

// Real quality profiles (local files only) ----------------------------------

const localDir = join(process.cwd(), 'fixtures', 'local', 'abif');
const haveLocal = existsSync(localDir);
const profiles: number[][] = [];
const REAL_TRUTH = randomBases(2200, rng(341));

const realScenario: Scenario = {
  name: 'walking primers along a 2.2 kb insert, qualities of real reads',
  group: 4,
  truth: REAL_TRUTH,
  contigs: 1,
  checkOrder: true,
  reads: (_, r) => {
    const pick = () => must(profiles[Math.floor(r() * profiles.length)]);
    // Forward primers every 500 bases, a reverse primer 700 bases on from each.
    return [0, 500, 1000, 1500].flatMap((at, i) => [
      simulateRead(`fwd${i}`, REAL_TRUTH, at, pick(), false, r),
      simulateRead(`rev${i}`, REAL_TRUTH, Math.min(REAL_TRUTH.length, at + 700), pick(), true, r),
    ]);
  },
};

function report() {
  const perScenario = (haveLocal ? [...scenarios, realScenario] : scenarios).map((sc) => {
    const rows = outcomes.filter((o) => o.scenario === sc.name);
    const ids = rows.map((o) => o.identity);
    return {
      scenario: sc.name,
      reps: rows.length,
      contigs: rows.map((o) => o.contigs),
      meanIdentityAll: rows.reduce((a, o) => a + o.identityAll, 0) / Math.max(1, rows.length),
      meanIdentity: ids.reduce((a, b) => a + b, 0) / Math.max(1, ids.length),
      minIdentity: Math.min(...ids),
      errors: rows.map((o) => o.errors),
      longestMissing: rows.map((o) => o.longestMissing),
      warnings: rows.map((o) => o.warnings.length),
      orderBad: rows.filter((o) => o.orderOk === false).length,
      orientationBad: rows.filter((o) => o.orientationOk === false).length,
    };
  });
  const bins = [
    [0, 10],
    [10, 20],
    [20, 30],
    [30, 40],
    [40, 50],
    [50, 61],
  ] as const;
  // A collapsed repeat is not colinear with the truth, so its columns say nothing about calibration.
  const calls = outcomes.filter((o) => o.identityAll >= 0.9).flatMap((o) => o.calls);
  const table = (list: readonly Call[]) =>
    bins.map(([lo, hi]) => {
      const inBin = list.filter((c) => c.q >= lo && c.q < hi);
      const wrong = inBin.filter((c) => c.wrong).length;
      const expected = inBin.reduce((a, c) => a + 10 ** (-c.q / 10), 0);
      return {
        bin: `${lo}-${hi - 1}`,
        n: inBin.length,
        wrong,
        expected: Math.round(expected * 10) / 10,
      };
    });
  const calibration = {
    all: table(calls),
    depth1: table(calls.filter((c) => c.depth === 1)),
    depth2plus: table(calls.filter((c) => c.depth >= 2)),
  };
  return { perScenario, calibration };
}

export function defineSuite(group: Group): void {
  describe(`Sanger assembly against a known construct (simulated reads), part ${group}`, () => {
    for (const sc of scenarios.filter((s) => s.group === group)) {
      it(
        sc.name,
        async () => {
          const rows: Outcome[] = [];
          for (let rep = 0; rep < REPLICATES; rep++) rows.push(await run(sc, rep));
          const bad = rows.filter(
            (o) =>
              o.contigs !== sc.contigs ||
              o.identity < GATE_IDENTITY ||
              o.longestMissing >= COLLAPSE ||
              o.orderOk === false ||
              o.orientationOk === false,
          );
          // A known deviation may fail in at most the replicates recorded; anything else may not fail.
          expect(bad.length).toBeLessThanOrEqual(sc.known?.reps ?? 0);
          // A collapse is never silent (#347), and a layout the data settle has no warning.
          const collapsed = rows.filter((o) => o.longestMissing >= COLLAPSE);
          expect(collapsed.filter((o) => !o.warnings.includes('possible-repeat-collapse'))).toEqual(
            [],
          );
          if (sc.ambiguous === undefined) expect(rows.flatMap((o) => o.warnings)).toEqual([]);
          else expect(collapsed.length).toBeGreaterThan(0);
        },
        TIMEOUT,
      );
    }
  });

  afterAll(() => {
    if (process.env['ORACLE_REPORT'] === undefined) return;
    process.stdout.write(`\nREPORT ${JSON.stringify(report())}\n`);
  });

  describe.skipIf(!haveLocal || group !== realScenario.group)(
    'Sanger assembly with qualities of real local AB1 reads',
    () => {
      beforeAll(() => {
        for (const f of readdirSync(localDir).filter((n) => n.endsWith('.ab1'))) {
          const doc = parseAbif(new Uint8Array(readFileSync(join(localDir, f))), f).documents[0];
          const q = [...(doc?.read?.qualities ?? [])];
          const mean = q.reduce((a, b) => a + b, 0) / Math.max(1, q.length);
          // A file with no qualities (all zero) says nothing about a profile.
          if (q.length >= 400 && mean >= 10) profiles.push(q);
        }
      });

      it(
        realScenario.name,
        async () => {
          expect(profiles.length).toBeGreaterThan(0);
          const rows: Outcome[] = [];
          for (let rep = 0; rep < REPLICATES; rep++) rows.push(await run(realScenario, rep));
          const bad = rows.filter(
            (o) =>
              o.contigs !== 1 ||
              o.identity < GATE_IDENTITY ||
              o.longestMissing >= COLLAPSE ||
              o.orderOk === false ||
              o.orientationOk === false,
          );
          expect(bad.length).toBeLessThanOrEqual(realScenario.known?.reps ?? 0);
          expect(rows.flatMap((o) => o.warnings)).toEqual([]);
        },
        TIMEOUT,
      );
    },
  );
}
