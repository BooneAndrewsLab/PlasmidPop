import { describe, expect, it } from 'vitest';

import { randomBases, rng } from '@/test/oracle/sangerSim';

import { alignEitherStrand } from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { type AssemblyAlign, type AssemblyRead, assembleReads } from './assemble';
import {
  NO_PAIR_EDITS,
  type PairRule,
  applyPairEdits,
  describePairRule,
  findRulePairs,
  pairKey,
} from './pairing';

const align: AssemblyAlign = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));
const TIMEOUT = process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 60_000;

const bases = (n: number, seed: number): string => randomBases(n, rng(seed));
const U = [bases(300, 71), bases(200, 72), bases(300, 73)] as const;
const R = bases(200, 74);
const T = U[0] + R + U[1] + R + U[2];
const q = (n: number): number[] => new Array<number>(n).fill(40);
const fwd = (name: string, from: number, to: number): AssemblyRead => ({
  name,
  sequence: T.slice(from, to),
  qualities: q(to - from),
});
const rev = (name: string, from: number, to: number): AssemblyRead => ({
  name,
  sequence: reverseComplement(T.slice(from, to)),
  qualities: q(to - from),
});
const place = (out: Awaited<ReturnType<typeof assembleReads>>, name: string): string => {
  const r = out.contigs[0]?.reads.find((x) => x.name === name);
  return r === undefined ? 'absent' : `${r.start}-${r.end}${r.strand === 'forward' ? '+' : '-'}`;
};

describe('findRulePairs: the rule that made each pair (#421)', () => {
  it('names the rule of each kind of pair', () => {
    const { pairs } = findRulePairs([
      'a_F',
      'a_R',
      'M13F',
      'M13R',
      's_R1_001',
      's_R2_001',
      'h 1:N:0:AC',
      'h 2:N:0:AC',
    ]);
    expect(pairs.map((p) => p.rule)).toEqual(['separated', 'joined', 'illumina', 'casava']);
  });
});

describe('applyPairEdits (#421)', () => {
  const inferred = findRulePairs(['a_F', 'a_R', 'b_F', 'b_R']).pairs;

  it('leaves the inferred pairs alone with no edits', () => {
    expect(applyPairEdits(inferred, NO_PAIR_EDITS, 4)).toEqual(inferred);
  });

  it('turning pairing off removes every pair, manual ones too', () => {
    const edits = { enabled: false, broken: [], manual: [{ first: 0, second: 2 }] };
    expect(applyPairEdits(inferred, edits, 4)).toEqual([]);
  });

  it('breaks the pair asked for and no other', () => {
    const out = applyPairEdits(inferred, { ...NO_PAIR_EDITS, broken: [pairKey(inferred[0]!)] }, 4);
    expect(out.map((p) => p.stem)).toEqual(['b']);
  });

  it('honours a manual pair of differently named reads, and it displaces the pairs it takes a read from', () => {
    const out = applyPairEdits(
      inferred,
      { ...NO_PAIR_EDITS, manual: [{ first: 1, second: 2 }] },
      4,
    );
    expect(out).toEqual([{ first: 1, second: 2, stem: '', rule: 'manual' }]);
  });

  it('lets a later manual pair take a read from an earlier one', () => {
    const out = applyPairEdits(
      [],
      {
        ...NO_PAIR_EDITS,
        manual: [
          { first: 0, second: 1 },
          { first: 1, second: 2 },
        ],
      },
      4,
    );
    expect(out.map((p) => [p.first, p.second])).toEqual([[1, 2]]);
  });

  it('ignores a pair of a read with itself or with a read that is not there', () => {
    const edits = {
      ...NO_PAIR_EDITS,
      manual: [
        { first: 1, second: 1 },
        { first: 0, second: 9 },
        { first: -1, second: 0 },
        { first: 0.5, second: 1 },
      ],
    };
    expect(applyPairEdits([], edits, 4)).toEqual([]);
  });

  it('describes every rule', () => {
    const rules: (PairRule | undefined)[] = [
      'casava',
      'illumina',
      'separated',
      'joined',
      'manual',
      undefined,
    ];
    expect(new Set(rules.map((r) => describePairRule(r))).size).toBe(6);
  });
});

describe('edited pairs change what the assembly does (#421)', () => {
  it(
    'a wrongly inferred pair broken by hand changes the placement verdict',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 750, 850), rev('t_R', 1000, 1100)];
      const inferred = findRulePairs(reads.map((r) => r.name)).pairs;
      const kept = await assembleReads(reads, {
        align,
        pairs: applyPairEdits(inferred, NO_PAIR_EDITS, 3),
        insertSize: 350,
      });
      expect(place(kept, 't_F')).toBe('750-850+');
      expect(kept.pairing?.checks[0]?.state).toBe('consistent');
      const broken = await assembleReads(reads, {
        align,
        pairs: applyPairEdits(inferred, { ...NO_PAIR_EDITS, broken: ['1:2'] }, 3),
        insertSize: 350,
      });
      expect(place(broken, 't_F').startsWith('350-')).toBe(true);
      expect(broken.contigs[0]?.warnings.map((w) => w.kind)).toEqual(['ambiguous-join']);
      expect(broken.pairing).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    'a manual pair of differently named reads places the read as a named pair does',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('left', 750, 850), rev('right', 1000, 1100)];
      const none = findRulePairs(reads.map((r) => r.name)).pairs;
      expect(none).toEqual([]);
      const out = await assembleReads(reads, {
        align,
        pairs: applyPairEdits(none, { ...NO_PAIR_EDITS, manual: [{ first: 1, second: 2 }] }, 3),
        insertSize: 350,
      });
      expect(place(out, 'left')).toBe('750-850+');
      expect(out.pairing?.checks[0]?.state).toBe('consistent');
    },
    TIMEOUT,
  );

  it(
    'pairing off places as if there were no names to pair',
    async () => {
      const reads = [fwd('whole', 0, 1200), fwd('t_F', 750, 850), rev('t_R', 1000, 1100)];
      const inferred = findRulePairs(reads.map((r) => r.name)).pairs;
      const out = await assembleReads(reads, {
        align,
        pairs: applyPairEdits(inferred, { ...NO_PAIR_EDITS, enabled: false }, 3),
      });
      expect(out.pairing).toBeUndefined();
      expect(place(out, 't_F').startsWith('350-')).toBe(true);
    },
    TIMEOUT,
  );
});
