import fc from 'fast-check';

import {
  SeqDocument,
  createFeature,
  meltingTemperature,
  rangeSegment,
  reverseComplement,
  translate,
} from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import { digest } from './digest';
import { ligate } from './ligate';
import {
  type MutagenesisMethod,
  compareProteins,
  describeChange,
  designMutagenesis,
  quikChangeTm,
} from './mutagenesis';
import { pcr } from './pcr';

/**
 * Site-directed mutagenesis (#61) checked by doing what the bench does
 * rather than by reading the design back.
 *
 * The strongest check is the back-to-back one: for random circular plasmids
 * and random substitutions, deletions and insertions anywhere — right next to
 * the origin too, where the primers wrap it — the two primers are run through
 * `pcr` exactly as designed, the linear product is closed on itself with
 * `ligate` (KLD), and the circle that comes out must be `mutant`, from any
 * origin. `mutant` must also be the naive string splice of the change into
 * the template. The overlapping (QuikChange) design is checked for its rules
 * — complementary primers, the change in the middle, flanks balanced to
 * within a base and the shortest primer that reaches 78 °C — and
 * `quikChangeTm`, `describeChange` and `compareProteins` against oracles
 * written here. `proteinChanges` is checked on CDS features on both strands
 * against translating the mutant with `translate`.
 *
 * Templates come from a seeded mulberry32 (`@/test/random`): the old LCG's
 * bad seeds give repetitive sequence, where a primer is not unique and the
 * PCR has more than one product by the template's fault rather than the
 * design's. A design whose primers still prime twice is assumed away.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** Whether two circles are the same molecule, from any origin, case aside. */
function sameCircle(a: string, b: string): boolean {
  return a.length === b.length && (a + a).toUpperCase().includes(b.toUpperCase());
}

/** Template bases [from, to), wrapping on the circle. */
function wrapped(text: string, from: number, to: number): string {
  const L = text.length;
  let out = '';
  for (let i = from; i < to; i++) out += text.charAt(((i % L) + L) % L);
  return out;
}

/** The change spliced into the circle as a string: the oracle for `mutant`. */
function splice(text: string, start: number, end: number, inserted: string): string {
  const L = text.length;
  if (end <= L) return text.slice(0, start) + inserted + text.slice(end);
  // A range over the origin removes [start, L) and [0, end − L); what is left
  // reads on from end − L to start, then the new bases close the circle.
  return text.slice(end - L, start) + inserted;
}

/** KLD: amplify the whole plasmid, then close the linear product on itself. */
function kld(doc: SeqDocument, forward: string, reverse: string): string[] {
  const result = pcr(doc, [
    { name: 'F', sequence: forward },
    { name: 'R', sequence: reverse },
  ]);
  return result.products.map((product) => {
    const [whole] = digest(product.document, []);
    return ligate([must(whole, 'the whole product')], {
      name: 'closed',
      circular: true,
    }).sequence.toString();
  });
}

type EditKind = 'substitution' | 'deletion' | 'insertion';

interface Case {
  readonly text: string;
  readonly kind: EditKind;
  readonly start: number;
  readonly end: number;
  readonly inserted: string;
}

const dna = (min: number, max: number) =>
  fc
    .array(fc.constantFrom('A', 'C', 'G', 'T'), { minLength: min, maxLength: max })
    .map((a) => a.join(''));

/** Random plasmid, random edit, often within 60 bases of the origin. */
const caseArb: fc.Arbitrary<Case> = fc
  .record({
    seed: fc.integer({ min: 1, max: 0x7fffffff }),
    length: fc.integer({ min: 600, max: 3000 }),
    kind: fc.constantFrom<EditKind>('substitution', 'deletion', 'insertion'),
    nearOrigin: fc.boolean(),
    where: fc.integer({ min: 0, max: 1_000_000 }),
    removedDeletion: fc.integer({ min: 1, max: 60 }),
    substitution: dna(1, 6),
    insertion: dna(1, 40),
  })
  .map((r) => {
    const text = randomDna(seededRandom(r.seed), r.length).toLowerCase();
    const L = text.length;
    const start = r.nearOrigin
      ? r.where % 2 === 0
        ? r.where % 60
        : L - 1 - (r.where % 60)
      : r.where % L;
    if (r.kind === 'insertion')
      return { text, kind: r.kind, start, end: start, inserted: r.insertion };
    const removed = r.kind === 'deletion' ? r.removedDeletion : r.substitution.length;
    return {
      text,
      kind: r.kind,
      start,
      end: start + removed,
      inserted: r.kind === 'deletion' ? '' : r.substitution,
    };
  });

function plasmid(
  text: string,
  features: Parameters<typeof SeqDocument.create>[0]['features'] = [],
) {
  return SeqDocument.create({ name: 'pRand', sequence: text, topology: 'circular', features });
}

describe('back-to-back designs, run through the bench', () => {
  it('amplify and close into exactly the mutant, which is the naive splice', () => {
    let checked = 0;
    fc.assert(
      fc.property(caseArb, (c) => {
        const doc = plasmid(c.text);
        const d = designMutagenesis(
          doc,
          { start: c.start, end: c.end },
          c.inserted,
          'back-to-back',
        );
        const expected = splice(c.text, c.start, c.end, c.inserted);
        const mutant = d.mutant.sequence.toString();
        expect(d.mutant.isCircular).toBe(true);
        if (c.end <= c.text.length) expect(mutant).toBe(expected);
        else expect(sameCircle(mutant, expected)).toBe(true);
        expect(mutant).toBe(doc.apply(d.edit).sequence.toString());

        const closed = kld(doc, d.forward.sequence, d.reverse.sequence);
        // Something always amplifies; a template that happens to prime a
        // second time is the template's doing, and skipped.
        expect(closed.length).toBeGreaterThanOrEqual(1);
        fc.pre(closed.length === 1);
        expect(sameCircle(must(closed[0], 'a closed circle'), mutant)).toBe(true);
        checked++;
      }),
      { numRuns: 120 },
    );
    expect(checked).toBeGreaterThan(100);
  }, 15_000);

  it('put the new bases on the 5′ tails, split past 20, over template on the 3′ ends', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const doc = plasmid(c.text);
        const d = designMutagenesis(
          doc,
          { start: c.start, end: c.end },
          c.inserted,
          'back-to-back',
        );
        const split = c.inserted.length > 20 ? Math.floor(c.inserted.length / 2) : 0;
        const fTail = c.inserted.slice(split);
        const rTail = reverseComplement(c.inserted.slice(0, split));
        const f = d.forward;
        const r = d.reverse;
        expect(f.sequence).toBe(fTail + wrapped(c.text, c.end, c.end + f.annealLength));
        expect(r.sequence).toBe(
          rTail +
            reverseComplement(wrapped(c.text, c.start - r.annealLength, c.start)).toLowerCase(),
        );
        expect(f.tm).toBe(meltingTemperature(f.sequence.slice(fTail.length)));
        expect(r.tm).toBe(meltingTemperature(r.sequence.slice(rTail.length)));
        expect(f.annealLength).toBeGreaterThanOrEqual(15);
        expect(r.annealLength).toBeGreaterThanOrEqual(15);
        if (d.problem === null) {
          expect(f.tm).toBeGreaterThanOrEqual(60);
          expect(r.tm).toBeGreaterThanOrEqual(60);
          // Grown to the target and no further: a base shorter falls short.
          for (const p of [f, r]) {
            if (p.annealLength > 15) {
              const tail = p === f ? fTail : rTail;
              // Both grow at their 3′ ends, away from the change.
              const shorter = p.sequence.slice(tail.length, tail.length + p.annealLength - 1);
              expect(meltingTemperature(shorter)).toBeLessThan(60);
            }
          }
        } else {
          expect(Math.min(f.tm, r.tm)).toBeLessThan(60);
          expect(Math.max(f.annealLength, r.annealLength)).toBe(60);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('says so when the template beside the change is too AT-rich to reach 60 °C', () => {
    const at = 'at'.repeat(60);
    const text =
      randomDna(seededRandom(4), 800).toLowerCase() +
      at +
      randomDna(seededRandom(5), 800).toLowerCase();
    const doc = plasmid(text);
    const d = designMutagenesis(doc, { start: 860, end: 861 }, 'G', 'back-to-back');
    expect(d.problem).toMatch(/too AT-rich to reach 60 °C within 60 bases/);
    expect(d.forward.annealLength).toBe(60);
    expect(d.reverse.annealLength).toBe(60);
  });

  it('an insert whose last base continues the template before it still amplifies', () => {
    // The forward primer's tail then anneals a base further left, so its 5′
    // end overlaps the reverse primer's: the primers still point away from
    // each other, and the product is the whole circle and the overlap.
    const text = randomDna(seededRandom(11), 1200).toLowerCase();
    const doc = plasmid(text);
    for (let s = 1; s < 40; s++) {
      const inserted = `GGATCC${text.charAt(s - 1).toUpperCase()}`;
      const d = designMutagenesis(doc, { start: s, end: s }, inserted, 'back-to-back');
      const closed = kld(doc, d.forward.sequence, d.reverse.sequence);
      expect(closed).toHaveLength(1);
      expect(sameCircle(must(closed[0], 'a circle'), d.mutant.sequence.toString())).toBe(true);
    }
  });
});

describe('overlapping (QuikChange) designs', () => {
  it('are complementary, carry the change in the middle, balanced, and just reach 78 °C', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const doc = plasmid(c.text);
        const d = designMutagenesis(doc, { start: c.start, end: c.end }, c.inserted, 'overlapping');
        const f = d.forward.sequence;
        expect(d.reverse.sequence).toBe(reverseComplement(f));
        const left = d.reverse.annealLength;
        const right = d.forward.annealLength;
        expect(left - right === 0 || left - right === 1).toBe(true);
        expect(right).toBeGreaterThanOrEqual(10);
        expect(f).toBe(
          wrapped(c.text, c.start - left, c.start) +
            c.inserted +
            wrapped(c.text, c.end, c.end + right),
        );
        // The Tm is Agilent's formula over this primer, computed here.
        const removed = c.end - c.start;
        const same = removed === c.inserted.length;
        let differ = 0;
        if (same) {
          const old = wrapped(c.text, c.start, c.end).toUpperCase();
          for (let i = 0; i < old.length; i++) if (old.charAt(i) !== c.inserted.charAt(i)) differ++;
        }
        const indel = same ? 0 : c.inserted.length;
        const formula = (p: string) => {
          const gc = p.toUpperCase().replace(/[^GC]/g, '').length;
          return (
            81.5 +
            (41 * gc) / p.length -
            675 / (p.length - indel) -
            (indel > 0 ? 0 : (100 * differ) / p.length)
          );
        };
        expect(d.forward.tm).toBeCloseTo(formula(f), 9);
        expect(d.reverse.tm).toBe(d.forward.tm);
        if (d.problem === null) expect(d.forward.tm).toBeGreaterThanOrEqual(78);
        else expect(d.forward.tm).toBeLessThan(78);
        expect(f.length).toBeLessThanOrEqual(Math.max(60, 20 + c.inserted.length));
        // The shortest such primer: the one before the last base was added
        // fell short.
        if (left + right > 20) {
          const [pl, pr] = left > right ? [left - 1, right] : [left, right - 1];
          const shorter =
            wrapped(c.text, c.start - pl, c.start) +
            c.inserted +
            wrapped(c.text, c.end, c.end + pr);
          // By the function itself: the formula is checked above, and a
          // value on 78 exactly may round either way in the last bit.
          expect(quikChangeTm(shorter, differ, indel)).toBeLessThan(78);
        }
        // Whatever the primers, the plasmid is the same one.
        expect(
          sameCircle(d.mutant.sequence.toString(), splice(c.text, c.start, c.end, c.inserted)),
        ).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

describe('quikChangeTm', () => {
  it('is 81.5 + 0.41·%GC − 675/N − %mismatch, N less any indel, for random primers', () => {
    fc.assert(
      fc.property(
        dna(1, 70),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 40 }),
        fc.boolean(),
        (primer, mismatched, indel, lower) => {
          const p = lower ? primer.toLowerCase() : primer;
          const got = quikChangeTm(p, mismatched, indel);
          const n = primer.length - indel;
          if (n <= 0) {
            expect(got).toBeNaN();
            return;
          }
          let gc = 0;
          for (const b of primer) if (b === 'G' || b === 'C') gc++;
          const pct = (100 * gc) / primer.length;
          const mismatch = indel > 0 ? 0 : (100 * mismatched) / primer.length;
          expect(got).toBeCloseTo(81.5 + 0.41 * pct - 675 / n - mismatch, 9);
        },
      ),
      { numRuns: 500 },
    );
  });
});

/** Thousands separators, as `toLocaleString` writes them in the test locale. */
function commas(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

describe('describeChange', () => {
  it('names every kind of change, 1-based, for every small case', () => {
    const template = 'acgtTGCAacgtaacc';
    for (let start = 0; start <= template.length; start++) {
      for (let end = start; end <= Math.min(template.length, start + 4); end++) {
        for (const inserted of ['', 'G', 'TT', 'GGC']) {
          const got = describeChange(template, { start, end }, inserted);
          const old = template.slice(start, end).toUpperCase();
          let want: string;
          if (end === start) want = `+${inserted} after ${start}`;
          else {
            const span = end - start === 1 ? `${start + 1}` : `${start + 1}–${end}`;
            want = inserted === '' ? `Δ${span}` : `${old}${span}${inserted}`;
          }
          expect(got).toBe(want);
        }
      }
    }
  });

  it('writes thousands with separators', () => {
    const long = 'a'.repeat(12_345);
    expect(describeChange(long, { start: 12_000, end: 12_000 }, 'C')).toBe(
      `+C after ${commas(12_000)}`,
    );
    expect(describeChange(long, { start: 999, end: 1_001 }, '')).toBe(
      `Δ${commas(1_000)}–${commas(1_001)}`,
    );
    expect(describeChange(long, { start: 9_999, end: 10_000 }, 'G')).toBe(`A${commas(10_000)}G`);
  });
});

const AMINO: readonly string[] = 'ACDEFGHIKLMNPQRSTVWY*'.split('');
const protein = (min: number, max: number) =>
  fc.array(fc.constantFrom(...AMINO), { minLength: min, maxLength: max }).map((a) => a.join(''));

/** The brute-force reading of what `compareProteins` should say. */
function oracle(before: string, after: string, frameshift: boolean): string {
  if (before === after) return 'no change (silent)';
  let head = 0;
  for (let h = 0; h <= Math.min(before.length, after.length); h++) {
    if (before.slice(0, h) === after.slice(0, h)) head = h;
  }
  let tail = 0;
  for (let t = 0; t <= Math.min(before.length, after.length) - head; t++) {
    if (before.slice(before.length - t) === after.slice(after.length - t)) tail = t;
  }
  if (frameshift) return `frameshift from ${before.charAt(head)}${head + 1}`;
  const was = before.slice(head, before.length - tail);
  const now = after.slice(head, after.length - tail);
  if (was.length === now.length && was.length <= 3) {
    const out: string[] = [];
    for (let i = 0; i < was.length; i++) {
      if (was.charAt(i) !== now.charAt(i))
        out.push(`${was.charAt(i)}${head + i + 1}${now.charAt(i)}`);
    }
    return out.join(', ');
  }
  const where = was.length <= 1 ? `${head + 1}` : `${head + 1}–${head + was.length}`;
  return `${where} ${was === '' ? '(none)' : was} → ${now === '' ? '(none)' : now}`;
}

/** Rebuilds the mutant protein from what `compareProteins` says was done. */
function replay(before: string, said: string): string {
  const subs = /^([A-Z*])(\d+)([A-Z*])$/;
  const parts = said.split(', ');
  if (parts.every((p) => subs.test(p))) {
    const out = before.split('');
    for (const p of parts) {
      const m = must(subs.exec(p), 'a substitution');
      const at = Number(m[2]) - 1;
      expect(out[at]).toBe(m[1]);
      out[at] = must(m[3], 'a residue');
    }
    return out.join('');
  }
  const m = must(/^(\d+)(?:–(\d+))? (\S+) → (\S+)$/.exec(said), `a replacement in "${said}"`);
  const from = Number(m[1]) - 1;
  const was = m[3] === '(none)' ? '' : must(m[3], 'was');
  const now = m[4] === '(none)' ? '' : must(m[4], 'now');
  expect(before.slice(from, from + was.length)).toBe(was);
  return before.slice(0, from) + now + before.slice(from + was.length);
}

describe('compareProteins', () => {
  it('matches the brute-force oracle, and says enough to rebuild the mutant', () => {
    const edited = fc
      .tuple(
        protein(0, 30),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 6 }),
        protein(0, 6),
      )
      .map(([p, at, cut, put]) => {
        const i = Math.min(at, p.length);
        return [p, p.slice(0, i) + put + p.slice(i + cut)] as const;
      });
    fc.assert(
      fc.property(fc.oneof(edited, fc.tuple(protein(0, 12), protein(0, 12))), ([before, after]) => {
        const said = compareProteins(before, after);
        expect(said).toBe(oracle(before, after, false));
        if (before !== after) expect(replay(before, said)).toBe(after);
        expect(compareProteins(before, after, true)).toBe(oracle(before, after, true));
      }),
      { numRuns: 800 },
    );
  });

  it('lists up to three substitutions, and falls back to a span past that', () => {
    expect(compareProteins('MKEF*', 'MKEF*')).toBe('no change (silent)');
    expect(compareProteins('MKEF*', 'MKEF*', true)).toBe('no change (silent)');
    expect(compareProteins('MKEF*', 'MREF*')).toBe('K2R');
    expect(compareProteins('MKEF*', 'MRDF*')).toBe('K2R, E3D');
    expect(compareProteins('MKEF*', 'MRED*')).toBe('K2R, F4D');
    expect(compareProteins('MKEFG*', 'MRDYG*')).toBe('K2R, E3D, F4Y');
    expect(compareProteins('MKEFGH*', 'MRDYAH*')).toBe('2–5 KEFG → RDYA');
    expect(compareProteins('MKEF*', 'MK*')).toBe('3–4 EF → (none)');
    expect(compareProteins('MKF*', 'MKEF*')).toBe('3 (none) → E');
    expect(compareProteins('MKEF*', 'MKE*F*')).toBe('4 (none) → *');
    expect(compareProteins('MKEF*', 'MKEF*', false)).toBe('no change (silent)');
    expect(compareProteins('MKEF*', 'MKGL', true)).toBe('frameshift from E3');
    expect(compareProteins('MK', 'MKEF', true)).toBe('frameshift from 3');
  });
});

/** Codons with no stop, so a random CDS reads through to its own stop. */
const SENSE: readonly string[] = (() => {
  const out: string[] = [];
  for (const a of 'ACGT')
    for (const b of 'ACGT')
      for (const c of 'ACGT') {
        const codon = a + b + c;
        if (!['TAA', 'TAG', 'TGA'].includes(codon)) out.push(codon);
      }
  return out;
})();

type CdsEdit = 'substitute' | 'delete-codon' | 'insert-codon' | 'frameshift';

describe('proteinChanges', () => {
  it('says what translating the mutant CDS says, on either strand', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.array(fc.constantFrom(...SENSE), { minLength: 8, maxLength: 40 }),
        fc.constantFrom<'forward' | 'reverse'>('forward', 'reverse'),
        fc.constantFrom<CdsEdit>('substitute', 'delete-codon', 'insert-codon', 'frameshift'),
        fc.integer({ min: 0, max: 1_000_000 }),
        dna(1, 3),
        fc.constantFrom<MutagenesisMethod>('back-to-back', 'overlapping'),
        (seed, codons, strand, kind, where, bases, method) => {
          const coding = `ATG${codons.join('')}TAA`;
          const onTop = strand === 'forward' ? coding : reverseComplement(coding);
          const flank = randomDna(seededRandom(seed), 900).toLowerCase();
          const start = 400;
          const end = start + onTop.length;
          const text = flank.slice(0, start) + onTop + flank.slice(start);
          const doc = plasmid(text, [
            createFeature({
              type: 'CDS',
              name: 'orf',
              strand,
              segments: [rangeSegment(start, end)],
            }),
          ]);
          // An edit strictly inside the feature, so the feature keeps its ends.
          const inner = onTop.length - 8;
          const at = start + 3 + (where % inner);
          let range: { start: number; end: number };
          let inserted: string;
          switch (kind) {
            case 'substitute':
              range = { start: at, end: at + bases.length };
              inserted = bases;
              break;
            case 'delete-codon':
              range = { start: at, end: at + 3 };
              inserted = '';
              break;
            case 'insert-codon':
              range = { start: at, end: at };
              inserted = (bases + 'GCA').slice(0, 3);
              break;
            case 'frameshift':
              range = { start: at, end: at + 1 };
              inserted = '';
              break;
          }
          const d = designMutagenesis(doc, range, inserted, method);
          const delta = inserted.length - (range.end - range.start);
          const read = (t: string, len: number): string => {
            const top = t.slice(start, start + len);
            return translate(strand === 'forward' ? top : reverseComplement(top), {
              firstCodonAsMet: true,
            });
          };
          const before = read(text, onTop.length);
          const after = read(d.mutant.sequence.toString(), onTop.length + delta);
          expect(before).toBe(translate(coding));
          expect(d.proteinChanges).toEqual([
            `orf ${compareProteins(before, after, delta % 3 !== 0)}`,
          ]);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reports nothing for a change outside every CDS or across its end', () => {
    const coding = `ATG${'GCA'.repeat(10)}TAA`;
    const text =
      randomDna(seededRandom(3), 400).toLowerCase() +
      coding +
      randomDna(seededRandom(8), 400).toLowerCase();
    const doc = plasmid(text, [
      createFeature({
        type: 'CDS',
        name: 'orf',
        segments: [rangeSegment(400, 400 + coding.length)],
      }),
      createFeature({ type: 'gene', name: 'notCoding', segments: [rangeSegment(100, 200)] }),
    ]);
    expect(
      designMutagenesis(doc, { start: 150, end: 151 }, 'G', 'back-to-back').proteinChanges,
    ).toEqual([]);
    expect(
      designMutagenesis(doc, { start: 398, end: 402 }, '', 'back-to-back').proteinChanges,
    ).toEqual([]);
    expect(
      designMutagenesis(doc, { start: 403, end: 403 }, 'GGC', 'back-to-back').proteinChanges,
    ).toEqual(['orf 2 (none) → G']);
    // A nameless CDS is called CDS.
    const bare = plasmid(text, [
      createFeature({ type: 'CDS', segments: [rangeSegment(400, 400 + coding.length)] }),
    ]);
    expect(
      designMutagenesis(bare, { start: 404, end: 405 }, 'T', 'overlapping').proteinChanges,
    ).toEqual(['CDS A2V']);
  });

  it('reads a CDS that runs over the origin of the plasmid', () => {
    const coding = `ATG${'GCAAAG'.repeat(10)}TAA`;
    const body = randomDna(seededRandom(21), 900).toLowerCase();
    // The CDS starts 30 bases before the origin and ends past it.
    const text = coding.slice(30) + body + coding.slice(0, 30);
    const L = text.length;
    const doc = plasmid(text, [
      createFeature({
        type: 'CDS',
        name: 'orf',
        segments: [rangeSegment(L - 30, L - 30 + coding.length)],
      }),
    ]);
    // Codon 2 (GCA) sits before the origin; codon 13 (AAG) after it.
    expect(
      designMutagenesis(doc, { start: L - 26, end: L - 25 }, 'T', 'back-to-back').proteinChanges,
    ).toEqual(['orf A2V']);
    expect(
      designMutagenesis(doc, { start: 7, end: 8 }, 'T', 'back-to-back').proteinChanges,
    ).toEqual(['orf K13M']);
  });
});
