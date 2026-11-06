import fc from 'fast-check';

import { directRepeats } from './yeastAssembly';

/**
 * The direct-repeat search of `yeastAssembly.ts` (#411) against a naive oracle.
 *
 * `directRepeats` keys every window of a molecule in a map, pairs each with
 * the first later copy at least `k` away, and merges the pairs that follow
 * each other along one diagonal into one reported stretch. None of that is
 * visible from an example, so the same question is asked the slow way: for
 * every window, is there a later one with the same bases, far enough away,
 * that neither touches a blocked stretch? The windows the oracle names must be
 * exactly the windows the reported stretches cover, on a line and on a circle,
 * with the planted repeats and the blocked stretches placed anywhere.
 */

const K = 30;

interface Span {
  readonly start: number;
  readonly end: number;
}

function touches(p: number, blocked: readonly Span[], n: number, circular: boolean): boolean {
  return blocked.some(
    (s) => (p < s.end && p + K > s.start) || (circular && p < s.end + n && p + K > s.start + n),
  );
}

/** Every window start that has a later, distant copy, by comparing all pairs. */
function oracle(text: string, circular: boolean, blocked: readonly Span[]): number[] {
  const n = text.length;
  const reach = circular ? text + text.slice(0, K - 1) : text;
  const window = (p: number): string | null => {
    const w = reach.slice(p, p + K);
    return w.length === K && /^[ACGT]+$/.test(w) && !touches(p, blocked, n, circular) ? w : null;
  };
  const out: number[] = [];
  for (let p = 0; p < n; p++) {
    const w = window(p);
    if (w === null) continue;
    for (let q = p + K; q < n; q++) {
      if (circular && n - (q - p) < K) continue;
      if (window(q) === w) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

function covered(text: string, circular: boolean, blocked: readonly Span[]): number[] {
  const seen = new Set<number>();
  for (const r of directRepeats(text, circular, K, blocked)) {
    for (let p = r.a; p <= r.a + r.length - K; p++) seen.add(p);
  }
  return [...seen].sort((a, b) => a - b);
}

const base = fc.constantFrom('A', 'C', 'G', 'T');
const random = (min: number, max: number) =>
  fc.array(base, { minLength: min, maxLength: max }).map((a) => a.join(''));

/** Random bases with copies of earlier stretches laid in, some reversed, some with an N in. */
const molecule = fc
  .tuple(
    random(100, 260),
    fc.array(
      fc.record({
        from: fc.nat(1000),
        length: fc.integer({ min: 26, max: 70 }),
        at: fc.nat(1000),
        reverse: fc.boolean(),
        noisy: fc.boolean(),
      }),
      { maxLength: 4 },
    ),
  )
  .map(([text, plants]) => {
    let out = text;
    for (const p of plants) {
      const from = p.from % Math.max(1, out.length - p.length);
      let copy = out.slice(from, from + p.length);
      if (p.reverse) {
        copy = copy
          .split('')
          .reverse()
          .map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c] ?? c)
          .join('');
      }
      if (p.noisy) copy = `${copy.slice(0, 12)}N${copy.slice(13)}`;
      const at = p.at % Math.max(1, out.length - p.length);
      out = out.slice(0, at) + copy + out.slice(at + copy.length);
    }
    return out;
  });

const spans = (n: number) =>
  fc.array(
    fc
      .tuple(fc.nat(n), fc.integer({ min: 1, max: 60 }))
      .map(([start, length]): Span => ({ start, end: Math.min(n, start + length) })),
    { maxLength: 3 },
  );

describe('directRepeats against a naive oracle', () => {
  it('covers the windows with a distant later copy, no more and no fewer', () => {
    fc.assert(
      fc.property(
        molecule.chain((text) => fc.tuple(fc.constant(text), spans(text.length), fc.boolean())),
        ([text, blocked, circular]) => {
          expect(covered(text, circular, blocked)).toEqual(oracle(text, circular, blocked));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('plants that are only 29 bp never count; 30 always do, on a line', () => {
    const unit = fc.array(base, { minLength: 30, maxLength: 30 }).map((a) => a.join(''));
    fc.assert(
      fc.property(unit, random(40, 80), random(40, 80), (copy, left, right) => {
        // Glue that differs either side keeps the repeat exactly as long as asked.
        const text = `${left}A${copy}C${right}G${copy}T${left}`;
        const direct = directRepeats(text, false, 30, []).filter(
          (r) => r.a === left.length + 1 && r.length >= 30,
        );
        expect(direct.length).toBeGreaterThan(0);
        const short = `${left}A${copy.slice(0, 29)}C${right}G${copy.slice(0, 29)}T${right}`;
        expect(directRepeats(short, false, 30, []).some((r) => r.a === left.length + 1)).toBe(
          false,
        );
      }),
      { numRuns: 100 },
    );
  });
});
