import { writeFileSync } from 'node:fs';
import { DEFAULT_PRIMER_CRITERIA as C } from '@/core/primers/criteria';
import { designPrimers } from '@/core/primers/primerDesign';
import { meltingTemperature } from '@/core/primers/thermo';

import oracle from './primerPairs.json';

/**
 * Selected primer pairs against Primer3 (scripts/oracle/primerpairs.py, item
 * 122, issue #337). 40 seeded synthetic templates, each with a target; our
 * designer's top five pairs for each (200) were handed to primer3-py
 * design_primers with settings matching our defaults, which says whether
 * Primer3 would accept the pair and at what penalty; Primer3's own top five
 * pairs are recorded beside them. The gate is loose, set just under what was
 * measured. Nothing here says which of the two is right.
 */

type Site = readonly [number, number];
interface Verdict {
  readonly passes: boolean;
  readonly penalty?: number;
  readonly leftTm: number;
  readonly rightTm: number;
  readonly leftGc: number;
  readonly rightGc: number;
  readonly explain?: { readonly left: string; readonly right: string; readonly pair: string };
}
interface OurPair {
  readonly fwd: string;
  readonly rev: string;
  readonly left: Site;
  readonly right: Site;
  readonly penalty: number;
  readonly primer3: Verdict;
}
interface Template {
  readonly name: string;
  readonly seq: string;
  readonly target: Site;
  readonly primer3: { readonly pairs: readonly { left: Site; right: Site; penalty: number }[] };
  readonly ours: readonly OurPair[];
}

const templates = oracle.templates as unknown as readonly Template[];
const all = templates.flatMap((t) => t.ours.map((o) => ({ t, o })));

function design(t: Template) {
  return designPrimers(t.seq, 'linear', { start: t.target[0], end: t.target[1] }, { maxPairs: 5 });
}

const overlaps = (a: Site, b: Site): boolean => Math.min(a[1], b[1]) > Math.max(a[0], b[0]);
const same = (a: Site, b: Site): boolean => a[0] === b[0] && a[1] === b[1];

describe('selected primer pairs against primer3-py', () => {
  // Writes the pairs primerpairs.py hands to Primer3: `scripts/oracle/run.sh primer-pairs`.
  it.skipIf(process.env['ORACLE_EXPORT_PAIRS'] === undefined)(
    'exports our pairs',
    () => {
      const out = templates.map((t) => ({
        name: t.name,
        pairs: design(t).map((p) => ({
          fwd: p.forward.sequence,
          rev: p.reverse.sequence,
          left: [p.forwardSite.start, p.forwardSite.end],
          right: [p.reverseSite.start, p.reverseSite.end],
          penalty: Math.round(p.penalty * 1000) / 1000,
        })),
      }));
      writeFileSync(
        new URL('./primerPairsOurs.json', import.meta.url),
        JSON.stringify({ templates: out }, null, 1) + '\n',
      );
    },
    120_000,
  );

  it('has the dataset the floors were measured on', () => {
    expect(templates).toHaveLength(40);
    expect(all).toHaveLength(200);
    for (const t of templates) expect(t.primer3.pairs.length).toBeGreaterThan(0);
  });

  it('the designer still selects the pairs that were sent to Primer3', () => {
    // A sample, to keep the run short; run.sh primer-pairs regenerates all.
    for (const t of templates.slice(0, 8)) {
      const now = design(t).map((p) => [
        p.forward.sequence,
        p.reverse.sequence,
        p.forwardSite.start,
        p.forwardSite.end,
        p.reverseSite.start,
        p.reverseSite.end,
      ]);
      const then = t.ours.map((o) => [o.fwd, o.rev, ...o.left, ...o.right]);
      expect(now, `${t.name}: run scripts/oracle/run.sh primer-pairs`).toEqual(then);
    }
  }, 60_000);

  it('Tm and GC: at least 95 % of our pairs meet the criteria by Primer3 numbers', () => {
    const ok = all.filter(({ o }) => {
      const v = o.primer3;
      return (
        [v.leftTm, v.rightTm].every((tm) => tm >= C.minTm && tm <= C.maxTm) &&
        Math.abs(v.leftTm - v.rightTm) <= C.maxTmDifference &&
        [v.leftGc, v.rightGc].every((gc) => gc >= C.minGc * 100 && gc <= C.maxGc * 100)
      );
    });
    expect(ok.length / all.length).toBeGreaterThanOrEqual(0.95); // measured 100 %
  });

  it('our Tm is Primer3 Tm', () => {
    for (const { o } of all) {
      expect(Math.abs(meltingTemperature(o.fwd) - o.primer3.leftTm)).toBeLessThan(0.05);
      expect(Math.abs(meltingTemperature(o.rev) - o.primer3.rightTm)).toBeLessThan(0.05);
    }
  });

  it("Primer3's own verdict: at least 95 % of our pairs are accepted outright", () => {
    const accepted = all.filter(({ o }) => o.primer3.passes).length;
    // Measured 191 of 200 = 95.5 % (181 before the hairpin-Tm criterion, item
    // 125; 177 before the ΔG hairpin check, item 124).
    expect(accepted / all.length).toBeGreaterThanOrEqual(0.95);
    // What is left of #345: a hairpin Primer3 finds too stable by its own
    // criterion, the Tm of the structure (at most 47 C), that our estimate
    // misses (tri- and tetraloop and wobble stabilisation we do not model).
    const refused = all.filter(({ o }) => !o.primer3.passes);
    expect(refused.length).toBeLessThanOrEqual(9);
    for (const { o } of refused) {
      const e = o.primer3.explain;
      const reasons = [e?.left, e?.right, e?.pair].join(' ');
      expect(reasons).toContain('high hairpin stability');
      expect(reasons).not.toMatch(/low tm|high tm|gc content|poly|too many|size/i);
    }
  });

  it('top pair against Primer3 top pair: overlap holds the measured floor', () => {
    // Known deviation #346 (unchanged by item 123: 0, 7 and 18 of 40): the two rank differently.
    let equal = 0;
    let overlap = 0;
    let anyOverlap = 0;
    for (const t of templates) {
      const top = t.ours[0];
      const p3 = t.primer3.pairs[0];
      if (top === undefined || p3 === undefined) continue;
      if (same(top.left, p3.left) && same(top.right, p3.right)) equal++;
      if (overlaps(top.left, p3.left) && overlaps(top.right, p3.right)) overlap++;
      if (
        t.ours.some((o) =>
          t.primer3.pairs.some((p) => overlaps(o.left, p.left) && overlaps(o.right, p.right)),
        )
      ) {
        anyOverlap++;
      }
    }
    // Equal pairs: measured 0 of 40, so there is no floor to hold (`equal` is reported in item 122).
    expect(equal).toBeLessThanOrEqual(overlap);
    expect(overlap).toBeGreaterThanOrEqual(5); // measured 7 of 40
    expect(anyOverlap).toBeGreaterThanOrEqual(15); // measured 18 of 40
  });
});
