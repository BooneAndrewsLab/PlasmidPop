import { describe, expect, it } from 'vitest';

import { alignEitherStrand } from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { type AssemblyAlign, type AssemblyRead, assembleReads } from './assemble';

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
});
