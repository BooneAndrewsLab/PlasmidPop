import { describe, expect, it } from 'vitest';

import { CLEAN, genericQualities, randomBases, rng, simulateRead } from '@/test/oracle/sangerSim';

import { alignEitherStrand } from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { type AssemblyAlign, type AssemblyRead, assembleReads } from './assemble';
import { findReadPairs } from './pairing';

const align: AssemblyAlign = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));
const TIMEOUT = process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 60_000;

function bases(n: number, seed: number): string {
  return randomBases(n, rng(seed));
}

/**
 * A construct of 1200 bp, unique 300, repeat 200, unique 200, the repeat
 * again, unique 300, so the copies are at 300-500 and 700-900.
 */
const U = [bases(300, 71), bases(200, 72), bases(300, 73)] as const;
const R = bases(200, 74);
const T = U[0] + R + U[1] + R + U[2];
const q = (n: number, v = 40): number[] => new Array<number>(n).fill(v);
const fwd = (name: string, from: number, to: number): AssemblyRead => ({
  name,
  sequence: T.slice(from, to),
  qualities: q(to - from),
});
/** A reverse read: the reverse complement of the stretch, as the reverse primer reads it. */
const rev = (name: string, from: number, to: number): AssemblyRead => ({
  name,
  sequence: reverseComplement(T.slice(from, to)),
  qualities: q(to - from),
});
const withPairs = (reads: readonly AssemblyRead[], insertSize: number | null) => {
  const { pairs } = findReadPairs(reads.map((r) => r.name));
  return { align, pairs, insertSize };
};
/** Where a read lies in the first contig, as `start-end+` or `start-end-`. */
const place = (out: Awaited<ReturnType<typeof assembleReads>>, name: string): string => {
  const r = out.contigs[0]?.reads.find((x) => x.name === name);
  return r === undefined ? 'absent' : `${r.start}-${r.end}${r.strand === 'forward' ? '+' : '-'}`;
};

describe('a mate says which copy of a repeat a read is in (#347)', () => {
  it(
    'puts a read from the second copy there when its mate is in the unique sequence after it',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 750, 850), rev('t_R', 1000, 1100)];
      // Without the pair the read is laid on the first copy, with a warning that it is ambiguous.
      const plain = await assembleReads(reads, { align });
      expect(place(plain, 't_F').startsWith('350-')).toBe(true);
      expect(plain.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['ambiguous-join']);
      expect(plain.pairing).toBeUndefined();
      // With it, at 750, no warning, and the pair is consistent at its insert size.
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(out.contigs).toHaveLength(1);
      expect(place(out, 't_F')).toBe('750-850+');
      expect(place(out, 't_R')).toBe('1000-1100-');
      expect(out.contigs[0]?.warnings).toEqual([]);
      expect(out.contigs[0]?.consensus).toBe(T);
      expect(out.pairing?.checks).toEqual([
        {
          pair: { first: 1, second: 2, stem: 't' },
          state: 'consistent',
          contig: 0,
          template: 350,
        },
      ]);
    },
    TIMEOUT,
  );

  it(
    'puts a read from the first copy there when its mate is in the unique sequence after it',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 350, 450), rev('t_R', 550, 650)];
      const out = await assembleReads(reads, withPairs(reads, 300));
      expect(place(out, 't_F')).toBe('350-450+');
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'does the same for a reverse read, whose mate is before it',
    async () => {
      // The reverse read lies in the second copy (750-850); its mate reads forward from the
      // unique stretch between the copies (500-600): a template of 350.
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 500, 600), rev('t_R', 750, 850)];
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(place(out, 't_R')).toBe('750-850-');
      expect(out.contigs[0]?.warnings).toEqual([]);
      // And the same read with the mate in the unique stretch before the first copy goes to the first.
      const first = [fwd('whole', 0, 1200), fwd('u_F', 100, 250), rev('u_R', 350, 450)];
      const out2 = await assembleReads(first, withPairs(first, 350));
      expect(place(out2, 'u_R')).toBe('350-450-');
      expect(out2.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'takes the mate at the first column of the layout, a read that hangs over the seed on the left',
    async () => {
      // m_F lies from 0 and the seed from 100, so m_F is at column 0 and its extent is still known:
      // the reverse read in the second copy (750-850) is a template of 850 from it, in the first
      // copy (350-450) one of 450.
      const reads = [fwd('whole', 100, 1200), fwd('m_F', 0, 300), rev('m_R', 750, 850)];
      const out = await assembleReads(reads, withPairs(reads, 850));
      expect(out.contigs).toHaveLength(1);
      expect(place(out, 'm_R')).toBe('750-850-');
      expect(out.contigs[0]?.warnings).toEqual([]);
      const first = await assembleReads(reads, withPairs(reads, 450));
      expect(place(first, 'm_R')).toBe('350-450-');
      expect(first.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'counts the mate from its first to its last base, to the base: an insert at the edge of the tolerance',
    async () => {
      // t_F in the second copy (750-850), its mate 1000-1100: a template of 350. A tolerance of
      // 100 takes an insert of 250 and of 450 and no other; a mate laid one base later or two
      // earlier falls outside, and then neither copy fits and the read is a guess.
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 750, 850), rev('t_R', 1000, 1100)];
      for (const insert of [250, 450]) {
        const out = await assembleReads(reads, withPairs(reads, insert));
        expect(place(out, 't_F'), `insert ${insert}`).toBe('750-850+');
        expect(out.contigs[0]?.warnings, `insert ${insert}`).toEqual([]);
      }
    },
    TIMEOUT,
  );

  it(
    'counts the bases a read hangs over where it fits, at the edge of the tolerance',
    async () => {
      // Two bases at one end of the read that are not the template's, which the alignment does
      // not take in; the read is still laid where its first or last base would fall.
      const other = (b: string): string => (b === 'A' ? 'C' : 'A');
      const junk = (from: number, count: number): string =>
        T.slice(from, from + count).replace(/./g, other);
      // A forward read from 750 with two bases before it: its extent starts at 750, with the
      // mate's 1100 a template of 350, 100 from an insert of 450 and no more.
      const lead: AssemblyRead = {
        name: 't_F',
        sequence: junk(748, 2) + T.slice(750, 850),
        qualities: q(102),
      };
      const reads = [fwd('whole', 0, 1200), lead, rev('t_R', 1000, 1100)];
      const a = await assembleReads(reads, withPairs(reads, 450));
      expect(place(a, 't_F').endsWith('+'), 'forward read').toBe(true);
      expect(a.contigs[0]?.warnings, 'forward read').toEqual([]);
      // A reverse read to 850 (as laid along the contig) with two bases after it; its mate
      // from 500, a template of 350 again.
      const tail: AssemblyRead = {
        name: 't_R',
        sequence: reverseComplement(T.slice(750, 850) + junk(850, 2)),
        qualities: q(102),
      };
      const back = [fwd('whole', 0, 1200), fwd('t_F', 500, 600), tail];
      const b = await assembleReads(back, withPairs(back, 450));
      expect(b.contigs[0]?.warnings, 'reverse read').toEqual([]);
      expect(b.contigs[0]?.reads.find((r) => r.name === 't_R')?.start, 'reverse read').toBe(750);
    },
    TIMEOUT,
  );

  it(
    'with no insert size, uses only which way the mates face, which these copies do not settle',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 750, 850), rev('t_R', 1000, 1100)];
      const out = await assembleReads(reads, withPairs(reads, null));
      expect(out.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['ambiguous-join']);
      expect(out.pairing?.insert).toBeNull();
    },
    TIMEOUT,
  );

  it(
    'with no insert size, tells an inverted copy by the mates facing away',
    async () => {
      // The copy of the repeat is inverted after U2: the read from it is the other strand.
      const inverted = U[0] + R + U[1] + reverseComplement(R) + U[2];
      const cut = (name: string, from: number, to: number, reverse: boolean): AssemblyRead => {
        const s = inverted.slice(from, to);
        return { name, sequence: reverse ? reverseComplement(s) : s, qualities: q(to - from) };
      };
      // The forward read lies in the inverted copy at 750-850, where it reads as the other
      // strand of the first copy; its mate is in U3, after it, facing it.
      const reads = [
        cut('whole', 0, 1200, false),
        cut('t_F', 750, 850, false),
        cut('t_R', 1000, 1100, true),
      ];
      const plain = await assembleReads(reads, { align });
      // The read fits both the inverted copy and the first copy (turned over); it is put
      // right either way, but without the mate it is a guess and says so.
      expect(plain.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['ambiguous-join']);
      const out = await assembleReads(reads, withPairs(reads, null));
      const t = out.contigs[0]?.reads.find((r) => r.name === 't_F');
      expect(t?.start).toBe(750);
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'does not change the result of reads with no pairs, nor with an empty list',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('inside', 350, 450), fwd('unique', 100, 250)];
      const plain = await assembleReads(reads, { align });
      const none = await assembleReads(reads, { align, pairs: [], insertSize: 350 });
      expect(none).toEqual(plain);
      expect(findReadPairs(reads.map((r) => r.name)).pairs).toEqual([]);
      const named = await assembleReads(reads, withPairs(reads, 350));
      expect(named).toEqual(plain);
    },
    TIMEOUT,
  );
});

/**
 * A construct of `copies` copies of one repeat of `repeat` bases, each followed by
 * `gap` bases of its own unique sequence, behind 300 unique bases (#419). Copy
 * `k` (0-based) starts at `300 + k * (repeat + gap)`.
 */
function repeated(copies: number, repeat: number, gap: number, seed: number) {
  const r = bases(repeat, seed);
  const parts = [bases(300, seed + 1)];
  for (let k = 0; k < copies; k++) parts.push(r, bases(gap, seed + 2 + k));
  const text = parts.join('');
  const start = (k: number): number => 300 + k * (repeat + gap);
  const cut = (name: string, from: number, to: number, reverse = false): AssemblyRead => {
    const part = text.slice(from, to);
    return {
      name,
      sequence: reverse ? reverseComplement(part) : part,
      qualities: q(to - from),
    };
  };
  return { text, start, cut };
}

describe('every other copy of a repeat is weighed against the mate (#419)', () => {
  /** Copy k of the repeat holds the forward read; the reverse mate is `after` bases past its start. */
  const scene = (copies: number, repeat: number, gap: number, seed: number) => {
    const t = repeated(copies, repeat, gap, seed);
    return { ...t, whole: t.cut('whole', 0, t.text.length) };
  };

  it(
    'finds the third of three copies when only that one is where the mate says',
    async () => {
      // Copies at 300, 700, 1100 (repeat 200, gap 200). The read is 100 bases inside the
      // third (1150-1250), its mate 1400-1500: a template of 350.
      const t = scene(3, 200, 200, 500);
      const reads = [t.whole, t.cut('t_F', 1150, 1250), t.cut('t_R', 1400, 1500, true)];
      const plain = await assembleReads(reads, { align });
      expect(plain.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['ambiguous-join']);
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(place(out, 't_F')).toBe('1150-1250+');
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'finds the third of four copies, and the second, when only that one fits',
    async () => {
      // Four copies at 300, 700, 1100, 1500; the mate lies after the third.
      const t = scene(4, 200, 200, 510);
      const reads = [t.whole, t.cut('t_F', 1150, 1250), t.cut('t_R', 1400, 1500, true)];
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(place(out, 't_F')).toBe('1150-1250+');
      expect(out.contigs[0]?.warnings).toEqual([]);
      // The same four copies, the mate after the second.
      const second = [t.whole, t.cut('s_F', 750, 850), t.cut('s_R', 1000, 1100, true)];
      const out2 = await assembleReads(second, withPairs(second, 350));
      expect(place(out2, 's_F')).toBe('750-850+');
      expect(out2.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'finds the third of three copies for a reverse read whose mate lies before it',
    async () => {
      const t = scene(3, 200, 200, 520);
      // The forward mate in the unique stretch before the third copy (900-1000), the
      // reverse read 1150-1250 in it: a template of 350.
      const reads = [t.whole, t.cut('t_F', 900, 1000), t.cut('t_R', 1150, 1250, true)];
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(place(out, 't_R')).toBe('1150-1250-');
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'keeps the ambiguity when two copies both fit the mate',
    async () => {
      // Copies 180 bases apart (repeat 120, gap 60) at 300, 480, 660. A read 10 bases into
      // the second copy (490-590) and the mate in the unique 780-840: templates of 530, 350
      // and 170 from the three copies, against an insert of 260 (160 to 360 allowed), so the
      // second and the third fit and the first does not.
      const t = scene(3, 120, 60, 530);
      const reads = [t.whole, t.cut('t_F', 490, 590), t.cut('t_R', 780, 840, true)];
      const plain = await assembleReads(reads, { align });
      const out = await assembleReads(reads, withPairs(reads, 260));
      // Not settled by the mate: where it goes, and the warning, are what they were without
      // one (the pair may then say it does not fit where the read was put).
      expect(place(out, 't_F')).toBe(place(plain, 't_F'));
      expect(out.contigs[0]?.warnings.map((w) => w.kind)).toContain('ambiguous-join');
      expect(out.contigs[0]?.warnings[0]).toEqual(plain.contigs[0]?.warnings[0]);
    },
    TIMEOUT,
  );

  it(
    'keeps the ambiguity when none of the copies fits the mate',
    async () => {
      const t = scene(4, 200, 200, 540);
      // Templates of 1450, 1050, 650 and 250 from the four copies, against an insert of 800
      // (700 to 900 allowed): none.
      const reads = [t.whole, t.cut('t_F', 350, 450), t.cut('t_R', 1700, 1800, true)];
      const plain = await assembleReads(reads, { align });
      const out = await assembleReads(reads, withPairs(reads, 800));
      expect(out.contigs[0]?.warnings.map((w) => w.kind)).toContain('ambiguous-join');
      expect(place(out, 't_F')).toBe(place(plain, 't_F'));
    },
    TIMEOUT,
  );
});

describe('pairs that do not fit the layout (item 130)', () => {
  it(
    'warns when mates are nearer than the insert, as when two copies of a repeat are laid on one',
    async () => {
      // The template runs 100 to 1160; its ends only meet through the repeat, so the contig has
      // them 660 apart.
      const reads = [fwd('p_F', 100, 480), rev('p_R', 800, 1160)];
      const out = await assembleReads(reads, withPairs(reads, 1060));
      expect(out.contigs).toHaveLength(1);
      const w = out.contigs[0]?.warnings.filter((x) => x.kind === 'pair-distance');
      expect(w).toHaveLength(1);
      expect(w?.[0]?.message).toMatch(/p_F and p_R are mates, but only 6\d\d bp apart/);
      expect(w?.[0]?.message).toMatch(/about 4\d\d bp between them may be missing/);
      expect(w?.[0]?.read).toBe(0);
      const check = out.pairing?.checks[0];
      expect(check?.state).toBe('too-short');
      expect(check?.template).toBe(out.contigs[0]?.consensus.length);
    },
    TIMEOUT,
  );

  it(
    'names the mates and the distance in every warning, whichever read is the leftmost of the contig',
    async () => {
      // An unpaired read at the left end, so neither mate is the contig's first read.
      const reads = [fwd('x', 0, 200), fwd('p_F', 100, 480), rev('p_R', 800, 1160)];
      const short = await assembleReads(reads, withPairs(reads, 1060));
      const tooShort = short.contigs[0]?.warnings.find((w) => w.kind === 'pair-distance');
      expect(tooShort).toMatchObject({ start: 100, end: 760, read: 1 });
      expect(tooShort?.message).toMatch(
        /^p_F and p_R are mates, but only 6\d\d bp apart here \(the insert is about 1,060 bp\): about 4\d\d bp between them/,
      );
      // Too far apart: the number is the template the contig has, not nothing.
      const long = await assembleReads(reads, withPairs(reads, 200));
      const tooLong = long.contigs[0]?.warnings.find((w) => w.kind === 'pair-distance');
      expect(tooLong?.message).toMatch(
        /^p_F and p_R are mates, but 6\d\d bp apart here \(the insert is about 200 bp\): the layout may hold/,
      );
      // Facing away, with the forward mate on the right.
      const away = [rev('w_R', 0, 300), fwd('w_F', 250, 550)];
      const out = await assembleReads(away, withPairs(away, 2000));
      expect(out.contigs[0]?.warnings[0]?.message).toBe(
        'w_F and w_R are mates, but face away from each other here (the insert is about 2,000 bp), so they are not the two ends of one template as laid out.',
      );
      expect(out.contigs[0]?.warnings[0]).toMatchObject({ start: 0, end: 550, read: 1 });
    },
    TIMEOUT,
  );

  it(
    'says nothing of distance with no insert size, and lists the distances to enter',
    async () => {
      const reads = [fwd('p_F', 100, 480), rev('p_R', 800, 1160)];
      const out = await assembleReads(reads, withPairs(reads, null));
      expect(out.contigs[0]?.warnings).toEqual([]);
      expect(out.pairing?.templates).toEqual([out.contigs[0]?.consensus.length]);
    },
    TIMEOUT,
  );

  it(
    'warns of mates too far apart for the insert, and flags every pair of an insert that is wrong',
    async () => {
      // Two pairs of one construct, true templates 500 (0-500) and 600 (300-900).
      const reads = [
        fwd('a_F', 0, 300),
        rev('a_R', 250, 500),
        fwd('b_F', 300, 600),
        rev('b_R', 650, 900),
        fwd('c', 450, 750),
      ];
      // 700 allows 100: the pair of 500 is off by 200, the pair of 600 by 100, which is in.
      const some = await assembleReads(reads, withPairs(reads, 700));
      expect(some.contigs).toHaveLength(1);
      expect(some.pairing?.checks.map((c) => c.state)).toEqual(['too-short', 'consistent']);
      expect(some.contigs[0]?.warnings.filter((w) => w.kind === 'pair-distance')).toHaveLength(1);
      const wrong = await assembleReads(reads, withPairs(reads, 1400));
      expect(wrong.pairing?.checks.map((c) => c.state)).toEqual(['too-short', 'too-short']);
      expect(wrong.contigs[0]?.warnings.filter((w) => w.kind === 'pair-distance')).toHaveLength(2);
      // With a smaller insert than the layout has, mates are too far apart.
      const small = await assembleReads(reads, withPairs(reads, 200));
      expect(small.pairing?.checks.map((c) => c.state)).toEqual(['too-long', 'too-long']);
      expect(small.contigs[0]?.warnings[0]?.message).toMatch(/hold a stretch twice/);
      // With none, the two distances are listed, shortest first.
      const bare = await assembleReads(reads, withPairs(reads, null));
      expect(bare.contigs[0]?.warnings).toEqual([]);
      expect(bare.pairing?.templates).toEqual([500, 600]);
    },
    TIMEOUT,
  );

  it(
    'warns when both mates read the same strand, with or without an insert size',
    async () => {
      const reads = [fwd('s_F', 0, 300), fwd('s_R', 200, 500)];
      for (const insert of [null, 500]) {
        const out = await assembleReads(reads, withPairs(reads, insert));
        expect(out.pairing?.checks[0]?.state).toBe('same-strand');
        const w = out.contigs[0]?.warnings[0];
        expect(w?.kind).toBe('pair-orientation');
        expect(w?.message).toMatch(/both read the same strand/);
        expect(w?.start).toBe(0);
        expect(w?.end).toBe(500);
      }
    },
    TIMEOUT,
  );

  it(
    'tells mates facing away from a template that goes round the ends of a circle',
    async () => {
      // w_F reads the reverse strand of 0-300 and w_R the forward strand of 250-550: they face away.
      const reads = [rev('w_F', 0, 300), fwd('w_R', 250, 550)];
      const none = await assembleReads(reads, withPairs(reads, null));
      expect(none.pairing?.checks[0]?.state).toBe('facing-away');
      expect(none.contigs[0]?.warnings).toEqual([]);
      // 550 round the contig's ends is 550 - 250 + 300 = 600: a circle of 550 with a template of 600.
      const circle = await assembleReads(reads, withPairs(reads, 600));
      expect(circle.pairing?.checks[0]).toMatchObject({ state: 'spans-ends', template: 600 });
      expect(circle.contigs[0]?.warnings).toEqual([]);
      // Any other insert: they face away and the contig says so.
      const other = await assembleReads(reads, withPairs(reads, 2000));
      expect(other.pairing?.checks[0]?.state).toBe('facing-away');
      expect(other.contigs[0]?.warnings[0]).toMatchObject({ kind: 'pair-orientation' });
      expect(other.contigs[0]?.warnings[0]?.message).toMatch(/face away from each other/);
    },
    TIMEOUT,
  );

  it(
    'finds a pair across the origin of a circular template whichever way the contig is laid',
    async () => {
      // A 1000 bp circle read linearly; the pair spans the origin: forward at 800-1000, reverse
      // reading back from 150, a template of 350.
      const C = bases(1000, 91);
      const piece = (name: string, from: number, to: number, reverse = false): AssemblyRead => {
        const s = C.slice(from, to);
        return { name, sequence: reverse ? reverseComplement(s) : s, qualities: q(to - from) };
      };
      const reads = [
        piece('a', 0, 400),
        piece('b', 300, 700),
        piece('c', 600, 1000),
        piece('o_F', 800, 1000),
        piece('o_R', 0, 150, true),
      ];
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(out.contigs).toHaveLength(1);
      expect(out.pairing?.checks[0]).toMatchObject({ state: 'spans-ends', template: 350 });
      expect(out.contigs[0]?.warnings).toEqual([]);
      // The same reads with a reverse read as the longest, which seeds the contig: it is laid
      // the other way round, and the pair spans the origin the same way.
      const mirrored = [...reads, piece('long', 0, 450, true)];
      const out2 = await assembleReads(mirrored, withPairs(mirrored, 350));
      expect(out2.contigs[0]?.reads.find((r) => r.name === 'long')?.strand).toBe('forward');
      expect(out2.contigs[0]?.reads.find((r) => r.name === 'o_F')?.strand).toBe('reverse');
      expect(out2.pairing?.checks[0]).toMatchObject({ state: 'spans-ends', template: 350 });
      expect(out2.contigs[0]?.warnings).toEqual([]);
      // The same loci read from the other strands are another template: the mates face each
      // other the long way round, 1000 bp apart, too far for an insert of 350 and right for 1000.
      const turned = reads.map((r) => ({
        ...r,
        sequence: reverseComplement(r.sequence),
        qualities: Array.from(r.qualities ?? []).reverse(),
      }));
      const far = await assembleReads(turned, withPairs(turned, 350));
      expect(far.pairing?.checks[0]?.state).toBe('too-long');
      const long = await assembleReads(turned, withPairs(turned, 1000));
      expect(long.pairing?.checks[0]).toMatchObject({ state: 'consistent', template: 1000 });
    },
    TIMEOUT,
  );

  it(
    'leaves a pair unplaced when one mate has nothing left after trimming',
    async () => {
      const poor: AssemblyRead = {
        name: 'm_R',
        sequence: reverseComplement(T.slice(500, 800)),
        qualities: q(300, 3),
      };
      const reads = [fwd('m_F', 0, 400), fwd('other', 300, 600), poor];
      const out = await assembleReads(reads, withPairs(reads, 800));
      expect(out.skipped.map((s) => s.name)).toEqual(['m_R']);
      expect(out.pairing?.checks).toEqual([
        {
          pair: { first: 0, second: 2, stem: 'm' },
          state: 'unplaced',
          contig: null,
          template: null,
        },
      ]);
      expect(out.contigs[0]?.warnings).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'links the contigs a pair falls in, and its gap is the stretch between them',
    async () => {
      const G = bases(2100, 55);
      const piece = (name: string, from: number, to: number, reverse = false): AssemblyRead => {
        const s = G.slice(from, to);
        return { name, sequence: reverse ? reverseComplement(s) : s, qualities: q(to - from) };
      };
      // Two contigs of 0-600 and 1500-2100 with the unsequenced 900 between; the pair is a
      // template of 1500 from 300 to 1800.
      const reads = [
        piece('x1', 0, 350),
        piece('k_F', 300, 600),
        piece('y1', 1500, 1850),
        piece('k_R', 1800 - 300, 1800, true),
        piece('y2', 1750, 2100),
      ];
      const out = await assembleReads(reads, withPairs(reads, 1500));
      expect(out.contigs).toHaveLength(2);
      expect(out.pairing?.checks[0]?.state).toBe('linked');
      expect(out.pairing?.links).toHaveLength(1);
      expect(out.pairing?.links[0]).toMatchObject({ pairs: 1, gap: 900 });
      // Without an insert size the contigs are still linked, with no gap.
      const bare = await assembleReads(reads, withPairs(reads, null));
      expect(bare.pairing?.links[0]).toMatchObject({ pairs: 1, gap: null });
    },
    TIMEOUT,
  );
});

describe('simulated Sanger pairs over a construct with a repeat (oracle-style)', () => {
  /**
   * Truth is known: where every read was cut from. A contig is faithful when
   * every read lies in it where it came from, all on one strand of the
   * construct (the contig's own orientation is free): the offset between a
   * read's place in the contig and its place in the construct is the same
   * for all of them, give or take a few bases for indels. A repeat laid on
   * one copy, or a read on the wrong copy, makes the offsets differ.
   */
  const faithful = (
    contig: {
      reads: readonly {
        index: number;
        start: number;
        strand: string;
        trimmed: { start: number; end: number };
      }[];
    },
    sims: readonly { sequence: string; truthStart: number; truthEnd: number; reverse: boolean }[],
  ): boolean => {
    const along: number[] = [];
    const against: number[] = [];
    for (const x of contig.reads) {
      const sim = sims[x.index];
      if (sim === undefined) return false;
      const n = sim.sequence.length;
      const turned = x.strand === 'reverse';
      // The read as laid along the contig: its first kept base.
      const k = turned ? n - x.trimmed.end : x.trimmed.start;
      // Laid on the construct's forward strand when turning it (or not) gives the construct's own.
      const sense = sim.reverse === turned;
      if (sense) along.push(sim.truthStart + k - x.start);
      else against.push(sim.truthEnd - 1 - k + x.start);
    }
    if (along.length > 0 && against.length > 0) return false;
    const offsets = along.length > 0 ? along : against;
    return Math.max(...offsets) - Math.min(...offsets) <= 25;
  };

  it(
    'warns of distance only on a contig that is not a stretch of the construct',
    async () => {
      let unfaithful = 0;
      let flagged = 0;
      let faithfulCount = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const r = rng(seed * 977);
        const a = randomBases(500, r);
        const b = randomBases(300, r);
        const c = randomBases(500, r);
        const rep = randomBases(400, r);
        const truth = a + rep + b + rep + c; // 2100
        const insert = 1000;
        const sims = [0, 350, 700, 1100].flatMap((s, i) => [
          simulateRead(`t${i}_F`, truth, s, genericQualities(500, CLEAN, r), false, r),
          simulateRead(`t${i}_R`, truth, s + insert, genericQualities(500, CLEAN, r), true, r),
        ]);
        const reads = sims.map((x) => ({
          name: x.name,
          sequence: x.sequence,
          qualities: x.qualities,
        }));
        const out = await assembleReads(reads, withPairs(reads, insert));
        for (const contig of out.contigs) {
          const warned = contig.warnings.some((w) => w.kind === 'pair-distance');
          expect(
            contig.warnings.some((w) => w.kind === 'pair-orientation'),
            `seed ${seed}: strands`,
          ).toBe(false);
          if (faithful(contig, sims)) {
            faithfulCount++;
            expect(warned, `seed ${seed}: a faithful contig is not warned`).toBe(false);
          } else {
            unfaithful++;
            if (warned) flagged++;
          }
        }
        // Every pair is judged, linked or unplaced: none is lost.
        expect(out.pairing?.checks).toHaveLength(4);
      }
      expect(faithfulCount).toBeGreaterThan(0);
      // Seeds 1-8: 14 contigs, 8 faithful, 6 not (a read on the wrong copy, or two copies on
      // one), of which the pairs flag the 2 that hold both mates of a pair laid apart wrongly
      // (item 130). The others have no pair wholly inside them, or one that fits by chance.
      expect(unfaithful).toBeGreaterThan(0);
      expect(flagged).toBeGreaterThan(0);
    },
    TIMEOUT * 3,
  );
});

describe('copies in a stretch the first alternative leaves on either side (mutation triage 1.24.0)', () => {
  const swap = (s: string, at: number): string =>
    s.slice(0, at) + (s[at] === 'A' ? 'C' : 'A') + s.slice(at + 1);

  it(
    'finds a copy left of the second-best copy when only that one is where the mate says',
    async () => {
      // Copies at 300, 700, 1100. The read is the exact third; the second differs from it by one
      // base and the first by two, so the second is the best copy in the stretch before the
      // third and the first is what is left of it (item 130, #419).
      const r = bases(200, 600);
      const copies = [swap(swap(r, 70), 120), swap(r, 90), r];
      const text = [
        bases(300, 601),
        copies[0],
        bases(200, 602),
        copies[1],
        bases(200, 603),
        copies[2],
        bases(300, 604),
      ].join('');
      const cut = (name: string, from: number, to: number, reverse = false): AssemblyRead => ({
        name,
        sequence: reverse ? reverseComplement(text.slice(from, to)) : text.slice(from, to),
        qualities: q(to - from),
      });
      // The read is in the third copy, its mate 350 bases on from where the same read would start
      // in the first: 1150 - 800 = 350 to 800, the mate at 600-700 after the first copy.
      const reads = [
        cut('whole', 0, text.length),
        cut('t_F', 1150, 1250),
        cut('t_R', 1150 - 800 + 250, 1150 - 800 + 350, true),
      ];
      const out = await assembleReads(reads, withPairs(reads, 350));
      expect(place(out, 't_F')).toBe('350-450+');
    },
    TIMEOUT,
  );
});
