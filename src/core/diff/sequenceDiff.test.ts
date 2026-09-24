import { expectWithin, itTimed } from '@/test/timing';
import { randomDna, randomInt, seededRandom } from '@/test/random';

import { type SequenceDiff, diffSequences, positionMapper } from './sequenceDiff';

/** The edit script read back as a compact string, e.g. "=3 +AC -T =4". */
function script(diff: SequenceDiff, a: string, b: string): string {
  return diff.ops
    .map((op) => {
      if (op.kind === 'equal') return `=${op.aEnd - op.aStart}`;
      if (op.kind === 'insert') return `+${b.slice(op.bStart, op.bEnd)}`;
      return `-${a.slice(op.aStart, op.aEnd)}`;
    })
    .join(' ');
}

/** Rebuilds both inputs from the script; every op must be accounted for. */
function replay(diff: SequenceDiff, a: string, b: string): { a: string; b: string } {
  let outA = '';
  let outB = '';
  let aAt = 0;
  let bAt = 0;
  for (const op of diff.ops) {
    expect(op.aStart).toBe(aAt);
    expect(op.bStart).toBe(bAt);
    if (op.kind !== 'insert') outA += a.slice(op.aStart, op.aEnd);
    if (op.kind !== 'delete') outB += b.slice(op.bStart, op.bEnd);
    aAt = op.aEnd;
    bAt = op.bEnd;
  }
  expect(aAt).toBe(a.length);
  expect(bAt).toBe(b.length);
  return { a: outA, b: outB };
}

describe('diffSequences', () => {
  it('reports one equal run for identical inputs', () => {
    const diff = diffSequences('ACGTACGT', 'ACGTACGT');
    expect(script(diff, 'ACGTACGT', 'ACGTACGT')).toBe('=8');
    expect(diff.coarse).toBe(false);
  });

  it('handles two empty inputs', () => {
    expect(diffSequences('', '').ops).toEqual([]);
  });

  it('finds a pure insertion', () => {
    const a = 'ACGTACGT';
    const b = 'ACGTTTTACGT';
    expect(script(diffSequences(a, b), a, b)).toBe('=4 +TTT =4');
  });

  it('finds a pure deletion', () => {
    const a = 'ACGTTTTACGT';
    const b = 'ACGTACGT';
    expect(script(diffSequences(a, b), a, b)).toBe('=4 -TTT =4');
  });

  it('finds a substitution as a delete next to an insert', () => {
    const a = 'ACGTACGT';
    const b = 'ACGTGCGT';
    const diff = diffSequences(a, b);
    expect(replay(diff, a, b)).toEqual({ a, b });
    expect(script(diff, a, b)).toMatch(/^=4 [-+][AG] [-+][AG] =3$/);
  });

  it('handles an input that grew from nothing', () => {
    const diff = diffSequences('', 'ACGT');
    expect(script(diff, '', 'ACGT')).toBe('+ACGT');
    expect(diffSequences('ACGT', '').ops.map((o) => o.kind)).toEqual(['delete']);
  });

  it('trims a shared prefix and suffix before the fill', () => {
    const a = `${'A'.repeat(500)}CCCC${'G'.repeat(500)}`;
    const b = `${'A'.repeat(500)}TT${'G'.repeat(500)}`;
    const diff = diffSequences(a, b, { maxEdits: 8 });
    expect(diff.coarse).toBe(false);
    expect(script(diff, a, b)).toBe('=500 -CCCC +TT =500');
  });

  it('separates two distant edits', () => {
    const a = `ACGT${'N'.repeat(40)}ACGT`;
    const b = `AGGT${'N'.repeat(40)}ACCT`;
    const diff = diffSequences(a, b);
    expect(replay(diff, a, b)).toEqual({ a, b });
    expect(diff.ops.filter((o) => o.kind !== 'equal')).toHaveLength(4);
  });

  it('falls back to one replacement past maxEdits', () => {
    const a = 'ACGT'.repeat(20);
    const b = 'TGCA'.repeat(20);
    const diff = diffSequences(a, b, { maxEdits: 4 });
    expect(diff.coarse).toBe(true);
    expect(diff.ops.map((o) => o.kind)).toEqual(['delete', 'insert']);
    expect(replay(diff, a, b)).toEqual({ a, b });
  });

  it('keeps the shared ends even when the middle is too different to follow', () => {
    const a = `GGGG${'ACGT'.repeat(20)}CCCC`;
    const b = `GGGG${'TGCA'.repeat(20)}CCCC`;
    const diff = diffSequences(a, b, { maxEdits: 4 });
    expect(diff.coarse).toBe(true);
    expect(diff.ops.map((o) => o.kind)).toEqual(['equal', 'delete', 'insert', 'equal']);
    expect(diff.ops[0]?.aEnd).toBe(4);
    expect(diff.ops[3]?.aStart).toBe(a.length - 4);
  });

  it('is minimal and consistent on random edits', () => {
    const rand = seededRandom(20260918);
    for (let trial = 0; trial < 60; trial++) {
      const a = randomDna(rand, randomInt(rand, 0, 120));
      let b = a;
      const edits = randomInt(rand, 1, 5);
      for (let i = 0; i < edits; i++) {
        const at = randomInt(rand, 0, b.length + 1);
        if (rand() < 0.5) b = b.slice(0, at) + randomDna(rand, randomInt(rand, 1, 6)) + b.slice(at);
        else b = b.slice(0, at) + b.slice(at + randomInt(rand, 1, 6));
      }
      const diff = diffSequences(a, b);
      expect(diff.coarse).toBe(false);
      expect(replay(diff, a, b)).toEqual({ a, b });
      // No two neighbouring runs of the same kind, and no empty run.
      diff.ops.forEach((op, i) => {
        expect(op.aEnd - op.aStart + (op.bEnd - op.bStart)).toBeGreaterThan(0);
        expect(op.kind).not.toBe(diff.ops[i - 1]?.kind);
      });
    }
  });
});

describe('positionMapper', () => {
  it('follows positions through an insertion', () => {
    const a = 'ACGTACGT';
    const b = 'ACGTTTTACGT';
    const map = positionMapper(diffSequences(a, b), a.length, b.length);
    expect(map(0)).toBe(0);
    expect(map(4)).toBe(7);
    expect(map(8)).toBe(11);
  });

  it('collapses deleted positions onto the boundary they left', () => {
    const a = 'ACGTTTTACGT';
    const b = 'ACGTACGT';
    const map = positionMapper(diffSequences(a, b), a.length, b.length);
    expect(map(4)).toBe(4);
    expect(map(5)).toBe(4);
    expect(map(6)).toBe(4);
    expect(map(7)).toBe(4);
    expect(map(8)).toBe(5);
    expect(map(11)).toBe(8);
  });
});

describe('diff performance', () => {
  /** A plasmid-sized session: scattered edits over pBR322's 4,361 bases. */
  function edited(a: string, hunks: number): string {
    const rand = seededRandom(7);
    let b = a;
    for (let i = 0; i < hunks; i++) {
      const at = randomInt(rand, 0, b.length);
      b = b.slice(0, at) + randomDna(rand, 6) + b.slice(at + 6);
    }
    return b;
  }

  itTimed(
    'diffs an edited plasmid fast enough to run on every keystroke',
    () => {
      const rand = seededRandom(1);
      const a = randomDna(rand, 4361);
      const b = edited(a, 20);
      const t0 = performance.now();
      const diff = diffSequences(a, b);
      const ms = performance.now() - t0;
      expect(diff.coarse).toBe(false);
      expect(replay(diff, a, b)).toEqual({ a, b });
      // A millisecond or two on a desktop; the bound only catches gross regressions.
      expectWithin(ms, 2000);
      // eslint-disable-next-line no-console
      console.info(`[perf] diff 4,361 bp with 20 edits: ${ms.toFixed(1)} ms`);
    },
    10_000,
  );

  itTimed(
    'follows a long session of scattered substitutions',
    () => {
      const rand = seededRandom(5);
      const a = randomDna(rand, 4361);
      const bases = a.split('');
      for (let i = 0; i < 500; i++) {
        const at = randomInt(rand, 0, bases.length);
        bases[at] = 'ACGT'.charAt(('ACGT'.indexOf(bases[at] ?? 'A') + 1) % 4);
      }
      const b = bases.join('');
      const t0 = performance.now();
      const diff = diffSequences(a, b);
      const ms = performance.now() - t0;
      expect(diff.coarse).toBe(false);
      expect(replay(diff, a, b)).toEqual({ a, b });
      expectWithin(ms, 4000);
      // eslint-disable-next-line no-console
      console.info(`[perf] diff 4,361 bp with 500 substitutions: ${ms.toFixed(1)} ms`);
    },
    10_000,
  );

  itTimed(
    'gives up quickly on two unrelated sequences of that size',
    () => {
      const a = randomDna(seededRandom(2), 4361);
      const b = randomDna(seededRandom(3), 4361);
      const t0 = performance.now();
      const diff = diffSequences(a, b);
      const ms = performance.now() - t0;
      expect(diff.coarse).toBe(true);
      expectWithin(ms, 2000);
      // eslint-disable-next-line no-console
      console.info(`[perf] diff of two unrelated 4,361 bp sequences: ${ms.toFixed(1)} ms`);
    },
    10_000,
  );
});

describe('large and scattered edits', () => {
  const rand = seededRandom(31);
  const a = randomDna(rand, 4361);

  it('describes a deletion longer than the step limit exactly', () => {
    const b = a.slice(0, 1000) + a.slice(2500);
    const diff = diffSequences(a, b, { maxEdits: 100 });
    expect(diff.coarse).toBe(false);
    expect(script(diff, a, b).replace(/-[ACGT]+/, '-…')).toBe('=1000 -… =1861');
  });

  it('describes a long insertion exactly', () => {
    const insert = randomDna(rand, 2000);
    const b = a.slice(0, 700) + insert + a.slice(700);
    const diff = diffSequences(a, b, { maxEdits: 100 });
    expect(diff.coarse).toBe(false);
    expect(diff.ops.map((o) => o.kind)).toEqual(['equal', 'insert', 'equal']);
  });

  it('splits on a shared run when one long edit hides another', () => {
    // A 1.2 kb deletion near the start and a single base typed near the end:
    // together far more steps than the limit, but each side of the plasmid
    // is easy once the diff splits on a run they share.
    const cut = a.slice(0, 200) + a.slice(1400);
    const b = `${cut.slice(0, 3000)}T${cut.slice(3000)}`;
    const diff = diffSequences(a, b, { maxEdits: 100 });
    expect(diff.coarse).toBe(false);
    expect(replay(diff, a, b)).toEqual({ a, b });
    const changes = diff.ops.filter((o) => o.kind !== 'equal');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ kind: 'delete', aStart: 200, aEnd: 1400 });
    expect(changes[1]).toMatchObject({ kind: 'insert', bStart: 3000, bEnd: 3001 });
  });

  it('will not split on a run that repeats', () => {
    const repeated = 'ACGT'.repeat(400);
    const other = 'TGCA'.repeat(400);
    const diff = diffSequences(repeated, other, { maxEdits: 20 });
    expect(diff.coarse).toBe(true);
  });
});

describe('work budget', () => {
  itTimed(
    'stops splitting once the splits have cost as much as the whole diff',
    () => {
      // Shared 32-mers between stretches that have nothing else in common:
      // every split lands on another hard problem. Without a budget the work
      // doubles at each level.
      const rand = seededRandom(77);
      const anchors = Array.from({ length: 16 }, () => randomDna(rand, 32));
      const build = (seed: number): string => {
        const r = seededRandom(seed);
        return anchors.map((anchor) => anchor + randomDna(r, 600)).join('');
      };
      const a = build(101);
      const b = build(202);
      const t0 = performance.now();
      const diff = diffSequences(a, b);
      const ms = performance.now() - t0;
      expect(replay(diff, a, b)).toEqual({ a, b });
      expect(diff.coarse).toBe(true);
      expectWithin(ms, 3000);
      // eslint-disable-next-line no-console
      console.info(
        `[perf] diff of 16 unrelated blocks between shared anchors: ${ms.toFixed(1)} ms`,
      );
    },
    10_000,
  );
});
