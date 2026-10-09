import { describe, expect, it } from 'vitest';

import { type StrandedAlignment, alignEitherStrand } from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { type AssemblyAlign, type AssemblyRead, assembleReads } from './assemble';
import { iupacOf } from './consensus';

/** Integer-only xorshift32, so the same bases come out everywhere. */
function randomBases(n: number, seed: number): string {
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out += 'ACGT'.charAt((x >>> 8) % 4);
  }
  return out;
}

const align: AssemblyAlign = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));

const GENOME = randomBases(600, 12345);
const flat = (length: number, q: number): number[] => new Array<number>(length).fill(q);

function read(
  name: string,
  start: number,
  end: number,
  q = 40,
  reverse = false,
  g = GENOME,
): AssemblyRead {
  const s = g.slice(start, end);
  return {
    name,
    sequence: reverse ? reverseComplement(s) : s,
    qualities: flat(s.length, q),
  };
}

function withBase(r: AssemblyRead, index: number, base: string, q: number): AssemblyRead {
  const quals = Array.from(r.qualities ?? []);
  quals[index] = q;
  return {
    ...r,
    sequence: r.sequence.slice(0, index) + base + r.sequence.slice(index + 1),
    qualities: quals,
  };
}

const TIMEOUT = 60_000;

describe('assembleReads', () => {
  it(
    'joins overlapping reads into the sequence they came from',
    async () => {
      const out = await assembleReads(
        [read('a', 0, 300), read('b', 200, 450), read('c', 380, 600)],
        { align },
      );
      expect(out.contigs).toHaveLength(1);
      expect(out.contigs[0]?.consensus).toBe(GENOME);
      expect(out.contigs[0]?.disagreements).toEqual([]);
      expect(out.contigs[0]?.reads.map((r) => [r.name, r.start, r.end])).toEqual([
        ['a', 0, 300],
        ['b', 200, 450],
        ['c', 380, 600],
      ]);
      expect(out.hasQualities).toBe(true);
    },
    TIMEOUT,
  );

  it(
    'turns reverse-strand reads over and says so',
    async () => {
      const out = await assembleReads(
        [read('a', 0, 320), read('b', 220, 420, 40, true), read('c', 300, 600, 40, true)],
        { align },
      );
      const contig = out.contigs[0];
      expect(out.contigs).toHaveLength(1);
      expect(contig?.consensus).toBe(GENOME);
      expect(contig?.reads.map((r) => [r.name, r.strand])).toEqual([
        ['a', 'forward'],
        ['b', 'reverse'],
        ['c', 'reverse'],
      ]);
    },
    TIMEOUT,
  );

  it(
    'is the same whatever the order or strand of the reads',
    async () => {
      const a = read('a', 0, 320);
      const b = read('b', 220, 420);
      const c = read('c', 300, 600);
      const forward = await assembleReads([a, b, c], { align });
      const shuffled = await assembleReads([c, a, b], { align });
      expect(shuffled.contigs[0]?.consensus).toBe(forward.contigs[0]?.consensus);
      // The seed is the longest read, which then lies either way round.
      const flipped = await assembleReads(
        [a, b, { ...c, sequence: reverseComplement(c.sequence), qualities: flat(300, 40) }],
        { align },
      );
      expect(flipped.contigs[0]?.consensus).toBe(GENOME);
    },
    TIMEOUT,
  );

  it(
    'trusts a high-quality base over a poor one and does not flag the poor one',
    async () => {
      const bad = GENOME.charAt(250) === 'A' ? 'C' : 'A';
      const out = await assembleReads(
        [read('a', 0, 320), withBase(read('b', 200, 450), 50, bad, 8), read('c', 380, 600)],
        { align },
      );
      expect(out.contigs[0]?.consensus).toBe(GENOME);
      expect(out.contigs[0]?.disagreements).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'calls an ambiguity code where confident reads disagree, and flags it',
    async () => {
      const original = GENOME.charAt(250);
      const other = original === 'A' ? 'G' : original === 'G' ? 'A' : original === 'C' ? 'T' : 'C';
      const out = await assembleReads(
        [read('a', 0, 320), withBase(read('b', 200, 450), 50, other, 40), read('c', 380, 600)],
        { align },
      );
      const contig = out.contigs[0];
      expect(contig?.consensus.length).toBe(600);
      const code = contig?.consensus.charAt(250) ?? '';
      expect(code).not.toBe(original);
      expect('RYSWKM').toContain(code);
      expect(contig?.consensus.slice(0, 250)).toBe(GENOME.slice(0, 250));
      expect(contig?.consensus.slice(251)).toBe(GENOME.slice(251));
      expect(contig?.disagreements).toHaveLength(1);
      expect(contig?.disagreements[0]).toMatchObject({ position: 250, ambiguous: true });
      expect(contig?.disagreements[0]?.votes.map((v) => v.read).sort()).toEqual([0, 1]);
    },
    TIMEOUT,
  );

  it(
    'lets two reads outvote a third and still flags the dissenter',
    async () => {
      const other = GENOME.charAt(250) === 'A' ? 'G' : 'A';
      const out = await assembleReads(
        [
          read('a', 0, 320),
          read('d', 100, 420),
          withBase(read('b', 200, 450), 50, other, 40),
          read('c', 380, 600),
        ],
        { align },
      );
      const contig = out.contigs[0];
      expect(contig?.consensus).toBe(GENOME);
      expect(contig?.disagreements).toHaveLength(1);
      expect(contig?.disagreements[0]).toMatchObject({
        position: 250,
        ambiguous: false,
        call: GENOME.charAt(250),
      });
    },
    TIMEOUT,
  );

  it(
    'leaves out a base only one read has, and a base one read lacks, and flags the latter',
    async () => {
      const a = read('a', 0, 320);
      const d = read('d', 100, 420);
      const b = read('b', 200, 450);
      const inserted: AssemblyRead = {
        name: b.name,
        sequence: b.sequence.slice(0, 50) + 'A' + b.sequence.slice(50),
        qualities: [...flat(50, 40), 40, ...flat(b.sequence.length - 50, 40)],
      };
      const lacking: AssemblyRead = {
        name: 'e',
        sequence: GENOME.slice(150, 400).slice(0, 100) + GENOME.slice(150, 400).slice(101),
        qualities: flat(249, 40),
      };
      const out = await assembleReads([a, d, inserted, lacking, read('c', 380, 600)], { align });
      const contig = out.contigs[0];
      expect(contig?.consensus).toBe(GENOME);
      // The deletion in 'e' is flagged by its gap, within a few bases of where
      // it was made (a gap in a run of one base can sit anywhere along it).
      const flagged = contig?.disagreements.filter((x) => x.votes.some((v) => v.base === '-'));
      expect(flagged).toHaveLength(1);
      expect(Math.abs((flagged?.[0]?.position ?? 0) - 250)).toBeLessThan(5);
      // The inserted base is in no consensus position: nothing is shown for it in the rows.
      for (const r of contig?.reads ?? []) expect(r.row).toHaveLength(600);
    },
    TIMEOUT,
  );

  it(
    'trims poor ends so junk does not extend or disturb the consensus',
    async () => {
      const junk = randomBases(40, 999);
      const a = read('a', 0, 320);
      const b = read('b', 200, 450);
      const noisy: AssemblyRead = {
        name: 'n',
        sequence: junk + GENOME.slice(380, 600) + junk,
        qualities: [...flat(40, 3), ...flat(220, 40), ...flat(40, 3)],
      };
      const out = await assembleReads([a, b, noisy], { align });
      expect(out.contigs).toHaveLength(1);
      expect(out.contigs[0]?.consensus).toBe(GENOME);
      expect(out.contigs[0]?.reads.find((r) => r.name === 'n')?.trimmed).toEqual({
        start: 40,
        end: 260,
      });
    },
    TIMEOUT,
  );

  it(
    'gives a read that overlaps nothing a contig of its own and reports a read with nothing left',
    async () => {
      const stranger = randomBases(250, 777);
      const out = await assembleReads(
        [
          read('a', 0, 320),
          read('b', 250, 500),
          { name: 'x', sequence: stranger, qualities: flat(250, 40) },
          { name: 'poor', sequence: randomBases(100, 5), qualities: flat(100, 2) },
        ],
        { align },
      );
      expect(out.contigs.map((c) => c.reads.map((r) => r.name))).toEqual([['a', 'b'], ['x']]);
      expect(out.contigs[1]?.consensus).toBe(stranger);
      expect(out.skipped.map((s) => s.name)).toEqual(['poor']);
    },
    TIMEOUT,
  );

  it(
    'assembles reads without qualities and reports that none had any',
    async () => {
      const plain = (name: string, s: number, e: number): AssemblyRead => ({
        name,
        sequence: GENOME.slice(s, e).toLowerCase(),
      });
      const out = await assembleReads([plain('a', 0, 320), plain('b', 250, 600)], { align });
      expect(out.contigs[0]?.consensus).toBe(GENOME);
      expect(out.hasQualities).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'stops when its signal is aborted',
    async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        assembleReads([read('a', 0, 320), read('b', 250, 600)], {
          align,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    },
    TIMEOUT,
  );

  it(
    'reports the depth and call quality of every consensus base',
    async () => {
      const out = await assembleReads(
        [read('a', 0, 300), read('b', 200, 450), read('c', 380, 600)],
        { align },
      );
      const cover = (p: number): number =>
        [
          [0, 300],
          [200, 450],
          [380, 600],
        ].filter(([s, e]) => p >= (s ?? 0) && p < (e ?? 0)).length;
      const depth = Array.from({ length: 600 }, (_, p) => cover(p));
      expect(out.contigs[0]?.depth).toEqual(depth);
      // One Q40 read gives Q40; two agreeing ones are worth more than Q60 and are capped there.
      expect(out.contigs[0]?.qualities).toEqual(depth.map((d) => (d === 1 ? 40 : 60)));
    },
    TIMEOUT,
  );

  describe('reads going in', () => {
    it('skips a read whose qualities do not match its bases, and says why', async () => {
      const out = await assembleReads(
        [
          { name: 'good', sequence: GENOME.slice(0, 100), qualities: flat(100, 40) },
          { name: 'short', sequence: GENOME.slice(0, 100), qualities: flat(99, 40) },
        ],
        { align },
      );
      expect(out.skipped).toEqual([
        { index: 1, name: 'short', reason: 'Its qualities do not match its bases' },
      ]);
      expect(out.contigs).toHaveLength(1);
      expect(out.contigs[0]?.reads.map((r) => r.name)).toEqual(['good']);
    });

    it('tells an empty read from one trimmed to nothing', async () => {
      const out = await assembleReads(
        [
          { name: 'empty', sequence: '' },
          { name: 'emptyQ', sequence: '', qualities: [] },
          { name: 'poor', sequence: 'ACGTACGTAC', qualities: flat(10, 2) },
          { name: 'ok', sequence: GENOME.slice(0, 60) },
        ],
        { align },
      );
      expect(out.skipped).toEqual([
        { index: 0, name: 'empty', reason: 'It is empty' },
        { index: 1, name: 'emptyQ', reason: 'No base of it is good enough to keep after trimming' },
        { index: 2, name: 'poor', reason: 'No base of it is good enough to keep after trimming' },
      ]);
      expect(out.contigs).toHaveLength(1);
    });

    it('keeps the whole of a read without qualities, or when trimming is off', async () => {
      const poor: AssemblyRead = {
        name: 'p',
        sequence: GENOME.slice(0, 80),
        qualities: flat(80, 2),
      };
      const none: AssemblyRead = { name: 'n', sequence: GENOME.slice(200, 270) };
      expect((await assembleReads([poor], { align })).skipped).toHaveLength(1);
      const out = await assembleReads([poor, none], { align, trimCutoff: null });
      expect(out.skipped).toEqual([]);
      const byName = new Map(out.contigs.flatMap((c) => c.reads).map((r) => [r.name, r]));
      expect(byName.get('p')?.trimmed).toEqual({ start: 0, end: 80 });
      expect(byName.get('n')?.trimmed).toEqual({ start: 0, end: 70 });
      // Q2 reads settle nothing, but the read without qualities is called as it is.
      expect(out.contigs.map((c) => c.consensus.length)).toEqual([80, 70]);
      expect(out.contigs[1]?.consensus).toBe(GENOME.slice(200, 270));
    });

    it(
      'reads RNA and lower case as DNA, and takes qualities from the trimmed stretch',
      async () => {
        const rna = (s: string): string => s.replace(/T/g, 'u').toLowerCase();
        const out = await assembleReads(
          [{ name: 'r', sequence: rna(GENOME.slice(0, 320)) }, read('b', 250, 600)],
          { align },
        );
        expect(out.contigs[0]?.consensus).toBe(GENOME);

        const junk = randomBases(40, 999);
        const ramp = Array.from({ length: 220 }, (_, t) => 21 + (t % 17));
        const noisy: AssemblyRead = {
          name: 'n',
          sequence: junk + GENOME.slice(380, 600) + junk,
          qualities: [...flat(40, 3), ...ramp, ...flat(40, 3)],
        };
        const trimmed = await assembleReads([read('a', 0, 320), read('b', 200, 450), noisy], {
          align,
        });
        // Only the noisy read covers 450 onwards: its own trimmed qualities show.
        expect(trimmed.contigs[0]?.qualities.slice(450)).toEqual(ramp.slice(70));
      },
      TIMEOUT,
    );

    it('says whether any read had qualities, null or absent being none', async () => {
      const bare = (name: string, s: number, e: number, q?: null): AssemblyRead => ({
        name,
        sequence: GENOME.slice(s, e),
        ...(q === null ? { qualities: null } : {}),
      });
      const mixed = await assembleReads([bare('a', 0, 100), read('b', 300, 400)], { align });
      expect(mixed.hasQualities).toBe(true);
      const nulls = await assembleReads([bare('a', 0, 100, null), bare('b', 300, 400, null)], {
        align,
      });
      expect(nulls.hasQualities).toBe(false);
    });
  });

  describe('which read seeds and which contig comes first', () => {
    it(
      'seeds a contig with the longest read, and the lower index among equals',
      async () => {
        // The seed lies forward, so the other read is the one turned over.
        const longer = await assembleReads(
          [
            { name: 'a', sequence: reverseComplement(GENOME.slice(0, 320)) },
            { name: 'b', sequence: GENOME.slice(250, 600) },
          ],
          { align },
        );
        expect(longer.contigs[0]?.consensus).toBe(GENOME);
        expect(longer.contigs[0]?.reads.map((r) => [r.name, r.strand])).toEqual([
          ['a', 'reverse'],
          ['b', 'forward'],
        ]);
        const equal = await assembleReads(
          [
            { name: 'a', sequence: GENOME.slice(0, 300) },
            { name: 'b', sequence: reverseComplement(GENOME.slice(200, 500)) },
          ],
          { align },
        );
        expect(equal.contigs[0]?.consensus).toBe(GENOME.slice(0, 500));
        expect(equal.contigs[0]?.reads.map((r) => [r.name, r.strand])).toEqual([
          ['a', 'forward'],
          ['b', 'reverse'],
        ]);
      },
      TIMEOUT,
    );

    it(
      'seeds with the lowest index among reads of one length',
      async () => {
        const out = await assembleReads(
          [
            { name: 'a', sequence: GENOME.slice(0, 300) },
            { name: 'b', sequence: reverseComplement(GENOME.slice(150, 450)) },
            { name: 'c', sequence: reverseComplement(GENOME.slice(300, 600)) },
          ],
          { align },
        );
        expect(out.contigs[0]?.consensus).toBe(GENOME);
        expect(out.contigs[0]?.reads.map((r) => [r.name, r.strand])).toEqual([
          ['a', 'forward'],
          ['b', 'reverse'],
          ['c', 'reverse'],
        ]);
      },
      TIMEOUT,
    );

    it(
      'puts the contig of most reads first, then the longest, whatever order they were made in',
      async () => {
        const g2 = randomBases(400, 4242);
        const g3 = randomBases(400, 99);
        const g4 = randomBases(400, 31337);
        const out = await assembleReads(
          [
            { name: 'lonely', sequence: g4.slice(0, 300) },
            { name: 'p1', sequence: g3.slice(0, 250) },
            { name: 'p1in', sequence: g3.slice(100, 140) },
            { name: 'p2a', sequence: g2.slice(0, 200) },
            { name: 'p2b', sequence: g2.slice(150, 350) },
          ],
          { align },
        );
        expect(out.contigs.map((c) => [c.reads.length, c.consensus.length])).toEqual([
          [2, 350],
          [2, 250],
          [1, 300],
        ]);
        expect(out.contigs[0]?.consensus).toBe(g2.slice(0, 350));
      },
      TIMEOUT,
    );

    it(
      'lists the reads of a contig by where they start, then by index',
      async () => {
        const out = await assembleReads(
          [
            { name: 'short', sequence: GENOME.slice(0, 200) },
            { name: 'long', sequence: GENOME.slice(0, 320) },
          ],
          { align },
        );
        expect(out.contigs[0]?.reads.map((r) => [r.name, r.start, r.end])).toEqual([
          ['short', 0, 200],
          ['long', 0, 320],
        ]);
      },
      TIMEOUT,
    );

    it(
      'asks the aligner for a fast local alignment, and tries reads again after a join',
      async () => {
        const calls: { a: string; b: string; options: unknown }[] = [];
        const spy: AssemblyAlign = (a, b, options) => {
          calls.push({ a, b, options });
          return align(a, b, options);
        };
        const progress: number[] = [];
        const s = GENOME.slice(0, 320);
        const r1 = GENOME.slice(250, 520);
        const r2 = GENOME.slice(200, 400);
        const x = randomBases(150, 777);
        const out = await assembleReads(
          [
            { name: 'x', sequence: x },
            { name: 'r2', sequence: r2 },
            { name: 's', sequence: s },
            { name: 'r1', sequence: r1 },
          ],
          { align: spy, onProgress: (f) => progress.push(f) },
        );
        expect(out.contigs.map((c) => c.reads.length)).toEqual([3, 1]);
        expect(calls.map((c) => c.b)).toEqual([r1, r2, x, x]);
        expect(calls.map((c) => c.a)).toEqual([
          s,
          GENOME.slice(0, 520),
          GENOME.slice(0, 520),
          GENOME.slice(0, 520),
        ]);
        for (const c of calls) expect(c.options).toEqual({ mode: 'local', fast: true });
        expect(progress).toEqual([0.25, 0.5, 0.75, 1]);
      },
      TIMEOUT,
    );
  });

  describe('reverse reads', () => {
    it(
      'lines a turned-over read up with the consensus, qualities and all',
      async () => {
        const ramp = Array.from({ length: 300 }, (_, i) => 21 + (i % 30));
        const rev: AssemblyRead = {
          name: 'b',
          sequence: reverseComplement(GENOME.slice(300, 600)),
          qualities: ramp,
        };
        const out = await assembleReads([read('a', 0, 400), rev], { align });
        expect(out.contigs[0]?.consensus).toBe(GENOME);
        // Read base i lies at position 599 - i; only it covers 400 onwards.
        const expected = Array.from({ length: 200 }, (_, k) => 21 + ((599 - (400 + k)) % 30));
        expect(out.contigs[0]?.qualities.slice(400)).toEqual(expected);
      },
      TIMEOUT,
    );
  });

  describe('who counts as disagreeing', () => {
    const swapped = (at: number): string => (GENOME.charAt(at) === 'A' ? 'G' : 'A');
    const run = (dissenterQuality: number, base = swapped(250), confidentFrom?: number) =>
      assembleReads(
        [
          read('a', 0, 320),
          read('d', 100, 420),
          withBase(read('b', 200, 450), 50, base, dissenterQuality),
          read('c', 380, 600),
        ],
        { align, ...(confidentFrom === undefined ? {} : { confidentFrom }) },
      );

    it(
      'flags a dissenter at the confident quality and not below it',
      async () => {
        expect((await run(20)).contigs[0]?.disagreements).toHaveLength(1);
        expect((await run(19)).contigs[0]?.disagreements).toEqual([]);
        expect((await run(25, undefined, 26)).contigs[0]?.disagreements).toEqual([]);
        expect((await run(26, undefined, 26)).contigs[0]?.disagreements).toHaveLength(1);
      },
      TIMEOUT,
    );

    it(
      'does not flag an N, which says nothing',
      async () => {
        const out = await run(40, 'N');
        expect(out.contigs[0]?.consensus).toBe(GENOME);
        expect(out.contigs[0]?.disagreements).toEqual([]);
      },
      TIMEOUT,
    );
  });

  describe('a base a read lacks', () => {
    /** A deletion in a read, at a place where no neighbouring base repeats it. */
    async function lacking(leftQ: number, rightQ: number) {
      let at = 250;
      while (
        GENOME.charAt(at) === GENOME.charAt(at - 1) ||
        GENOME.charAt(at) === GENOME.charAt(at + 1) ||
        GENOME.charAt(at - 1) === GENOME.charAt(at + 1)
      ) {
        at++;
      }
      const quals = flat(249, 35);
      quals[at - 150 - 1] = leftQ;
      quals[at - 150] = rightQ;
      const e: AssemblyRead = {
        name: 'e',
        sequence: GENOME.slice(150, at) + GENOME.slice(at + 1, 400),
        qualities: quals,
      };
      const out = await assembleReads([read('a', 0, 320), read('d', 100, 420), e], { align });
      return { at, contig: out.contigs[0] };
    }

    it(
      'gives its gap the lower quality of the bases either side, whichever side that is',
      async () => {
        for (const [leftQ, rightQ] of [
          [25, 35],
          [35, 25],
        ] as const) {
          const { at, contig } = await lacking(leftQ, rightQ);
          expect(contig?.consensus).toBe(GENOME.slice(0, 420));
          expect(contig?.disagreements).toHaveLength(1);
          expect(contig?.disagreements[0]?.position).toBe(at);
          expect(contig?.disagreements[0]?.votes).toEqual([
            { read: 0, base: GENOME.charAt(at), quality: 40 },
            { read: 1, base: GENOME.charAt(at), quality: 40 },
            { read: 2, base: '-', quality: 25 },
          ]);
          // The gap is no cover: the position has two reads, not three.
          expect(contig?.depth[at]).toBe(2);
          expect(contig?.depth[at - 1]).toBe(3);
        }
      },
      TIMEOUT,
    );
  });
});

/** An alignment written out by hand, so a read can be placed exactly where a test wants it. */
function hand(
  startA: number,
  startB: number,
  alignedA: string,
  alignedB: string,
): StrandedAlignment {
  const length = (s: string): number => s.replace(/-/g, '').length;
  let identities = 0;
  let gaps = 0;
  for (let i = 0; i < alignedA.length; i++) {
    if (alignedA[i] === '-' || alignedB[i] === '-') gaps++;
    else if (alignedA[i] === alignedB[i]) identities++;
  }
  return {
    strand: 'forward',
    alignment: {
      mode: 'local',
      score: 0,
      alignedA,
      alignedB,
      matchLine: '',
      startA,
      endA: startA + length(alignedA),
      startB,
      endB: startB + length(alignedB),
      identities,
      ambiguous: 0,
      gaps,
      columns: alignedA.length,
      identity: alignedA.length === 0 ? 0 : identities / alignedA.length,
    },
  };
}

/** Places each read as told, keyed by its bases; a read not listed overlaps nothing. */
function scripted(plan: Record<string, StrandedAlignment>): AssemblyAlign {
  return (_a, b) => Promise.resolve(plan[b] ?? hand(0, 0, '', ''));
}

const comp = (s: string): string => Array.from(s, (ch) => reverseComplement(ch)).join('');
const G = GENOME;
const spaces = (n: number): string => ' '.repeat(n);
/** Qualities that differ along a read, so one taken from the wrong place shows. */
const tq = (i: number): number => 36 + (i % 5);
const tqs = (n: number): number[] => Array.from({ length: n }, (_, i) => tq(i));

describe('placing a read by an alignment', () => {
  it('opens a column for a run of bases the read has, between and beyond the consensus', async () => {
    const s = G.slice(0, 110);
    const rq = Array.from({ length: 100 }, (_, i) => 30 + (i % 5));
    const r: AssemblyRead = { name: 'r', sequence: G.slice(70, 170), qualities: rq };
    const tqual = flat(57, 40);
    tqual[25] = 33;
    tqual[26] = 37;
    const t: AssemblyRead = {
      name: 't',
      sequence: G.slice(85, 110) + 'TG' + G.slice(110, 140),
      qualities: tqual,
    };
    const out = await assembleReads([{ name: 's', sequence: s, qualities: flat(110, 40) }, r, t], {
      align: scripted({
        [r.sequence]: hand(70, 0, G.slice(70, 110), G.slice(70, 110)),
        [t.sequence]: hand(
          85,
          0,
          G.slice(85, 110) + '--' + G.slice(110, 140),
          G.slice(85, 110) + 'TG' + G.slice(110, 140),
        ),
      }),
    });
    const contig = out.contigs[0];
    // The two bases only 't' has outweigh the gap 'r' alone has there.
    expect(contig?.consensus).toBe(G.slice(0, 110) + 'TG' + G.slice(110, 170));
    const rows = new Map(contig?.reads.map((x) => [x.name, x]));
    // 's' ends where the new columns begin and does not span them; 'r' does.
    expect(rows.get('s')?.row).toBe(G.slice(0, 110) + spaces(62));
    expect(rows.get('r')?.row).toBe(spaces(70) + G.slice(70, 110) + '--' + G.slice(110, 170));
    expect(rows.get('t')?.row).toBe(
      spaces(85) + G.slice(85, 110) + 'TG' + G.slice(110, 140) + spaces(30),
    );
    expect(contig?.disagreements.map((d) => [d.position, d.call, d.votes])).toEqual([
      [
        110,
        'T',
        [
          { read: 1, base: '-', quality: 30 },
          { read: 2, base: 'T', quality: 33 },
        ],
      ],
      [
        111,
        'G',
        [
          { read: 1, base: '-', quality: 30 },
          { read: 2, base: 'G', quality: 37 },
        ],
      ],
    ]);
    // 'r' alone covers the end; its qualities moved with the columns it has.
    expect(contig?.qualities.slice(142)).toEqual(rq.slice(70));
  });

  it('puts two separate runs of inserted bases each where it belongs', async () => {
    const s = G.slice(0, 200);
    const t =
      G.slice(80, 95) + 'A' + G.slice(95, 110) + 'CT' + G.slice(110, 120) + G.slice(121, 130);
    const out = await assembleReads(
      [
        { name: 's', sequence: s },
        { name: 't', sequence: t },
      ],
      {
        align: scripted({
          [t]: hand(
            80,
            0,
            G.slice(80, 95) + '-' + G.slice(95, 110) + '--' + G.slice(110, 130),
            G.slice(80, 95) +
              'A' +
              G.slice(95, 110) +
              'CT' +
              G.slice(110, 120) +
              '-' +
              G.slice(121, 130),
          ),
        }),
      },
    );
    const rows = new Map(out.contigs[0]?.reads.map((x) => [x.name, x.row]));
    expect(rows.get('s')).toBe(G.slice(0, 95) + '-' + G.slice(95, 110) + '--' + G.slice(110, 200));
    // The read's own gap, in its place among the new columns.
    expect(rows.get('t')).toBe(
      spaces(80) +
        G.slice(80, 95) +
        'A' +
        G.slice(95, 110) +
        'CT' +
        G.slice(110, 120) +
        '-' +
        G.slice(121, 130) +
        spaces(70),
    );
    expect(out.contigs[0]?.consensus).toBe(
      G.slice(0, 95) + 'A' + G.slice(95, 110) + 'CT' + G.slice(110, 200),
    );
  });

  it('gives a gap to the rows that span an insertion and not to those that begin or end at it', async () => {
    const s = G.slice(0, 110);
    const r = G.slice(70, 170);
    // The inserted bases are confident, the gaps they meet poor, so they stay.
    const tquals = flat(26 + 40 + 1 + 21 - 1, 40);
    const t = G.slice(45, 70) + 'T' + G.slice(70, 109) + 'C' + G.slice(109, 130);
    tquals[25] = 60;
    tquals[65] = 60;
    const out = await assembleReads(
      [
        { name: 's', sequence: s, qualities: flat(110, 20) },
        { name: 'r', sequence: r, qualities: flat(100, 20) },
        { name: 't', sequence: t, qualities: tquals },
      ],
      {
        align: scripted({
          [r]: hand(70, 0, G.slice(70, 110), G.slice(70, 110)),
          [t]: hand(45, 0, G.slice(45, 70) + '-' + G.slice(70, 109) + '-' + G.slice(109, 130), t),
        }),
      },
    );
    const contig = out.contigs[0];
    expect(contig?.consensus).toBe(
      G.slice(0, 70) + 'T' + G.slice(70, 109) + 'C' + G.slice(109, 170),
    );
    const rows = new Map(contig?.reads.map((x) => [x.name, x.row]));
    // 'r' begins at the first inserted column and so has nothing in it; 's'
    // ends at the second and spans it, as 'r' does.
    expect(rows.get('s')).toBe(
      G.slice(0, 70) + '-' + G.slice(70, 109) + '-' + G.slice(109, 110) + spaces(60),
    );
    expect(rows.get('r')).toBe(spaces(70) + ' ' + G.slice(70, 109) + '-' + G.slice(109, 170));
    expect(rows.get('t')).toBe(
      spaces(45) + G.slice(45, 70) + 'T' + G.slice(70, 109) + 'C' + G.slice(109, 130) + spaces(40),
    );
  });

  it('puts an insertion before the first base, before the last and after it', async () => {
    const s = G.slice(0, 100);
    const rowsOf = async (t: string, al: StrandedAlignment) => {
      const out = await assembleReads(
        [
          { name: 's', sequence: s },
          { name: 't', sequence: t },
        ],
        {
          align: scripted({ [t]: al }),
        },
      );
      return {
        consensus: out.contigs[0]?.consensus,
        rows: new Map(out.contigs[0]?.reads.map((x) => [x.name, x.row])),
      };
    };
    const first = await rowsOf(
      'A' + G.slice(0, 30),
      hand(0, 0, '-' + G.slice(0, 30), 'A' + G.slice(0, 30)),
    );
    expect(first.consensus).toBe('A' + G.slice(0, 100));
    expect(first.rows.get('s')).toBe(' ' + G.slice(0, 100));
    expect(first.rows.get('t')).toBe('A' + G.slice(0, 30) + spaces(70));

    const beforeLast = await rowsOf(
      G.slice(75, 99) + 'A' + G.slice(99, 100),
      hand(
        75,
        0,
        G.slice(75, 99) + '-' + G.slice(99, 100),
        G.slice(75, 99) + 'A' + G.slice(99, 100),
      ),
    );
    expect(beforeLast.consensus).toBe(G.slice(0, 99) + 'A' + G.slice(99, 100));
    expect(beforeLast.rows.get('s')).toBe(G.slice(0, 99) + '-' + G.slice(99, 100));
    expect(beforeLast.rows.get('t')).toBe(spaces(75) + G.slice(75, 99) + 'A' + G.slice(99, 100));

    const after = await rowsOf(
      G.slice(70, 100) + 'A',
      hand(70, 0, G.slice(70, 100) + '-', G.slice(70, 100) + 'A'),
    );
    expect(after.consensus).toBe(G.slice(0, 100) + 'A');
    expect(after.rows.get('s')).toBe(G.slice(0, 100) + ' ');
    expect(after.rows.get('t')).toBe(spaces(70) + G.slice(70, 100) + 'A');
  });

  describe('at the ends of the consensus', () => {
    // The consensus is G[0:200]. A read's alignment may stop short of an end
    // by up to 8 bases: they are paired off with the read's, and the read's
    // further bases extend the consensus.
    it.each([
      [8, true],
      [9, false],
    ])('pairs off %i bases at the right end and extends with the rest', async (c, joins) => {
      const aligned = G.slice(120, 200 - c);
      const junk = comp(G.slice(200 - c, 200)) + G.slice(300, 340 - c);
      const t = aligned + junk;
      const out = await assembleReads(
        [
          { name: 's', sequence: G.slice(0, 200), qualities: flat(200, 40) },
          { name: 't', sequence: t, qualities: tqs(t.length) },
        ],
        { align: scripted({ [t]: hand(120, 0, aligned, aligned) }) },
      );
      if (!joins) {
        expect(out.contigs.map((x) => x.reads.map((r) => r.name))).toEqual([['s'], ['t']]);
        return;
      }
      expect(out.contigs).toHaveLength(1);
      const contig = out.contigs[0];
      const paired = Array.from({ length: c }, (_, k) =>
        iupacOf([G.charAt(192 + k), comp(G.charAt(192 + k))]),
      );
      expect(contig?.consensus).toBe(G.slice(0, 192) + paired.join('') + junk.slice(c));
      const rows = new Map(contig?.reads.map((x) => [x.name, x]));
      expect(rows.get('s')?.row).toBe(G.slice(0, 200) + spaces(32));
      expect(rows.get('t')?.row).toBe(spaces(120) + G.slice(120, 192) + junk);
      expect(rows.get('t')).toMatchObject({ start: 120, end: 232 });
      expect(contig?.disagreements.map((d) => d.position)).toEqual([
        192, 193, 194, 195, 196, 197, 198, 199,
      ]);
      expect(contig?.disagreements.map((d) => d.votes[1]?.quality)).toEqual(
        Array.from({ length: 8 }, (_, k) => tq(aligned.length + k)),
      );
      expect(contig?.disagreements[3]).toMatchObject({
        call: paired[3],
        ambiguous: true,
        votes: [
          { read: 0, base: G.charAt(195), quality: 40 },
          { read: 1, base: comp(G.charAt(195)), quality: tq(aligned.length + 3) },
        ],
      });
      expect(contig?.qualities.slice(200)).toEqual(tqs(t.length).slice(aligned.length + 8));
    });

    it.each([
      [8, true],
      [9, false],
    ])('pairs off %i bases at the left end and extends with the rest', async (c, joins) => {
      const aligned = G.slice(c, 100);
      const junk = G.slice(300, 340 - c) + comp(G.slice(0, c));
      const t = junk + aligned;
      const out = await assembleReads(
        [
          { name: 's', sequence: G.slice(0, 200), qualities: flat(200, 40) },
          { name: 't', sequence: t, qualities: tqs(t.length) },
        ],
        { align: scripted({ [t]: hand(c, 40, aligned, aligned) }) },
      );
      if (!joins) {
        expect(out.contigs.map((x) => x.reads.map((r) => r.name))).toEqual([['s'], ['t']]);
        return;
      }
      expect(out.contigs).toHaveLength(1);
      const contig = out.contigs[0];
      const paired = Array.from({ length: c }, (_, k) => iupacOf([G.charAt(k), comp(G.charAt(k))]));
      expect(contig?.consensus).toBe(junk.slice(0, 40 - c) + paired.join('') + G.slice(c, 200));
      const rows = new Map(contig?.reads.map((x) => [x.name, x]));
      expect(rows.get('s')?.row).toBe(spaces(32) + G.slice(0, 200));
      expect(rows.get('t')?.row).toBe(junk + G.slice(c, 100) + spaces(100));
      expect(rows.get('t')).toMatchObject({ start: 0, end: 132 });
      expect(contig?.disagreements.map((d) => d.position)).toEqual([
        32, 33, 34, 35, 36, 37, 38, 39,
      ]);
      expect(contig?.disagreements.map((d) => d.votes[1]?.quality)).toEqual(
        Array.from({ length: 8 }, (_, k) => tq(32 + k)),
      );
      expect(contig?.disagreements[2]).toMatchObject({
        call: paired[2],
        ambiguous: true,
        votes: [
          { read: 0, base: G.charAt(2), quality: 40 },
          { read: 1, base: comp(G.charAt(2)), quality: tq(32 + 2) },
        ],
      });
      expect(contig?.qualities.slice(0, 32)).toEqual(tqs(t.length).slice(0, 32));
    });

    it.each([
      [8, true],
      [9, false],
    ])("leaves out %i bases at a read's own end that overlap nothing", async (e, joins) => {
      const aligned = G.slice(100, 150);
      const tail = comp(G.slice(150, 150 + e));
      const right = aligned + tail;
      const left = tail + aligned;
      for (const [t, al] of [
        [right, hand(100, 0, aligned, aligned)],
        [left, hand(100, e, aligned, aligned)],
      ] as const) {
        const out = await assembleReads(
          [
            { name: 's', sequence: G.slice(0, 200) },
            { name: 't', sequence: t },
          ],
          { align: scripted({ [t]: al }) },
        );
        expect(out.contigs).toHaveLength(joins ? 1 : 2);
        if (joins) {
          expect(out.contigs[0]?.consensus).toBe(G.slice(0, 200));
          expect(out.contigs[0]?.reads[1]).toMatchObject({ name: 't', start: 100, end: 150 });
        }
      }
    });
  });

  describe('what makes an overlap enough', () => {
    const s = G.slice(0, 200);
    const place = (t: string, al: StrandedAlignment, options = {}) =>
      assembleReads(
        [
          { name: 's', sequence: s },
          { name: 't', sequence: t },
        ],
        {
          align: scripted({ [t]: al }),
          ...options,
        },
      );

    it('needs minOverlap aligned bases of the consensus, and no fewer', async () => {
      for (const [len, joins] of [
        [25, true],
        [24, false],
      ] as const) {
        const t = G.slice(100, 100 + len);
        const out = await place(t, hand(100, 0, t, t));
        expect(out.contigs).toHaveLength(joins ? 1 : 2);
      }
      const t = G.slice(100, 130);
      expect((await place(t, hand(100, 0, t, t), { minOverlap: 30 })).contigs).toHaveLength(1);
      expect((await place(t, hand(100, 0, t, t), { minOverlap: 31 })).contigs).toHaveLength(2);
    });

    it('needs minIdentity of the overlap, and no less', async () => {
      const a = G.slice(100, 130);
      const mismatch = (n: number): string => {
        let b = a;
        for (let k = 0; k < n; k++)
          b = b.slice(0, k * 5) + comp(b.charAt(k * 5)) + b.slice(k * 5 + 1);
        return b;
      };
      const three = mismatch(3);
      expect((await place(three, hand(100, 0, a, three))).contigs).toHaveLength(1);
      const four = mismatch(4);
      expect((await place(four, hand(100, 0, a, four))).contigs).toHaveLength(2);
      expect(
        (await place(four, hand(100, 0, a, four), { minIdentity: 26 / 30 })).contigs,
      ).toHaveLength(1);
    });
  });
});
