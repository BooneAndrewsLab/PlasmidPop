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

const TIMEOUT = process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 60_000;

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
        // Every read is tried against the seed, the unrelated one too; that one
        // is not tried again, only against each read that joins.
        const tried = new Set(calls.map((c) => c.b));
        for (const read of [r1, r2, x]) expect(tried.has(read)).toBe(true);
        expect(calls[0]?.a).toBe(s);
        // A fast local alignment, with a gap that costs as much to extend as a
        // mismatch so that it cannot run on through a repeat (#348).
        for (const c of calls) {
          expect(c.options).toEqual({ mode: 'local', fast: true, gapExtend: -4 });
        }
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
      'gives its gap the lower quality of the bases either side, whichever side that is, less 6',
      async () => {
        for (const [leftQ, rightQ] of [
          [31, 35],
          [35, 31],
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

    // A read that lost a base of a homopolymer run (#350): at depth 2 its gap,
    // at the quality of the bases beside it, used to outweigh the other read's
    // slightly poorer base and the consensus was a base short.
    it(
      'keeps a homopolymer base that one of two reads lost, when the other has it',
      async () => {
        const run = 'G'.repeat(7);
        const truth = GENOME.slice(0, 140) + run + GENOME.slice(147, 300);
        const lost = truth.slice(100, 143) + truth.slice(144, 300);
        const out = await assembleReads(
          [
            { name: 'a', sequence: truth.slice(0, 200), qualities: flat(200, 33) },
            { name: 'b', sequence: lost, qualities: flat(lost.length, 35) },
          ],
          { align, trimCutoff: null },
        );
        expect(out.contigs).toHaveLength(1);
        expect(out.contigs[0]?.consensus).toBe(truth);
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
  matchLine = '',
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
      matchLine,
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
          { read: 1, base: '-', quality: 24 },
          { read: 2, base: 'T', quality: 33 },
        ],
      ],
      [
        111,
        'G',
        [
          { read: 1, base: '-', quality: 24 },
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

/**
 * Overlaps whose differences the qualities explain (#349): two reads that
 * overlap by 60 bases and differ at every seventh of them (8 of 60, 87 %
 * identity) are one sequence when the bases that differ are poor in the read,
 * and two when they are good ones, as the copies of a diverged repeat are.
 */
describe('an overlap that differs where the reads are poor', () => {
  const first = read('a', 0, 200);
  const overlapFrom = 140;
  const tail = (q: (at: number) => number, changes: number, step = 7): AssemblyRead => {
    const s = GENOME.slice(overlapFrom, 340).split('');
    for (let k = 0; k < changes; k++) {
      const at = 3 + k * step;
      s[at] = s[at] === 'A' ? 'C' : 'A';
    }
    return {
      name: 'b',
      sequence: s.join(''),
      qualities: s.map((_, at) => q(at)),
    };
  };
  const join = (b: AssemblyRead) => assembleReads([first, b], { align, trimCutoff: null });

  it(
    'joins when the bases that differ are poor, and calls them from the good read',
    async () => {
      const out = await join(tail((at) => (at < 60 ? 10 : 40), 8));
      expect(out.contigs).toHaveLength(1);
      expect(out.contigs[0]?.consensus).toBe(GENOME.slice(0, 340));
    },
    TIMEOUT,
  );

  it(
    'does not join when the same bases are good ones in both reads',
    async () => {
      expect((await join(tail(() => 40, 8))).contigs).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'does not join below 80 % identity, however poor the bases',
    async () => {
      // 15 of 60 differ (75 %), every one at Q3: all expected, still not one sequence.
      const out = await join(tail((at) => (at < 60 ? 3 : 40), 15, 4));
      expect(out.contigs).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    'does not join when more differ than the poor bases explain',
    async () => {
      // 8 of 60 differ, but only the first 20 bases are poor (expected about 2).
      const out = await join(tail((at) => (at < 20 ? 10 : 40), 8));
      expect(out.contigs).toHaveLength(2);
    },
    TIMEOUT,
  );
});

/**
 * Repeats (#347, #348): a 200 bp direct repeat R between unique stretches,
 * U1 R U2 R U3, with reads cut from it as exact copies.
 */
describe('repeats', () => {
  const U = [randomBases(300, 71), randomBases(200, 72), randomBases(300, 73)] as const;
  const R = randomBases(200, 74);
  const T = U[0] + R + U[1] + R + U[2]; // 1200 bp; the copies at 300-500 and 700-900
  const cut = (name: string, from: number, to: number): AssemblyRead => ({
    name,
    sequence: T.slice(from, to),
    qualities: flat(to - from, 40),
  });
  const layoutOf = (out: Awaited<ReturnType<typeof assembleReads>>) =>
    out.contigs.map((c) => `${c.reads.length}:${c.consensus.length}`);

  it(
    'joins a read that spans a repeat to its neighbour though a copy fits it better (#348)',
    async () => {
      // r0 holds U1 and the whole first copy; the best local alignment of its R is the
      // copy inside the rest, which is no overlap. The true overlap is the 40 bp of
      // the first copy's end that r1 starts with.
      const reads = [cut('r0', 0, 540), cut('r1', 460, 960), cut('r2', 800, 1200)];
      const out = await assembleReads(reads, { align });
      expect(layoutOf(out)).toEqual(['3:1200']);
      expect(out.contigs[0]?.consensus).toBe(T);
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'lays a read that starts in the second copy where it belongs, not on the first (#347)',
    async () => {
      // r3 starts in the second copy and runs into U3; r0, the seed, ends inside the
      // first copy, so r3 fits its end as a join through the repeat, which would
      // lose U2 and a copy. r1 and r2, from unique sequence out of the first
      // copy, overlap more and come first, and r3 then finds its own place.
      const reads = [
        cut('r0', 0, 480),
        cut('r1', 250, 700),
        cut('r2', 450, 880),
        cut('r3', 700, 1160),
        cut('r4', 850, 1200),
      ];
      const out = await assembleReads(reads, { align });
      expect(layoutOf(out)).toEqual(['5:1200']);
      expect(out.contigs[0]?.consensus).toBe(T);
    },
    TIMEOUT,
  );

  it(
    'warns when a read fits at two places in the contig, and puts it at one',
    async () => {
      // The whole contig is known (U1 R U2 R U3); a read from inside a copy is at either.
      const reads = [cut('whole', 0, 1200), cut('inside', 350, 450)];
      const out = await assembleReads(reads, { align });
      expect(layoutOf(out)).toEqual(['2:1200']);
      const warning = out.contigs[0]?.warnings[0];
      expect(warning?.kind).toBe('ambiguous-join');
      expect(warning?.read).toBe(1);
      expect(warning?.message).toMatch(/inside/);
      expect(warning?.start).toBeGreaterThanOrEqual(300);
      expect(warning?.end).toBeLessThanOrEqual(900);
    },
    TIMEOUT,
  );

  it(
    'prefers a read that fits one place to one that fits two',
    async () => {
      const reads = [cut('whole', 0, 1200), cut('inside', 350, 450), cut('unique', 100, 250)];
      const out = await assembleReads(reads, { align });
      expect(out.contigs[0]?.warnings.map((w) => w.read)).toEqual([1]);
    },
    TIMEOUT,
  );

  it(
    'warns of a possible collapse when reads from two copies pile onto one',
    async () => {
      // Reads inside either copy cannot say which: with U1+copy and copy+U3 they join
      // through the repeat, giving U1 R U3, and the pile of four over R is the sign.
      const reads = [
        cut('left', 0, 440),
        cut('right', 760, 1200),
        cut('in1', 320, 480),
        cut('in2', 720, 880),
        cut('in3', 330, 470),
        cut('in4', 730, 870),
      ];
      const out = await assembleReads(reads, { align });
      expect(out.contigs).toHaveLength(1);
      const w = out.contigs[0]?.warnings.filter((x) => x.kind === 'possible-repeat-collapse') ?? [];
      expect(w).toHaveLength(1);
      expect(w[0]?.message).toMatch(/two copies of a repeat/);
      // The stretch is the repeat in the (collapsed) consensus: 300-500 of it.
      expect(w[0]?.start).toBeGreaterThanOrEqual(280);
      expect(w[0]?.end).toBeLessThanOrEqual(520);
    },
    TIMEOUT,
  );

  it(
    'does not warn of a collapse over uneven but ordinary coverage',
    async () => {
      // Three reads piled over 150 bp, and an even tiling: neither is a repeat.
      const g = randomBases(1500, 91);
      const r = (name: string, a: number, b: number): AssemblyRead => ({
        name,
        sequence: g.slice(a, b),
        qualities: flat(b - a, 40),
      });
      const piled = await assembleReads(
        [r('a', 0, 600), r('b', 450, 1000), r('c', 460, 600), r('d', 900, 1500)],
        { align },
      );
      expect(piled.contigs).toHaveLength(1);
      expect(piled.contigs[0]?.warnings).toEqual([]);
      const tiled = await assembleReads(
        [0, 250, 500, 750, 1000].map((s) => r(`t${s}`, s, s + 500)),
        { align },
      );
      expect(tiled.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'has no warnings for reads that overlap in unique sequence only',
    async () => {
      const out = await assembleReads([read('a', 0, 300), read('b', 200, 500)], { align });
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );
  describe('overlaps in the tails the trim took off (#349)', () => {
    /** Read `[start, end)` of GENOME at Q40, with `[poor, end)` at Q12 and the bases at `flips` changed. */
    function noisy(
      name: string,
      start: number,
      end: number,
      poor: [number, number],
      flips: readonly number[],
    ): AssemblyRead {
      const bases = Array.from(GENOME.slice(start, end));
      for (const g of flips) {
        const k = g - start;
        bases[k] = bases[k] === 'A' ? 'C' : 'A';
      }
      return {
        name,
        sequence: bases.join(''),
        qualities: Array.from({ length: end - start }, (_, k) =>
          start + k >= poor[0] && start + k < poor[1] ? 12 : 40,
        ),
      };
    }

    // A's last 60 bases and B's first 60 are Q12 (the trim takes them off at
    // Q13) and each has a few of the errors that quality states; they
    // overlap over 230-300, and the trimmed reads (0-240 and 290-550) do not.
    const a = noisy('a', 0, 300, [240, 300], [262, 281]);
    const b = noisy('b', 230, 550, [230, 290], [233, 245, 270]);

    it(
      'joins two reads whose only overlap lies in the poor ends',
      async () => {
        const out = await assembleReads([a, b], { align });
        expect(out.contigs).toHaveLength(1);
        expect(out.contigs[0]?.reads.map((r) => r.name).sort()).toEqual(['a', 'b']);
        // The stretch is the whole of both reads' good parts at least.
        expect(out.contigs[0]?.consensus.length).toBeGreaterThanOrEqual(540);
        expect(out.contigs[0]?.consensus.length).toBeLessThanOrEqual(552);
      },
      TIMEOUT,
    );

    it(
      'joins them as well with the trim switched off or already loose',
      async () => {
        // Nothing is trimmed, so the tails are in the one pass.
        const none = await assembleReads([a, b], { align, trimCutoff: null });
        expect(none.contigs).toHaveLength(1);
        // At Q10 (0.1) the tails are kept in the first pass already.
        const loose = await assembleReads([a, b], { align, trimCutoff: 0.1 });
        expect(loose.contigs).toHaveLength(1);
      },
      TIMEOUT,
    );

    it(
      'does not let a poor tail base outvote a good base of the other read',
      async () => {
        const out = await assembleReads([a, b], { align });
        const c = out.contigs[0];
        expect(c).toBeDefined();
        if (c === undefined) return;
        // Where one read is Q40 the consensus is the truth: the whole start, the whole end and the
        // base B got wrong at 233, which A has at Q40.
        const truthAt = (from: number, to: number): string => GENOME.slice(from, to);
        const cons = c.consensus;
        const forward = cons.startsWith(truthAt(0, 20));
        const text = forward ? cons : reverseComplement(cons);
        expect(text.slice(0, 240)).toBe(truthAt(0, 240));
        expect(text.slice(text.length - 250)).toBe(truthAt(300, 550));
        expect(text.charAt(233)).toBe(GENOME.charAt(233));
        // The tails' own errors are flagged as low quality, not called confidently.
        for (const q of c.qualities.slice(245, 285)) expect(q).toBeLessThan(40);
      },
      TIMEOUT,
    );

    it(
      'keeps unrelated reads with poor ends apart, and trims them as before',
      async () => {
        const other = randomBases(600, 777);
        const x = a;
        const y: AssemblyRead = {
          name: 'y',
          sequence: other.slice(230, 550),
          qualities: Array.from({ length: 320 }, (_, k) => (k < 60 ? 12 : 40)),
        };
        const out = await assembleReads([x, y], { align });
        expect(out.contigs).toHaveLength(2);
        // The second pass was not taken: both reads keep the stricter trim.
        const trimmedA = out.contigs.flatMap((c) => c.reads).find((r) => r.name === 'a');
        expect(trimmedA?.trimmed.end).toBeLessThan(260);
      },
      TIMEOUT,
    );

    it(
      'does not join reads whose tails agree no better than chance, whatever qualities they state',
      async () => {
        // The tails claim Q12 but share nothing: the same stretch, scrambled.
        const scrambled = randomBases(70, 4242);
        const junkB: AssemblyRead = {
          name: 'b',
          sequence: scrambled + GENOME.slice(300, 550),
          qualities: Array.from({ length: 320 }, (_, k) => (k < 60 ? 12 : 40)),
        };
        const out = await assembleReads([a, junkB], { align });
        expect(out.contigs).toHaveLength(2);
      },
      TIMEOUT,
    );
  });
});

/** `hand` with the match line the columns give: `|` for a match, `.` for a mismatch, a space for a gap. */
function handLine(
  startA: number,
  startB: number,
  alignedA: string,
  alignedB: string,
  score = 0,
): StrandedAlignment {
  const line = Array.from(alignedA, (x, i) => {
    const y = alignedB.charAt(i);
    return x === '-' || y === '-' ? ' ' : x === y ? '|' : '.';
  }).join('');
  const al = hand(startA, startB, alignedA, alignedB, line);
  return { ...al, alignment: { ...al.alignment, score } };
}

/** The bases of `s` turned into others, so every one differs. */
const unlike = (s: string): string => comp(s);

describe('the stretch of an alignment that holds the identity', () => {
  // A local alignment that runs on past the overlap through sequence that is
  // not one has too little identity; what is kept is the stretch with the
  // most matches that holds 90 % (a column that is no match costs nine).
  const cons = G.slice(0, 200);
  const rest = unlike(G.slice(200, 240));
  const join = (t: string, al: StrandedAlignment, consensus = cons, qualities = 40) =>
    assembleReads(
      [
        { name: 's', sequence: consensus, qualities: flat(consensus.length, 20) },
        { name: 't', sequence: t, qualities: flat(t.length, qualities) },
      ],
      { align: scripted({ [t]: al }), trimCutoff: null },
    );

  it('places the read by the stretch, not by the whole alignment', async () => {
    // 100 bases match; the read then goes on for 40 that the consensus has no more of.
    const t = G.slice(100, 200) + rest;
    const al = handLine(100, 0, G.slice(100, 200) + '-'.repeat(40), t);
    const out = await join(t, al);
    expect(out.contigs).toHaveLength(1);
    expect(out.contigs[0]?.consensus).toBe(G.slice(0, 200) + rest);
    const row = out.contigs[0]?.reads.find((r) => r.name === 't');
    expect(row?.row).toBe(spaces(100) + t);
    expect([row?.start, row?.end]).toEqual([100, 240]);
  });

  it('counts the consensus bases the stretch spans, not the gaps in it', async () => {
    // 40 columns before the stretch hold consensus bases the read has none of.
    const t = G.slice(100, 200);
    const al = handLine(60, 0, G.slice(60, 200), '-'.repeat(40) + t);
    const out = await join(t, al);
    expect(out.contigs).toHaveLength(1);
    const row = out.contigs[0]?.reads.find((r) => r.name === 't');
    expect(row?.row).toBe(spaces(100) + t);
  });

  it('counts the read bases before the stretch, not the gaps in them', async () => {
    // 40 columns before the stretch hold read bases the consensus has none of.
    const head = unlike(G.slice(300, 340));
    const t = head + G.slice(0, 100);
    const al = handLine(0, 0, '-'.repeat(40) + G.slice(0, 100), t.slice(0, 40) + G.slice(0, 100));
    const out = await join(t, al, G.slice(0, 200));
    expect(out.contigs).toHaveLength(1);
    expect(out.contigs[0]?.consensus).toBe(head + G.slice(0, 200));
    const row = out.contigs[0]?.reads.find((r) => r.name === 't');
    expect(row?.row).toBe(head + G.slice(0, 100) + spaces(100));
  });

  it('keeps a stretch that ends where the consensus has eight bases left, and no fewer', async () => {
    // The read's 40 extra bases pair off with the last eight (the slack at an
    // end) and extend; with nine left the read would be no overlap there.
    for (const [left, joins] of [
      [8, true],
      [9, false],
    ] as const) {
      const consensus = G.slice(0, 200 + left);
      const t = G.slice(100, 200) + rest;
      const al = handLine(100, 0, G.slice(100, 200 + left) + '-'.repeat(40 - left), t);
      // Aligned past 200 the read's tail meets the consensus: mismatches.
      const out = await join(t, al, consensus);
      expect(out.contigs).toHaveLength(joins ? 1 : 2);
    }
  });

  it('starts the stretch after the last column that spent all it had earned', async () => {
    // Nine matches earn nine; a mismatch then costs nine, so the stretch starts
    // after it: ten bases of the read before the stretch are no overlap.
    const t = G.slice(0, 9) + unlike(G.slice(9, 10)) + G.slice(10, 60) + rest;
    const a = G.slice(0, 60) + G.slice(60, 100);
    const al = handLine(0, 0, a, t.slice(0, 60) + unlike(G.slice(60, 100)));
    const out = await join(t, al, G.slice(0, 100));
    expect(out.contigs).toHaveLength(2);
  });

  it('starts the stretch after a run of mismatches that put it under water', async () => {
    // Ten mismatching columns, then 50 matches: the ten bases before the
    // stretch are more than the slack of an end allows.
    const t = unlike(G.slice(0, 10)) + G.slice(10, 60) + rest;
    const a = G.slice(0, 60) + G.slice(60, 100);
    const al = handLine(0, 0, a, t.slice(0, 60) + unlike(G.slice(60, 100)));
    const out = await join(t, al, G.slice(0, 100));
    expect(out.contigs).toHaveLength(2);
  });

  it('keeps the whole alignment when it has the identity, mismatches at its end and all', async () => {
    // 95 matches and ten mismatches at the end (90.5 %): no need to cut it.
    const t = G.slice(95, 190) + unlike(G.slice(190, 200));
    const al = handLine(95, 0, G.slice(95, 200), t);
    const out = await join(t, al, G.slice(0, 200));
    expect(out.contigs).toHaveLength(1);
  });

  describe('at a minimum identity of 0.5, where a mismatch costs exactly one match', () => {
    const half = (t: string, al: StrandedAlignment, length: number) =>
      assembleReads(
        [
          { name: 's', sequence: G.slice(0, length), qualities: flat(length, 20) },
          { name: 't', sequence: t, qualities: flat(t.length, 40) },
        ],
        { align: scripted({ [t]: al }), trimCutoff: null, minIdentity: 0.5 },
      );

    it('ends the stretch at the first place that earned the most', async () => {
      // 30 matches, ten mismatches and ten matches earn what the 30 did; the
      // stretch is the 30, and the 20 columns after it leave no overlap at the end.
      const t = G.slice(0, 30) + unlike(G.slice(30, 40)) + G.slice(40, 50);
      const al = handLine(0, 0, G.slice(0, 110), t + '-'.repeat(60));
      expect((await half(t, al, 110)).contigs).toHaveLength(2);
    });

    it('starts the stretch after a column that brought what had been earned to nothing', async () => {
      // A match and a mismatch five times over earn nothing, so the stretch
      // starts after them, and ten bases in on both sides is no overlap at the start.
      const pairs = Array.from(
        { length: 5 },
        (_, k) => G.charAt(2 * k) + unlike(G.charAt(2 * k + 1)),
      );
      const t = pairs.join('') + G.slice(10, 60);
      const al = handLine(0, 0, G.slice(0, 120), t + '-'.repeat(60));
      expect((await half(t, al, 120)).contigs).toHaveLength(2);
    });
  });

  it('does not join on an alignment with no column that matches, however little is asked', async () => {
    // Eight bases that all differ, at the very end of the consensus: with no
    // overlap needed they would be an overlap of nothing.
    const t = unlike(G.slice(100, 108));
    const al = handLine(100, 0, G.slice(100, 108), t);
    const out = await assembleReads(
      [
        { name: 's', sequence: G.slice(0, 108), qualities: flat(108, 20) },
        { name: 't', sequence: t, qualities: flat(t.length, 40) },
      ],
      { align: scripted({ [t]: al }), trimCutoff: null, minOverlap: 0 },
    );
    expect(out.contigs).toHaveLength(2);
  });
});

describe('an alignment under 90 % identity that the qualities of its bases explain', () => {
  /**
   * A 0.8 to 0.9 identity overlap written as columns: `m` a match, `x` a
   * mismatch, `i` a base only the read has, `d` a base only the consensus has.
   * Every base is Q40 but the ones named (by position in the consensus or in
   * the read), which are as given; the consensus goes on ten bases past the
   * overlap, at Q40.
   */
  function overlap(
    columns: string,
    poorConsensus: Record<number, number>,
    poorRead: Record<number, number>,
    options: { minIdentity?: number } = {},
  ) {
    let a = '';
    let b = '';
    let at = 0;
    for (const column of columns) {
      const base = G.charAt(at);
      if (column === 'i') {
        a += '-';
        b += unlike(base);
      } else {
        a += base;
        b += column === 'd' ? '-' : column === 'x' ? unlike(base) : base;
        at++;
      }
    }
    const t = b.replace(/-/g, '');
    const s = G.slice(0, at + 10);
    const quals = (n: number, poor: Record<number, number>) =>
      Array.from({ length: n }, (_, k) => poor[k] ?? 40);
    return assembleReads(
      [
        { name: 's', sequence: s, qualities: quals(s.length, poorConsensus) },
        { name: 't', sequence: t, qualities: quals(t.length, poorRead) },
      ],
      { align: scripted({ [t]: handLine(0, 0, a, b) }), trimCutoff: null, ...options },
    );
  }

  it('joins when the bases that differ are poor, and not when they are good', async () => {
    // Each is 26 to 30 columns at 80 to 90 % identity, so only the qualities
    // can account for the columns that are no match. They are written so that
    // an error in how the expected count is summed (which base's quality a
    // gap takes, where the two reads' positions advance) turns the answer over.
    const cases: [string, Record<number, number>, Record<number, number>, boolean][] = [
      ['mmmmmmmmmmmmmimdmmmmmimmmmmm', { 0: 10, 27: 10 }, { 16: 10, 19: 20, 25: 10 }, false],
      ['immmmmmmdmmmxmmmmmmmmmmmmm', { 7: 10, 19: 10 }, { 0: 10, 18: 10 }, true],
      ['mmmdmmmmdmmmmmmmmmmmmmimmmmm', { 20: 10, 22: 10 }, { 3: 10 }, false],
    ];
    for (const [columns, poorConsensus, poorRead, joins] of cases) {
      const out = await overlap(columns, poorConsensus, poorRead);
      expect(out.contigs, columns).toHaveLength(joins ? 1 : 2);
    }
  });

  it('needs 80 % identity, whatever the qualities, and no less', async () => {
    // 20 of 25 columns match, and every base is Q10, so the five that do not are expected.
    const poor = Object.fromEntries(Array.from({ length: 40 }, (_, k) => [k, 10]));
    const columns = 'mmmmxmmmmxmmmmxmmmmxmmmmx';
    expect((await overlap(columns, poor, poor)).contigs).toHaveLength(1);
    // 19 of 25 do not.
    const fewer = 'mmmxmmmmxmmmmxmmmmxmmmxmx';
    expect((await overlap(fewer, poor, poor)).contigs).toHaveLength(2);
  });
});

describe('where a read is looked for in the consensus', () => {
  type Call = readonly [string, string];
  /** `align` that notes what it was asked, and lets `override` answer first. */
  const spy = (
    calls: Call[],
    override: (a: string, b: string) => StrandedAlignment | null = () => null,
  ): AssemblyAlign => {
    return (a, b, options) => {
      calls.push([a, b]);
      return Promise.resolve(override(a, b) ?? alignEitherStrand(a, b, options));
    };
  };
  const q40 = (s: string): number[] => flat(s.length, 40);

  describe('a read that overlaps the consensus only through its end, past a repeat', () => {
    // The consensus is a repeat unit R and 300 bases after it; the read has 200
    // bases of its own before an R. Its best alignment as a whole is said to be
    // another place (no overlap), so the ends of both are tried.
    const R = randomBases(200, 901);
    const Y = randomBases(300, 902);
    const X = randomBases(200, 903);
    const s = R + Y;
    const t = X + R;

    for (const reverse of [false, true]) {
      it(`${reverse ? 'a reverse' : 'a forward'} read: aligns each end of the consensus to each end of the read, and places it by the one that fits`, async () => {
        const read = reverse ? comp(t).split('').reverse().join('') : t;
        const calls: Call[] = [];
        const out = await assembleReads(
          [
            { name: 's', sequence: s, qualities: q40(s) },
            { name: 'read', sequence: read, qualities: q40(read) },
          ],
          {
            align: spy(calls, (a, b) =>
              a === s && b === read ? handLine(0, 200, R.slice(0, 60), R.slice(0, 60)) : null,
            ),
            trimCutoff: null,
          },
        );
        expect(calls.slice(0, 5)).toEqual([
          [s, read],
          [s.slice(0, 300), read.slice(0, 300)],
          [s.slice(0, 300), read.slice(100)],
          [s.slice(200), read.slice(0, 300)],
          [s.slice(200), read.slice(100)],
        ]);
        expect(out.contigs).toHaveLength(1);
        expect(out.contigs[0]?.consensus).toBe(X + R + Y);
        const placed = out.contigs[0]?.reads.find((r) => r.name === 'read');
        expect([placed?.strand, placed?.start, placed?.end]).toEqual([
          reverse ? 'reverse' : 'forward',
          0,
          400,
        ]);
      });
    }
  });

  it('does not align the ends of the consensus to a read that lies inside it', async () => {
    const s = G.slice(0, 600);
    const t = G.slice(100, 250);
    const calls: Call[] = [];
    const out = await assembleReads(
      [
        { name: 's', sequence: s, qualities: q40(s) },
        { name: 't', sequence: t, qualities: q40(t) },
      ],
      { align: spy(calls), trimCutoff: null },
    );
    expect(out.contigs).toHaveLength(1);
    expect(calls[0]).toEqual([s, t]);
    expect(calls.filter(([a]) => a.length === 300)).toEqual([]);
  });

  it('does not look for a second place in what is left of the consensus when that is less than the overlap asked', async () => {
    const s = G.slice(0, 200);
    for (const [start, end] of [
      [0, 60],
      [140, 200],
    ] as const) {
      const t = G.slice(start, end);
      const calls: Call[] = [];
      await assembleReads(
        [
          { name: 's', sequence: s, qualities: q40(s) },
          { name: 't', sequence: t, qualities: q40(t) },
        ],
        { align: spy(calls), trimCutoff: null },
      );
      expect(calls.filter(([a]) => a.length < 25)).toEqual([]);
    }
  });

  it('warns of a second place that is as long as the overlap asked, and no shorter', async () => {
    const s = G.slice(0, 200);
    const t = G.slice(150, 175);
    const out = await assembleReads(
      [
        { name: 's', sequence: s, qualities: q40(s) },
        { name: 't', sequence: t, qualities: q40(t) },
      ],
      {
        align: (a, b, options) =>
          Promise.resolve(
            b === t && a === s
              ? handLine(150, 0, t, t)
              : b === t && a === s.slice(175)
                ? handLine(0, 0, t, t)
                : alignEitherStrand(a, b, options),
          ),
        trimCutoff: null,
      },
    );
    expect(out.contigs[0]?.warnings.map((w) => [w.kind, w.read])).toEqual([['ambiguous-join', 1]]);
  });

  it('puts a read that fits nowhere aside until a read that joins overlaps it, and tries again one that overlapped a little', async () => {
    const s = G.slice(0, 400);
    const joins = G.slice(300, 500);
    const nowhere = randomBases(150, 904);
    const partly = randomBases(200, 905);
    const calls: Call[] = [];
    const out = await assembleReads(
      [
        { name: 's', sequence: s, qualities: q40(s) },
        { name: 'joins', sequence: joins, qualities: q40(joins) },
        { name: 'nowhere', sequence: nowhere, qualities: q40(nowhere) },
        { name: 'partly', sequence: partly, qualities: q40(partly) },
      ],
      {
        // 'partly' has an alignment against the whole consensus that is no overlap
        // and none against an end of it.
        align: spy(calls, (a, b) =>
          b === partly
            ? a.length > 300
              ? handLine(100, 0, G.slice(100, 160), G.slice(100, 160))
              : hand(0, 0, '', '')
            : null,
        ),
        trimCutoff: null,
      },
    );
    expect(out.contigs.map((c) => c.reads.length)).toEqual([2, 1, 1]);
    // Against the contig 's' began; 'partly' then seeds a contig of its own.
    expect(calls.filter(([a, b]) => b === nowhere && a.length > 300)).toHaveLength(1);
    expect(calls.filter(([a, b]) => b === partly && a.length > 300)).toHaveLength(2);
  });
});

describe('choosing among the places a read fits the ends of the consensus', () => {
  // The consensus is 600 bases; the read is 284, whose first 184 columns
  // hold 180 matches, two mismatches, and a base only the read has and one
  // only the consensus has, and whose last 100 bases the consensus has no
  // more of. Against the first 300 of the consensus the read fits entirely
  // at a score of `inside`; against the last 300 it fits by that stretch, at
  // 5 per match less 4 per mismatch, 892.
  const s = G.slice(0, 600);
  const columns = (ops: string): { a: string; b: string } => {
    let a = '';
    let b = '';
    let at = 417;
    for (const op of ops) {
      const base = G.charAt(at % 600);
      if (op === 'i') {
        a += '-';
        b += unlike(base);
      } else {
        a += base;
        b += op === 'd' ? '-' : op === 'x' ? unlike(base) : base;
        at++;
      }
    }
    return { a, b };
  };
  const { a, b } = columns(
    'm'.repeat(60) +
      'i' +
      'm'.repeat(30) +
      'x' +
      'm'.repeat(30) +
      'd' +
      'm'.repeat(30) +
      'x' +
      'm'.repeat(30) +
      'i'.repeat(100),
  );
  const t = b.replace(/-/g, '');

  const placeAt = async (inside: number): Promise<number | undefined> => {
    const out = await assembleReads(
      [
        { name: 's', sequence: s },
        { name: 't', sequence: t },
      ],
      {
        align: (x, y) =>
          Promise.resolve(
            y !== t
              ? hand(0, 0, '', '')
              : x === s
                ? handLine(400, 0, G.slice(400, 460), G.slice(400, 460))
                : x === s.slice(0, 300)
                  ? handLine(0, 0, t, t, inside)
                  : x === s.slice(300)
                    ? handLine(117, 0, a, b)
                    : hand(0, 0, '', ''),
          ),
        trimCutoff: null,
      },
    );
    return out.contigs[0]?.reads.find((r) => r.name === 't')?.start;
  };

  it('puts it where the stretch of matches scores more than the other place', async () => {
    expect(await placeAt(890)).toBe(417);
  });

  it('puts it at the other place when that scores more than the stretch', async () => {
    expect(await placeAt(894)).toBe(0);
  });

  it('keeps the first of two places that score the same', async () => {
    expect(await placeAt(892)).toBe(0);
  });
});

describe('the warning that reads may have piled onto one copy of a repeat', () => {
  // The depth profile alone decides the warning, so these reads come from
  // unique sequence: one long backbone read (or two), and short reads laid
  // inside it to make the depth just what a test wants.
  const U = randomBases(1000, 501);
  const part = (from: number, to: number, name = `u${from}-${to}`): AssemblyRead => ({
    name,
    sequence: U.slice(from, to),
    qualities: flat(to - from, 40),
  });
  const collapses = async (reads: AssemblyRead[]) => {
    const out = await assembleReads(reads, { align });
    expect(out.contigs).toHaveLength(1);
    const c = out.contigs[0];
    expect(c?.consensus).toBe(U.slice(0, c?.consensus.length));
    return {
      depth: c?.depth ?? [],
      found: (c?.warnings ?? []).filter((w) => w.kind === 'possible-repeat-collapse'),
    };
  };

  it(
    'warns of a stretch of exactly 100 bases at depth 4, and not of one of 99',
    async () => {
      const at100 = await collapses([
        part(0, 1000),
        part(300, 400, 'x1'),
        part(300, 400, 'x2'),
        part(300, 400, 'x3'),
      ]);
      expect(at100.depth.slice(299, 401)).toEqual([1, ...new Array<number>(100).fill(4), 1]);
      expect(at100.found.map((w) => [w.start, w.end])).toEqual([[300, 400]]);
      const at99 = await collapses([
        part(0, 1000),
        part(300, 399, 'x1'),
        part(300, 399, 'x2'),
        part(300, 399, 'x3'),
      ]);
      expect(at99.found).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'reports a stretch that starts at the first base and one that runs to the last',
    async () => {
      const first = await collapses([
        part(0, 1000),
        part(0, 100, 'x1'),
        part(0, 100, 'x2'),
        part(0, 100, 'x3'),
      ]);
      expect(first.found.map((w) => [w.start, w.end])).toEqual([[0, 100]]);
      expect(first.found[0]?.message).toMatch(
        /^1–100 is covered 4× deep where the contig is 1× deep/,
      );
      const last = await collapses([
        part(0, 1000),
        part(900, 1000, 'x1'),
        part(900, 1000, 'x2'),
        part(900, 1000, 'x3'),
      ]);
      expect(last.found.map((w) => [w.start, w.end])).toEqual([[900, 1000]]);
    },
    TIMEOUT,
  );

  it(
    'takes the stretch at depth 3 and up, and states its mean to a tenth',
    async () => {
      // 3 over 20 + 40 bases, 4 over 40: the stretch is 300-400 and its mean 3.4.
      const out = await collapses([
        part(0, 1000),
        part(300, 400, 'x1'),
        part(300, 400, 'x2'),
        part(320, 360, 'x3'),
      ]);
      expect(out.depth[319]).toBe(3);
      expect(out.depth[320]).toBe(4);
      expect(out.found.map((w) => [w.start, w.end])).toEqual([[300, 400]]);
      expect(out.found[0]?.message).toMatch(
        /^301–400 is covered 3\.4× deep where the contig is 1× deep: /,
      );
    },
    TIMEOUT,
  );

  it(
    'does not warn of a stretch that never gets deeper than 3',
    async () => {
      // Four reads, a stretch of 100 at depth 3 whose mean is 3 times the median.
      const out = await collapses([
        part(0, 600),
        part(500, 1000),
        part(100, 200, 'x1'),
        part(100, 200, 'x2'),
      ]);
      expect(Math.max(...out.depth)).toBe(3);
      expect(out.found).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'weighs the stretch against the median depth of the contig, which is 2 here',
    async () => {
      const backbone = [part(0, 1000, 'b1'), part(0, 1000, 'b2')];
      // 4 deep is under 3 x 2 ...
      const under = await collapses([...backbone, part(300, 400, 'x1'), part(300, 400, 'x2')]);
      expect(under.depth[350]).toBe(4);
      expect(under.found).toEqual([]);
      // ... 6 deep is exactly 3 x 2 ...
      const exact = await collapses([
        ...backbone,
        ...[1, 2, 3, 4].map((i) => part(300, 400, `x${i}`)),
      ]);
      expect(exact.depth[350]).toBe(6);
      expect(exact.found.map((w) => [w.start, w.end])).toEqual([[300, 400]]);
      expect(exact.found[0]?.message).toMatch(/covered 6× deep where the contig is 2× deep/);
      // ... and a mean of 5.99 is under it, though the base after the stretch is 2 deep.
      const just = await collapses([
        ...backbone,
        part(300, 400, 'x1'),
        part(300, 400, 'x2'),
        part(300, 400, 'x3'),
        part(300, 399, 'x4'),
      ]);
      expect(just.depth.slice(396, 401)).toEqual([6, 6, 6, 5, 2]);
      expect(just.found).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('the second pass at a looser trim, and how far it goes (#349)', () => {
  type Call = readonly [string, string];
  const counting = (calls: Call[]): AssemblyAlign => {
    return (a, b, options) => {
      calls.push([a, b]);
      return align(a, b, options);
    };
  };
  const q40 = (s: string): number[] => flat(s.length, 40);
  const callsFor = async (reads: AssemblyRead[], trimCutoff?: number | null) => {
    const calls: Call[] = [];
    const out = await assembleReads(
      reads,
      trimCutoff === undefined
        ? { align: counting(calls) }
        : { align: counting(calls), trimCutoff },
    );
    return { calls, out };
  };
  const unique = (name: string, from: number, to: number): AssemblyRead => ({
    name,
    sequence: G.slice(from, to),
    qualities: q40(G.slice(from, to)),
  });

  it(
    'does not go over the reads again when they made one contig',
    async () => {
      const reads = [unique('a', 0, 300), unique('b', 200, 500)];
      const once = await callsFor(reads, null);
      const dflt = await callsFor(reads);
      expect(dflt.out.contigs).toHaveLength(1);
      expect(once.calls.length).toBeGreaterThan(0);
      expect(dflt.calls).toEqual(once.calls);
    },
    TIMEOUT,
  );

  it(
    'goes over them again at twice the cutoff when they made several, and not when it is already 0.2',
    async () => {
      const other = randomBases(300, 4711);
      const reads = [unique('a', 0, 300), { name: 'x', sequence: other, qualities: q40(other) }];
      const once = await callsFor(reads, null);
      expect(once.out.contigs).toHaveLength(2);
      for (const cutoff of [0.05, 0.1]) {
        const twice = await callsFor(reads, cutoff);
        expect(twice.out.contigs).toHaveLength(2);
        expect(twice.calls).toEqual([...once.calls, ...once.calls]);
      }
      // At the ceiling the second pass would trim at the very same rate.
      const ceiling = await callsFor(reads, 0.2);
      expect(ceiling.calls).toEqual(once.calls);
    },
    TIMEOUT,
  );

  it(
    'keeps the tails only as far as twice the cutoff, not as far as the ceiling',
    async () => {
      // Both reads end (and begin) in 60 bases at Q8, a 16 % error rate: kept at a
      // cutoff of 0.2, trimmed at 0.1, which is where the default 0.05 doubles to.
      const tail = (name: string, start: number, end: number, poor: [number, number]) => ({
        name,
        sequence: G.slice(start, end),
        qualities: Array.from({ length: end - start }, (_, k) =>
          start + k >= poor[0] && start + k < poor[1] ? 8 : 40,
        ),
      });
      const reads = [tail('a', 0, 300, [240, 300]), tail('b', 230, 550, [230, 290])];
      const dflt = await assembleReads(reads, { align });
      expect(dflt.contigs.map((c) => c.reads.length)).toEqual([1, 1]);
      const loose = await assembleReads(reads, { align, trimCutoff: 0.2 });
      expect(loose.contigs.map((c) => c.reads.length)).toEqual([2]);
    },
    TIMEOUT,
  );
});

describe('which reads are tried again after a read joins, and which are put aside', () => {
  type Call = readonly [string, string];
  const q40 = (s: string): number[] => flat(s.length, 40);
  const s = G.slice(0, 400);
  const j = G.slice(300, 500);
  // 130 bases that share the last 30 of `j` and nothing of `s`.
  const u = G.slice(470, 600);
  const nowhere = randomBases(150, 990);
  const reads = [s, j, u, nowhere].map((sequence, i) => ({
    name: ['s', 'j', 'u', 'nowhere'][i] ?? '',
    sequence,
    qualities: q40(sequence),
  }));

  /** Assembles with the alignment of `u` against `j` told as `hit`; what was asked of the aligner, and the contigs. */
  const run = async (hit: StrandedAlignment | null) => {
    const calls: Call[] = [];
    const out = await assembleReads(reads, {
      align: (a, b, options) => {
        calls.push([a, b]);
        return Promise.resolve(
          hit !== null && a === u && b === j ? hit : alignEitherStrand(a, b, options),
        );
      },
      trimCutoff: null,
    });
    return {
      calls,
      // Against the consensus, not against a read that joined.
      tries: calls.filter(([a, b]) => b === u && (a === s || a === G.slice(0, 500))).length,
      sizes: out.contigs.map((c) => c.reads.length),
    };
  };
  const stretch = (from: number, to: number): string => u.slice(from, to);
  const mismatched = (text: string, at: readonly number[]): string =>
    Array.from(text, (ch, i) => (at.includes(i) ? unlike(ch) : ch)).join('');

  it('asks a read that fits nowhere about a read that joined only when they could overlap', async () => {
    const r = await run(null);
    // `u` shares 30 bases with `j`, so it is tried against it, and then again
    // against the consensus, where it joins; `nowhere` shares nothing with `j`.
    expect(r.calls.filter(([a, b]) => a === u && b === j)).toHaveLength(1);
    expect(r.calls.filter(([a, b]) => a === nowhere && b === j)).toEqual([]);
    expect(r.tries).toBe(2);
    expect(r.sizes).toEqual([3, 1]);
  });

  it('tries it again when the overlap with the read that joined is 25 bases, not when it is shorter', async () => {
    const a = stretch(0, 25);
    expect((await run(handLine(0, 0, a, a))).tries).toBe(2);
    // 20 bases at 10-30 of the read: the end is past the minimum, the overlap is not.
    const b = stretch(10, 30);
    expect((await run(handLine(10, 0, b, b))).tries).toBe(1);
    const c = stretch(0, 24);
    expect((await run(handLine(0, 0, c, c))).tries).toBe(1);
  });

  it('tries it again at an identity of exactly the minimum, not below it', async () => {
    const a = stretch(0, 30);
    // 27 of 30 columns match: 0.9.
    const exact = handLine(0, 0, a, mismatched(a, [5, 15, 25]));
    expect(exact.alignment.identity).toBe(0.9);
    expect((await run(exact)).tries).toBe(2);
    // 26 of 30, with the mismatches where no stretch of 25 holds 0.9.
    const below = handLine(0, 0, a, mismatched(a, [5, 10, 15, 20]));
    expect((await run(below)).tries).toBe(1);
  });

  it('tries it again when the part of a poor alignment that holds the identity is an overlap, and not when none is', async () => {
    // 30 columns that match, then 10 that do not: 0.75 as a whole.
    const a = stretch(0, 40);
    const tail = handLine(0, 0, a, a.slice(0, 30) + unlike(a.slice(30)));
    expect(tail.alignment.identity).toBe(0.75);
    expect((await run(tail)).tries).toBe(2);
    // Nothing of it matches, so no stretch holds any identity.
    const b = stretch(0, 30);
    const none = handLine(0, 0, b, unlike(b));
    expect((await run(none)).tries).toBe(1);
    expect((await run(none)).sizes).toEqual([2, 1, 1]);
  });
});

describe('a tie among the reads that fit', () => {
  it('puts the read that was tried first first when two fit as well as each other', async () => {
    const s4 = G.slice(0, 400);
    const r1 = G.slice(300, 500);
    const r2 = G.slice(300, 490);
    const overlap = G.slice(300, 400);
    const out = await assembleReads(
      [
        { name: 's', sequence: s4 },
        { name: 'r1', sequence: r1 },
        { name: 'r2', sequence: r2 },
      ],
      {
        // Both overlap the seed in the same 100 bases; once one of them has joined,
        // the consensus is longer and the other is told to overlap nothing.
        align: (x, y) =>
          Promise.resolve(
            x === s4 && (y === r1 || y === r2)
              ? hand(300, 0, overlap, overlap)
              : hand(0, 0, '', ''),
          ),
      },
    );
    expect(out.contigs[0]?.reads.map((r) => r.name).sort()).toEqual(['r1', 's']);
  });
});
