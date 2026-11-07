import {
  type Feature,
  type GibsonWarning,
  SeqDocument,
  YEAST_OVERLAP,
  clampYeastOverlap,
  createFeature,
  describeLineageStep,
  designOverlapPrimers,
  gibson,
  lineageOf,
  buildProtocol,
  rangeSegment,
  recordGibson,
  recordOverlapDesign,
  reverseComplement,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { directRepeats, yeastAssembly, yeastWarnings } from './yeastAssembly';

/**
 * Assembly in yeast by homologous recombination (#411): `gibson()` with the
 * `yeast` kit, and what `yeastWarnings` says of what it makes.
 *
 * The parts are built from the bases of the junctions and the bodies between
 * them, so every junction's length, GC and repeats are the ones a test asks
 * for and nothing else in the tube shares a stretch of 15 bases with it.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** A fixed pseudo-random template: no repeat in it but the ones planted. */
function template(length: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/** `length` bases with exactly `gc` of them G or C, in a fixed shuffled order. */
function withGc(length: number, gc: number, seed: number): string {
  const bases = [
    ...template(gc, seed).replace(/[AT]/g, 'G').replace(/[^GC]/g, 'C').split(''),
    ...template(length - gc, seed + 1)
      .replace(/[CG]/g, 'A')
      .replace(/[^AT]/g, 'T')
      .split(''),
  ];
  let x = seed >>> 0;
  for (let i = bases.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const j = (x >> 8) % (i + 1);
    [bases[i], bases[j]] = [bases[j] ?? '', bases[i] ?? ''];
  }
  return bases.join('');
}

function gcCount(text: string): number {
  return text.split('').filter((c) => c === 'G' || c === 'C').length;
}

/** `text` with `copy` laid over it at `at`, and the bases either side of it made to differ from `before`/`after`. */
function plant(text: string, at: number, copy: string, before: string, after: string): string {
  const other = (c: string): string => (c === 'A' ? 'C' : 'A');
  const left = other(before);
  const right = other(after);
  return text.slice(0, at - 1) + left + copy + right + text.slice(at + copy.length + 1);
}

/** Where a test's marker and origin features sit in the vector's body (offsets into the body). */
const VECTOR_FEATURES: readonly (readonly [string, string, number, number])[] = [
  ['CDS', 'URA3', 10, 260],
  ['centromere', 'CEN6', 270, 360],
  ['rep_origin', 'pUC ori', 365, 435],
  ['CDS', 'AmpR', 440, 490],
];

function feature(type: string, name: string, start: number, end: number): Feature {
  return createFeature({ type, name, segments: [rangeSegment(start, end)] });
}

interface Ring {
  readonly parts: SeqDocument[];
  readonly junctions: readonly string[];
  readonly bodies: readonly string[];
}

/**
 * A circle cut into parts at its junctions: part `i` is the junction before
 * it, its own body and the junction after it, so the junctions are exactly
 * the homology the parts share. Part 0 is the vector.
 */
function ring(
  junctions: readonly string[],
  options: {
    readonly bodies?: readonly string[];
    readonly features?: readonly (readonly Feature[])[];
    readonly names?: readonly string[];
  } = {},
): Ring {
  const n = junctions.length;
  const bodies = options.bodies ?? junctions.map((_, i) => template(500, 700 + i));
  const parts = junctions.map((after, i) => {
    const before = junctions[(i + n - 1) % n] ?? '';
    const lead = before.length;
    return SeqDocument.create({
      name: options.names?.[i] ?? (i === 0 ? 'vector' : `insert${i}`),
      sequence: before + (bodies[i] ?? '') + after,
      features: (options.features?.[i] ?? []).map((f) => shifted(f, lead)),
    });
  });
  return { parts, junctions, bodies };
}

function shifted(f: Feature, by: number): Feature {
  return createFeature({
    type: f.type,
    name: f.name,
    segments: f.segments.map((s) =>
      s.kind === 'range' ? rangeSegment(s.start + by, s.end + by) : s,
    ),
  });
}

const THREE = [template(40, 101), template(40, 102), template(40, 103)];

function vectorFeatures(): Feature[] {
  return VECTOR_FEATURES.map(([type, name, s, e]) => feature(type, name, s, e));
}

/** The three-part ring a good assembly is: markers and origins on the vector, 40 bp junctions. */
function good(): Ring {
  return ring(THREE, { features: [vectorFeatures()] });
}

function run(parts: readonly SeqDocument[], options: Parameters<typeof yeastAssembly>[1] = {}) {
  const result = yeastAssembly(parts, options);
  return { result, assembly: must(result.assembly, `an assembly (${result.problem ?? ''})`) };
}

function kinds(warnings: readonly GibsonWarning[]): string[] {
  return [...new Set(warnings.map((w) => w.kind))];
}

describe('the yeast kit of gibson()', () => {
  it('defaults to 40 bp of homology and holds a request to 20-80', () => {
    expect(YEAST_OVERLAP).toEqual({ min: 20, default: 40, max: 80, floor: 30 });
    const at = (n: number) => ring([template(n, 31), template(n, 32)]).parts;
    // 35 bp is under the default of 40: no part follows another.
    expect(gibson(at(35), { kit: 'yeast' }).problem).toMatch(/Nothing follows/);
    expect(gibson(at(40), { kit: 'yeast' }).problem).toBeNull();
    // Asked for 5, it is 20: a junction of 19 is not found, one of 20 is.
    expect(gibson(at(19), { kit: 'yeast', minOverlap: 5 }).problem).toMatch(/Nothing follows/);
    expect(gibson(at(20), { kit: 'yeast', minOverlap: 5 }).problem).toBeNull();
    // Asked for 100, it is 80: a junction of 79 is not found, 80 and 81 are.
    expect(gibson(at(79), { kit: 'yeast', minOverlap: 100 }).problem).toMatch(/Nothing follows/);
    expect(gibson(at(80), { kit: 'yeast', minOverlap: 100 }).problem).toBeNull();
    expect(gibson(at(81), { kit: 'yeast', minOverlap: 100 }).problem).toBeNull();
  });

  it('rounds the overlap to whole bases, and falls back to 40 for nonsense', () => {
    expect(
      [19, 20, 29.6, 80, 81, Number.NaN, Number.POSITIVE_INFINITY].map(clampYeastOverlap),
    ).toEqual([20, 20, 30, 80, 80, 40, 40]);
  });

  it('joins the same circle as Gibson, and says nothing of its own', () => {
    // Parts of 180 bp: the exonuclease may chew them away in Gibson's tube.
    const bodies = THREE.map((_, i) => template(100, 800 + i));
    const parts = ring(THREE, { bodies }).parts;
    const plain = must(gibson(parts, { minOverlap: 40 }).assembly, 'a Gibson assembly');
    expect(kinds(plain.warnings)).toContain('short-part');
    const yeast = must(gibson(parts, { kit: 'yeast' }).assembly, 'a yeast assembly');
    expect(yeast.warnings).toEqual([]);
    expect(yeast.product.sequence.toString()).toBe(plain.product.sequence.toString());
    expect(yeast.product.metadata.description).toMatch(/^Circular yeast assembly by homologous/);
    expect(plain.product.metadata.description).toMatch(/^Circular Gibson assembly/);
  });

  it('leaves the Gibson product without junction features', () => {
    const { parts } = good();
    const plain = must(gibson(parts, { minOverlap: 40 }).assembly, 'an assembly');
    expect([...plain.product.features].map((f) => f.name).sort()).toEqual(
      ['AmpR', 'CEN6', 'URA3', 'pUC ori'].sort(),
    );
  });
});

describe('yeastAssembly', () => {
  it('assembles the circle, 40 bp by default, with no warning for a good one', () => {
    const { parts, junctions, bodies } = good();
    const { result, assembly } = run(parts, { vector: parts[0] ?? null });
    expect(result.problem).toBeNull();
    expect(assembly.product.isCircular).toBe(true);
    expect(assembly.joins.map((j) => j.length)).toEqual([40, 40, 40]);
    expect(assembly.warnings).toEqual([]);
    // The closing junction is the product's start, so it reads J2 body0 J0 body1 J1 body2.
    const [j0, j1, j2] = junctions;
    expect(assembly.product.sequence.toString()).toBe(
      `${j2}${bodies[0]}${j0}${bodies[1]}${j1}${bodies[2]}`,
    );
  });

  it('refuses a linear product from one part, and a circular part, as Gibson does', () => {
    const { parts } = good();
    expect(yeastAssembly([must(parts[0], 'a part')], { circular: false }).problem).toMatch(
      /not an assembly/,
    );
    const circle = SeqDocument.create({
      name: 'plasmid',
      sequence: template(300, 5),
      topology: 'circular',
    });
    const run2 = yeastAssembly([circle, ...parts]);
    expect(run2.dropped.map((d) => d.reason)).toEqual(['circular']);
    expect(run2.problem).toBeNull();
  });

  describe('the vector', () => {
    it('is marked by its index in the order, wherever it went in and whichever way round', () => {
      const { parts } = good();
      const [vector, a, b] = parts as [SeqDocument, SeqDocument, SeqDocument];
      expect(run(parts).assembly.vectorIndex).toBeNull();
      for (const given of [
        [vector, a, b],
        [a, vector, b],
        [b, a, vector],
      ]) {
        const { assembly } = run(given, { vector });
        expect(assembly.order[must(assembly.vectorIndex, 'a vector')]?.document.name).toBe(
          'vector',
        );
      }
      // Given turned over, which makes a document of its own; the circle may need it turned back.
      const turnedVector = vector.reverseComplement();
      const turned = run([a, turnedVector, b], { vector: turnedVector });
      const idx = must(turned.assembly.vectorIndex, 'a vector');
      expect(turned.assembly.order[idx]?.document.name).toBe('vector');
      expect(turned.assembly.order[idx]?.flipped).toBe(true);
    });

    it('is refused when it is circular, short, or not one of the parts', () => {
      const { parts } = good();
      const circle = SeqDocument.create({
        name: 'pRS416',
        sequence: template(300, 5),
        topology: 'circular',
      });
      const closed = yeastAssembly([circle, ...parts], { vector: circle });
      expect(closed.assembly).toBeNull();
      expect(closed.problem).toBe(
        'The vector pRS416 is circular, so it has no ends to join by — linearise or digest it first.',
      );
      const stub = SeqDocument.create({ name: 'stub', sequence: template(40, 6) });
      expect(yeastAssembly([stub, ...parts], { vector: stub }).problem).toMatch(
        /^The vector stub is shorter than the 40 bp of homology a junction needs\.$/,
      );
      const other = SeqDocument.create({ name: 'elsewhere', sequence: template(300, 7) });
      expect(yeastAssembly(parts, { vector: other }).problem).toBe(
        'The vector elsewhere is not one of the parts.',
      );
    });
  });

  describe('junction features', () => {
    it('marks each junction on the product over exactly its bases, once each', () => {
      const { parts, junctions } = good();
      const { assembly } = run(parts);
      const marks = [...assembly.product.features].filter((f) => f.type === 'misc_feature');
      expect(marks.map((f) => f.name).sort()).toEqual(['homology 1', 'homology 2', 'homology 3']);
      const text = assembly.product.sequence.toString();
      for (const [j, join] of assembly.joins.entries()) {
        const mark = must(
          marks.find((f) => f.name === `homology ${j + 1}`),
          'a mark',
        );
        const seg = must(mark.segments[0], 'a segment');
        if (seg.kind !== 'range') throw new Error('a range');
        expect(text.slice(seg.start, seg.end)).toBe(join.overlap);
        expect(text.split(join.overlap)).toHaveLength(2);
        expect(assembly.junctions[j]).toMatchObject({ start: seg.start, end: seg.end });
      }
      // The closing junction is the circle's start; the others follow their upstream part.
      expect(assembly.junctions.map((j) => [j.start, j.end])).toEqual([
        [540, 580],
        [1080, 1120],
        [0, 40],
      ]);
      expect(assembly.junctions.map((j) => `${j.from}>${j.to}`)).toEqual([
        'vector>insert1',
        'insert1>insert2',
        'insert2>vector',
      ]);
      expect(junctions[1]).toBe(assembly.joins[1]?.overlap);
    });

    it('says in a note that the app made them, and names the parts', () => {
      const { assembly } = run(good().parts);
      const note = must(
        [...assembly.product.features]
          .find((f) => f.name === 'homology 1')
          ?.qualifiers.find((q) => q.name === 'note')?.value,
        'a note',
      );
      expect(note).toBe(
        'Added by PlasmidPop: 40 bp of homology shared by vector and insert1, in the product once; the cell joins the two by recombination here',
      );
    });

    it('leaves a linear product with one fewer, and the parts features where they were', () => {
      const [j0, j1] = [template(40, 11), template(40, 12)];
      const [b0, b1, b2] = [template(300, 21), template(300, 22), template(300, 23)] as [
        string,
        string,
        string,
      ];
      const parts = [
        SeqDocument.create({ name: 'a', sequence: b0 + j0 }),
        SeqDocument.create({ name: 'b', sequence: j0 + b1 + j1 }),
        SeqDocument.create({
          name: 'c',
          sequence: j1 + b2,
          features: [feature('CDS', 'URA3', 50, 100)],
        }),
      ];
      const { assembly } = run(parts, { circular: false });
      expect(assembly.product.isCircular).toBe(false);
      expect(assembly.product.sequence.toString()).toBe(b0 + j0 + b1 + j1 + b2);
      expect(assembly.junctions.map((j) => [j.start, j.end])).toEqual([
        [300, 340],
        [640, 680],
      ]);
      const ura = must(
        [...assembly.product.features].find((f) => f.name === 'URA3'),
        'URA3',
      );
      expect(ura.segments[0]).toMatchObject({ start: 690, end: 740 });
    });

    it('marks the circle a single part closes into, at its start', () => {
      const j = template(40, 13);
      const body = template(300, 24);
      const part = SeqDocument.create({ name: 'loop', sequence: j + body + j });
      const { assembly } = run([part]);
      expect(assembly.product.sequence.toString()).toBe(j + body);
      expect(assembly.junctions).toMatchObject([{ name: 'homology 1', start: 0, end: 40 }]);
    });
  });

  describe('warnings', () => {
    const only = (a: ReturnType<typeof run>['assembly']): string[] => kinds(a.warnings);

    it('flags a junction under 30 bp: 20 and 29 do, 30 does not', () => {
      for (const [n, flagged] of [
        [20, true],
        [29, true],
        [30, false],
        [31, false],
      ] as const) {
        const js = [template(n, 41), template(40, 42), template(40, 43)];
        const { assembly } = run(ring(js, { features: [vectorFeatures()] }).parts, {
          minOverlap: 20,
        });
        expect(only(assembly)).toEqual(flagged ? ['short-overlap'] : []);
        if (flagged) {
          expect(assembly.warnings[0]?.text).toBe(
            `Recombination falls off sharply below 30 bp of homology: homology 1 (vector to insert1), ${n} bp.`,
          );
        }
      }
    });

    it('lists every junction that is short, by its name', () => {
      const js = [template(25, 44), template(40, 45), template(22, 46)];
      const { assembly } = run(ring(js, { features: [vectorFeatures()] }).parts, {
        minOverlap: 20,
      });
      expect(assembly.warnings.map((w) => w.text)).toEqual([
        'Recombination falls off sharply below 30 bp of homology: homology 1 (vector to insert1), 25 bp; homology 3 (insert2 to vector), 22 bp.',
      ]);
    });

    it('flags a junction over 80 bp: 80 does not, 81 and 100 do', () => {
      for (const [n, flagged] of [
        [79, false],
        [80, false],
        [81, true],
        [100, true],
      ] as const) {
        const js = [template(n, 47), template(40, 48), template(40, 49)];
        const { assembly } = run(ring(js, { features: [vectorFeatures()] }).parts);
        expect(only(assembly)).toEqual(flagged ? ['long-overlap'] : []);
        if (flagged) {
          expect(assembly.warnings[0]?.text).toBe(
            `More than 80 bp of homology recombines no better and makes the oligos that carry it longer: homology 1 (vector to insert1), ${n} bp.`,
          );
        }
      }
    });

    it('flags junction GC under 30% or over 70%: 30 and 70 do not', () => {
      for (const [gc, flagged] of [
        [10, true],
        [11, true],
        [12, false],
        [20, false],
        [28, false],
        [29, true],
        [35, true],
      ] as const) {
        const js = [withGc(40, gc, 51), template(40, 52), template(40, 53)];
        expect(gcCount(must(js[0], 'a junction'))).toBe(gc);
        const { assembly } = run(ring(js, { features: [vectorFeatures()] }).parts);
        expect(only(assembly)).toEqual(flagged ? ['gc'] : []);
        if (flagged) {
          expect(assembly.warnings[0]?.text).toBe(
            `Homology under 30% or over 70% GC recombines poorly: homology 1 (vector to insert1) is ${Math.round((gc * 100) / 40)}% GC.`,
          );
        }
      }
    });

    describe('a junction found again in the tube', () => {
      /** The ring with `copy` laid over insert1's body, away from both its ends. */
      function withCopy(copy: string, at = 200, bases = THREE): Ring {
        const bodies = bases.map((_, i) => template(500, 700 + i));
        const body = must(bodies[1], 'a body');
        // The context either side is made to differ from the junction's, so
        // a copy is exactly as long as asked.
        const j0 = must(bases[0], 'a junction');
        const planted = plant(body, at, copy, j0.charAt(0), j0.charAt(j0.length - 1));
        return ring(bases, {
          bodies: [must(bodies[0], 'a body'), planted, must(bodies[2], 'a body')],
          features: [vectorFeatures()],
        });
      }

      it('flags 30 bp of it in another part, and not 29: 40 bp junction, 30 bp window', () => {
        const j0 = must(THREE[0], 'a junction');
        const thirty = run(withCopy(j0.slice(5, 35)).parts).assembly;
        expect(only(thirty)).toEqual(['repeat']);
        expect(thirty.warnings[0]?.text).toBe(
          'The homology joining vector to insert1 also occurs in insert1 at 241, where the cell could recombine instead and give a different construct.',
        );
        expect(only(run(withCopy(j0.slice(5, 34)).parts).assembly)).toEqual([]);
      });

      it('flags all of it, and still only once', () => {
        const j0 = must(THREE[0], 'a junction');
        const { assembly } = run(withCopy(j0).parts);
        expect(assembly.warnings.map((w) => w.kind)).toEqual(['repeat']);
      });

      it('finds it on the other strand, and says so', () => {
        const j0 = must(THREE[0], 'a junction');
        const { assembly } = run(withCopy(reverseComplement(j0.slice(0, 32))).parts);
        expect(assembly.warnings).toHaveLength(1);
        expect(assembly.warnings[0]?.text).toMatch(
          /also occurs in insert1 at \d+ \(other strand\),/,
        );
      });

      it('finds it inside the vector, and names it as the vector when it is one', () => {
        // Insert2's junction with the vector, repeated inside the vector's body.
        const j1 = must(THREE[1], 'a junction');
        const bodies = THREE.map((_, i) => template(500, 700 + i));
        const body = must(bodies[0], 'a body');
        const planted = plant(body, 100, j1.slice(0, 31), 'A', 'A');
        const { parts } = ring(THREE, {
          bodies: [planted, must(bodies[1], 'a body'), must(bodies[2], 'a body')],
          features: [vectorFeatures()],
        });
        const named = run(parts, { vector: parts[0] ?? null }).assembly.warnings;
        expect(named).toHaveLength(1);
        expect(named[0]?.text).toBe(
          'The homology joining insert1 to insert2 also occurs in the vector vector at 141, where the cell could recombine instead and give a different construct.',
        );
        const unnamed = run(parts).assembly.warnings;
        expect(unnamed[0]?.text).toMatch(/also occurs in vector at 141,/);
      });

      it('finds a junction shorter than 30 bp copied whole, with a window of its own length', () => {
        const js = [template(24, 61), template(40, 62), template(40, 63)];
        const { assembly } = run(withCopy(must(js[0], 'a junction'), 200, js).parts, {
          minOverlap: 20,
        });
        expect(only(assembly).sort()).toEqual(['repeat', 'short-overlap']);
      });
    });

    describe('a direct repeat away from the junctions', () => {
      function withRepeat(length: number, between: 'one' | 'two'): Ring {
        const bodies = THREE.map((_, i) => template(500, 700 + i));
        const [b0, b1, b2] = bodies as [string, string, string];
        const source = b1.slice(100, 100 + length);
        const target = between === 'one' ? b1 : b2;
        const at = 300;
        const planted = plant(target, at, source, b1.charAt(99), b1.charAt(100 + length));
        return ring(THREE, {
          bodies: between === 'one' ? [b0, planted, b2] : [b0, b1, planted],
          features: [vectorFeatures()],
        });
      }

      it('is flagged from 30 bp, not 29, inside one part', () => {
        const flagged = run(withRepeat(30, 'one').parts).assembly;
        expect(only(flagged)).toEqual(['internal-repeat']);
        expect(flagged.warnings[0]?.text).toBe(
          '30 bp at 681 in insert1 is repeated at 881 in insert1. Direct repeats recombine in yeast and can delete what lies between them.',
        );
        expect(only(run(withRepeat(29, 'one').parts).assembly)).toEqual([]);
      });

      it('is flagged between two parts at its full length', () => {
        const { assembly } = run(withRepeat(45, 'two').parts);
        expect(assembly.warnings.map((w) => w.text)).toEqual([
          '45 bp at 681 in insert1 is repeated at 1,421 in insert2. Direct repeats recombine in yeast and can delete what lies between them.',
        ]);
      });

      it('is not flagged when it is an inverted repeat', () => {
        const bodies = THREE.map((_, i) => template(500, 700 + i));
        const [b0, b1, b2] = bodies as [string, string, string];
        const planted = plant(
          b1,
          300,
          reverseComplement(b1.slice(100, 140)),
          b1.charAt(99),
          b1.charAt(140),
        );
        const { assembly } = run(
          ring(THREE, { bodies: [b0, planted, b2], features: [vectorFeatures()] }).parts,
        );
        expect(only(assembly)).toEqual([]);
      });

      it('is listed ten at a time, and the rest counted', () => {
        const blocks = Array.from({ length: 12 }, (_, i) => template(40, 900 + i));
        const spacer = (i: number): string => template(60, 950 + i);
        const first = blocks.map((b, i) => spacer(i) + b).join('');
        const second = blocks.map((b, i) => spacer(20 + i) + b).join('');
        const bodies = [template(500, 700), first, second];
        const { assembly } = run(ring(THREE, { bodies, features: [vectorFeatures()] }).parts);
        const texts = assembly.warnings.filter((w) => w.kind === 'internal-repeat');
        expect(texts).toHaveLength(11);
        expect(texts[10]?.text).toBe('2 more direct repeats of 30 bp or more are not listed.');
      });

      it('is not reported a second time when it is the junction that is repeated', () => {
        const j0 = must(THREE[0], 'a junction');
        const bodies = THREE.map((_, i) => template(500, 700 + i));
        const planted = plant(must(bodies[1], 'a body'), 200, j0, 'A', 'A');
        const { assembly } = run(
          ring(THREE, {
            bodies: [must(bodies[0], 'a body'), planted, must(bodies[2], 'a body')],
            features: [vectorFeatures()],
          }).parts,
        );
        expect(only(assembly)).toEqual(['repeat']);
      });
    });

    describe('a linear product', () => {
      function line(): SeqDocument[] {
        const [j0, j1] = [template(40, 71), template(40, 72)];
        return [
          SeqDocument.create({
            name: 'vector',
            sequence: template(300, 73) + j0,
            features: [
              feature('CDS', 'URA3', 10, 200),
              feature('centromere', 'CEN6', 200, 250),
              feature('rep_origin', 'pUC ori', 250, 290),
            ],
          }),
          SeqDocument.create({ name: 'insert1', sequence: j0 + template(300, 74) + j1 }),
          SeqDocument.create({ name: 'insert2', sequence: j1 + template(300, 75) }),
        ];
      }

      it('is flagged, saying a linear molecule is lost', () => {
        const { assembly } = run(line(), { circular: false });
        expect(assembly.warnings.map((w) => [w.kind, w.text])).toEqual([
          [
            'linear-product',
            'The product is linear. A linear molecule with no telomere is lost from yeast; assemble it as a circle.',
          ],
        ]);
      });

      it('names the vector end that is left free, when the vector is at an end', () => {
        const [vector, a, b] = line() as [SeqDocument, SeqDocument, SeqDocument];
        const first = run([vector, a, b], { circular: false, vector }).assembly;
        expect(first.warnings[0]?.text).toMatch(/An end of the vector is not joined to anything/);
        // In the middle both its ends are joined.
        const [j0, j1] = [template(40, 81), template(40, 82)];
        const mid = [
          SeqDocument.create({ name: 'insert1', sequence: template(300, 83) + j0 }),
          SeqDocument.create({
            name: 'vector',
            sequence: j0 + template(300, 84) + j1,
            features: [
              feature('CDS', 'URA3', 60, 200),
              feature('centromere', 'CEN6', 200, 250),
              feature('rep_origin', 'pUC ori', 250, 290),
            ],
          }),
          SeqDocument.create({ name: 'insert2', sequence: j1 + template(300, 85) }),
        ];
        const inside = run(mid, { circular: false, vector: mid[1] ?? null }).assembly;
        expect(inside.warnings.map((w) => w.kind)).toEqual(['linear-product']);
        expect(inside.warnings[0]?.text).not.toMatch(/vector is not joined/);
      });

      it('is not said of a circle', () => {
        expect(only(run(good().parts).assembly)).not.toContain('linear-product');
      });

      it('does not call the closing homology an internal repeat (#412)', () => {
        // Three parts that would close into a circle, cut open: the vector's
        // first 40 bases are at the product's start and again at its end.
        const [j0, j1, j2] = [template(40, 91), template(40, 92), template(40, 93)];
        const vector = SeqDocument.create({
          name: 'vector',
          sequence: j0 + template(300, 94) + j1,
          features: [
            feature('CDS', 'URA3', 60, 200),
            feature('centromere', 'CEN6', 200, 250),
            feature('rep_origin', 'pUC ori', 250, 290),
          ],
        });
        const a = SeqDocument.create({ name: 'insert1', sequence: j1 + template(300, 95) + j2 });
        const b = SeqDocument.create({ name: 'insert2', sequence: j2 + template(300, 96) + j0 });
        const { assembly } = run([vector, a, b], { circular: false, vector });
        expect(assembly.product.isCircular).toBe(false);
        expect(assembly.warnings.map((w) => w.kind)).toEqual(['linear-product']);
      });
    });

    describe('what the product has to be kept in yeast', () => {
      function withFeatures(...fs: Feature[]): kindsOf {
        const { parts } = ring(THREE, { features: [fs] });
        return kinds(run(parts).assembly.warnings);
      }
      type kindsOf = string[];

      it('asks for a marker and an origin, and says to detect features when there are none', () => {
        const { parts } = ring(THREE);
        const { assembly } = run(parts);
        expect(assembly.warnings.map((w) => [w.kind, w.text])).toEqual([
          [
            'no-marker',
            'No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly. Detect features on the product first.',
          ],
          [
            'no-origin',
            'No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast. Detect features on the product first.',
          ],
        ]);
      });

      it('does not say to detect features when there are some', () => {
        const { parts } = ring(THREE, { features: [[feature('CDS', 'GFP', 10, 200)]] });
        const { assembly } = run(parts);
        expect(kinds(assembly.warnings)).toEqual(['no-marker', 'no-origin']);
        expect(assembly.warnings.some((w) => w.text.includes('Detect features'))).toBe(false);
      });

      it('reads a marker off a CDS or gene by name, and nothing else by that name', () => {
        const origin = feature('centromere', 'CEN6', 300, 400);
        const bacterial = feature('rep_origin', 'pUC ori', 410, 480);
        for (const name of [
          'URA3',
          'LEU2',
          'HIS3',
          'TRP1',
          'MET15',
          'LYS2',
          'ADE2',
          'kanMX KanR',
        ]) {
          expect(withFeatures(feature('CDS', name, 10, 200), origin, bacterial)).toEqual([]);
        }
        expect(withFeatures(feature('gene', 'URA3', 10, 200), origin, bacterial)).toEqual([]);
        // A promoter of URA3 selects nothing; neither does a name that contains one.
        expect(
          withFeatures(feature('promoter', 'URA3 promoter', 10, 200), origin, bacterial),
        ).toEqual(['no-marker']);
        expect(withFeatures(feature('CDS', 'URA30', 10, 200), origin, bacterial)).toEqual([
          'no-marker',
        ]);
      });

      it('reads an origin off a centromere, an ARS or a 2-micron feature', () => {
        const marker = feature('CDS', 'URA3', 10, 200);
        const bacterial = feature('rep_origin', 'pUC ori', 410, 480);
        for (const f of [
          feature('centromere', 'CEN4', 300, 400),
          feature('centromere', 'anything', 300, 400),
          feature('rep_origin', 'ARSH4', 300, 400),
          feature('rep_origin', 'ARS1', 300, 400),
          feature('misc_feature', 'CEN6', 300, 400),
          feature('repeat_region', '2-micron inverted repeat', 300, 400),
          feature('CDS', '2-micron REP1', 300, 400),
          feature('rep_origin', '2µ ori', 300, 400),
        ]) {
          expect(withFeatures(marker, f, bacterial)).toEqual([]);
        }
        // E. coli's origin is not yeast's, and a primer is not a feature.
        expect(withFeatures(marker, bacterial)).toEqual(['no-origin']);
        expect(
          withFeatures(marker, feature('primer_bind', 'CEN6 primer', 300, 320), bacterial),
        ).toEqual(['no-origin']);
      });

      it('remarks when the assembly has no way to be grown in E. coli', () => {
        const marker = feature('CDS', 'URA3', 10, 200);
        const origin = feature('centromere', 'CEN6', 300, 400);
        expect(withFeatures(marker, origin)).toEqual(['no-bacterial']);
        const { assembly } = run(ring(THREE, { features: [[marker, origin]] }).parts);
        expect(assembly.warnings[0]?.text).toBe(
          'No bacterial origin or resistance gene is annotated: the assembly can be recovered from yeast but not propagated in E. coli.',
        );
        expect(withFeatures(marker, origin, feature('rep_origin', 'pUC ori', 410, 480))).toEqual(
          [],
        );
        expect(withFeatures(marker, origin, feature('rep_origin', 'ColE1 ori', 410, 480))).toEqual(
          [],
        );
        expect(withFeatures(marker, origin, feature('CDS', 'AmpR', 410, 480))).toEqual([]);
        // f1 is a phage origin: it grows nothing in E. coli by itself.
        expect(withFeatures(marker, origin, feature('rep_origin', 'f1 ori', 410, 480))).toEqual([
          'no-bacterial',
        ]);
      });

      it('is read off the product, so features of a flipped part count where they land', () => {
        const [vector, a, b] = good().parts as [SeqDocument, SeqDocument, SeqDocument];
        const { assembly } = run([a, vector.reverseComplement(), b]);
        expect(assembly.warnings).toEqual([]);
      });
    });

    it('is the same list yeastWarnings gives for the assembly', () => {
      const { parts } = ring(THREE);
      const { assembly } = run(parts);
      expect(assembly.warnings).toEqual(yeastWarnings(assembly));
    });

    it('lists the kinds in the order a reader needs them', () => {
      // Short, then long, a repeat, a direct repeat, GC, then what the cell needs.
      const js = [template(25, 91), withGc(85, 20, 92), template(40, 93)];
      const bodies = [template(500, 94), template(500, 95), template(500, 96)];
      const j0 = must(js[0], 'a junction');
      const j1 = must(js[1], 'a junction');
      const b1 = plant(must(bodies[1], 'a body'), 100, j0, 'A', 'A');
      const b2 = plant(
        must(bodies[2], 'a body'),
        100,
        must(bodies[0], 'a body').slice(0, 35),
        'A',
        'A',
      );
      const { assembly } = run(ring(js, { bodies: [must(bodies[0], 'a body'), b1, b2] }).parts, {
        minOverlap: 20,
      });
      expect(j1).toHaveLength(85);
      expect(kinds(assembly.warnings)).toEqual([
        'short-overlap',
        'long-overlap',
        'repeat',
        'internal-repeat',
        'gc',
        'no-marker',
        'no-origin',
      ]);
    });
  });

  describe('lineage', () => {
    it('is recorded as a gibson step with the yeast kit, read as an assembly in yeast', () => {
      const { parts } = good();
      const { assembly } = run(parts, { vector: parts[0] ?? null });
      const doc = recordGibson(assembly, { kit: 'yeast', circular: true, overlap: 40 });
      const root = lineageOf(doc);
      expect(root.step).toMatchObject({ op: 'gibson', kit: 'yeast', circular: true, overlap: 40 });
      expect(describeLineageStep(must(root.step, 'a step'))).toBe(
        'Assembled in yeast by homologous recombination of 3 parts',
      );
    });

    it('says so for a linear product, and survives a GenBank round trip', () => {
      const [j0] = [template(40, 111)];
      const parts = [
        SeqDocument.create({ name: 'a', sequence: template(300, 112) + j0 }),
        SeqDocument.create({ name: 'b', sequence: j0 + template(300, 113) }),
      ];
      const { assembly } = run(parts, { circular: false });
      const doc = recordGibson(assembly, { kit: 'yeast', circular: false, overlap: 40 });
      expect(describeLineageStep(must(lineageOf(doc).step, 'a step'))).toBe(
        'Assembled in yeast by homologous recombination of 2 parts, linear',
      );
      const back = must(parseGenBank(writeGenBank(doc)).documents[0], 'a document');
      expect(lineageOf(back).step).toMatchObject({ op: 'gibson', kit: 'yeast', overlap: 40 });
      expect(back.metadata.lineage?.step).toEqual(doc.metadata.lineage?.step);
    });

    it('is a protocol line about the cell, not Gibson mix amounts', () => {
      const { parts } = good();
      const { assembly } = run(parts);
      const doc = recordGibson(assembly, { kit: 'yeast', circular: true, overlap: 40 });
      const steps = must(buildProtocol(doc), 'a protocol').steps.filter((s) => s.kind !== 'digest');
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ kind: 'other' });
      expect(JSON.stringify(steps[0])).toMatch(/co-transform/);
      expect(JSON.stringify(steps[0])).not.toMatch(/50 °C/);
    });
  });
});

describe('overlap primers for yeast', () => {
  const vector = SeqDocument.create({
    name: 'vector',
    sequence: template(900, 201),
    features: [
      feature('CDS', 'URA3', 100, 400),
      feature('centromere', 'CEN6', 410, 500),
      feature('rep_origin', 'pUC ori', 510, 600),
    ],
  });
  const gene = SeqDocument.create({ name: 'gene', sequence: template(1500, 202) });

  it('carries 40 bases of the vector on each tail', () => {
    const design = designOverlapPrimers(vector, gene, { start: 300, end: 800 }, 'yeast');
    expect(design.problem).toBeNull();
    const text = vector.sequence.toString().toUpperCase();
    expect(design.forward.tail).toBe(text.slice(-40));
    expect(design.reverse.tail).toBe(reverseComplement(text.slice(0, 40)));
    expect(design.product?.isCircular).toBe(true);
    expect(design.product?.length).toBe(900 + 500);
  });

  it('marks the two junctions on the product and warns as the cell would, not as a kit', () => {
    const design = designOverlapPrimers(vector, gene, { start: 300, end: 800 }, 'yeast');
    const product = must(design.product, 'a product');
    expect(
      [...product.features].filter((f) => f.type === 'misc_feature').map((f) => f.name),
    ).toEqual(['homology 1', 'homology 2']);
    expect(design.warnings).toContain(
      'Yeast assembly asks for 40 bases of homology, which both tails carry.',
    );
    // The vector has its marker, origin and ori: nothing else to say.
    expect(design.warnings).toHaveLength(1);
    expect(design.warnings.join(' ')).not.toMatch(/chew|exonuclease|200 bp/);
  });

  it('is run as the cell does it: a sticky-ended vector is trimmed by resection, not chewed back', () => {
    const sticky = vector.setEnds({
      left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: 'blunt', overhang: '', enzyme: null },
    });
    const design = designOverlapPrimers(sticky, gene, { start: 300, end: 800 }, 'yeast');
    expect(design.warnings.join(' ')).toMatch(/the cell's own resection trims them/);
  });

  it('refuses a vector shorter than the 40 bases, by the kit name', () => {
    const stub = SeqDocument.create({ name: 'stub', sequence: template(30, 203) });
    expect(designOverlapPrimers(stub, gene, { start: 300, end: 800 }, 'yeast').problem).toBe(
      'stub is shorter than the 40 bases of homology Yeast assembly asks for.',
    );
  });

  it('is recorded as the yeast kit, 40 bp, with the amplicon a molecule of its own', () => {
    const design = designOverlapPrimers(vector, gene, { start: 300, end: 800 }, 'yeast');
    const doc = must(recordOverlapDesign(design, vector, gene, 'yeast'), 'a record');
    const root = lineageOf(doc);
    expect(root.step).toMatchObject({ op: 'gibson', kit: 'yeast', circular: true, overlap: 40 });
    expect(root.step?.op === 'gibson' ? root.step.parents.map((p) => p.name) : []).toEqual([
      'vector',
      'gene PCR product',
    ]);
  });

  it('leaves In-Fusion and NEBuilder as they were: no junction features, Gibson warnings', () => {
    for (const kit of ['in-fusion', 'nebuilder'] as const) {
      const design = designOverlapPrimers(vector, gene, { start: 300, end: 800 }, kit);
      const product = must(design.product, 'a product');
      expect([...product.features].some((f) => f.name.startsWith('homology'))).toBe(false);
    }
  });
});

describe('directRepeats', () => {
  const unit = template(60, 301);
  const none: readonly { start: number; end: number }[] = [];

  it('finds a direct repeat at its full length, from its first copy', () => {
    const a = template(100, 302);
    const b = template(100, 303);
    // The bases either side of the copies differ, so the repeat is the unit and no more.
    const text = `${a}C${unit}G${b}A${unit}T${template(50, 304)}`;
    expect(directRepeats(text, false, 30, none)).toEqual([{ a: 101, b: 263, length: 60 }]);
  });

  it('wants 30 bases, not 29, and copies that do not overlap each other', () => {
    const a = template(100, 305);
    const make = (copy: string) =>
      a + 'C' + copy + 'G' + template(100, 306) + 'A' + copy + 'T' + template(40, 307);
    expect(directRepeats(make(unit.slice(0, 29)), false, 30, none)).toEqual([]);
    expect(directRepeats(make(unit.slice(0, 30)), false, 30, none)).toHaveLength(1);
    // A run of one base repeats itself with a period of 1, not a copy 30 bases on.
    expect(
      directRepeats(template(100, 308) + 'A'.repeat(45) + template(60, 309), false, 30, none),
    ).toEqual([]);
  });

  it('takes copies exactly 30 bases apart, on a line and on a circle, and not 29', () => {
    const two = unit.slice(0, 30) + unit.slice(0, 30);
    expect(directRepeats(two, false, 30, none)).toEqual([{ a: 0, b: 30, length: 30 }]);
    // On a circle of 60 each is 30 from the other both ways round.
    expect(directRepeats(two, true, 30, none)).toEqual([{ a: 0, b: 30, length: 59 }]);
    const near = unit.slice(0, 29) + unit.slice(0, 29);
    expect(directRepeats(near, false, 30, none)).toEqual([]);
    expect(directRepeats(near, true, 30, none)).toEqual([]);
  });

  it('reads a circle across its origin, and a line not', () => {
    // 40 bases that begin 20 from the text's end and end 20 into it: two
    // halves of 20 on a line, and one copy of 40 on a circle.
    const copy = unit.slice(0, 40);
    const text = `${copy.slice(20)}${template(200, 310)}${copy}${template(100, 311)}${copy.slice(0, 20)}`;
    expect(text).toHaveLength(380);
    expect(directRepeats(text, false, 30, none)).toEqual([]);
    expect(directRepeats(text, true, 30, none)).toEqual([{ a: 220, b: 360, length: 40 }]);
  });

  it('skips windows that touch a blocked stretch, on a circle through its origin too', () => {
    const text = template(100, 312) + unit + template(100, 313) + unit + template(100, 314);
    expect(directRepeats(text, false, 30, [{ start: 100, end: 160 }])).toEqual([]);
    expect(directRepeats(text, false, 30, [{ start: 100, end: 110 }])).toEqual([
      { a: 110, b: 270, length: 50 },
    ]);
    // 100-110 of the text, seen across the origin of a circle, is the same bases.
    expect(directRepeats(text, true, 30, [{ start: 100, end: 160 }])).toEqual([]);
    // The origin's own windows are blocked from both sides of it.
    const copy = unit.slice(0, 40);
    const around = `${copy.slice(20)}${template(200, 310)}${copy}${template(100, 311)}${copy.slice(0, 20)}`;
    expect(directRepeats(around, true, 30, [{ start: 0, end: 5 }])).toEqual([]);
    expect(directRepeats(around, true, 30, [{ start: 100, end: 110 }])).toEqual([
      { a: 220, b: 360, length: 40 },
    ]);
  });

  it('ignores anything that is not ACGT', () => {
    const n = 'N'.repeat(40);
    expect(directRepeats(template(50, 316) + n + template(50, 317) + n, false, 30, none)).toEqual(
      [],
    );
  });
});
