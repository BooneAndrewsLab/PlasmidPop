import fc from 'fast-check';

import { selectionAfterOp } from '@/app/editing';
import { parseGenBank, writeGenBank } from '@/io';

import { type Feature, createFeature, rangeSegment } from '../features';
import { History } from '../history';
import { type BluntMethod, type EditOp } from './editOp';
import { type DocumentEnds, type StrandEnd } from './ends';
import { SeqDocument } from './seqDocument';

/**
 * Blunting a sticky-ended molecule (`SeqDocument.bluntEnds`), checked against
 * an oracle that knows nothing of `ends.ts`'s conventions beyond how to lay
 * the two strands out: the molecule is built as columns, each holding a top
 * base, a bottom base, both or neither side of it, and the enzyme is applied
 * to each single-stranded column by the polarity of the strand it sits on —
 * a polymerase extends a recessed 3′ end (so it fills in wherever the lone
 * strand ends 5′) and chews a protruding 3′ end back; a single-strand
 * nuclease removes every lone strand. Reading the top strand of what is left
 * is the expected sequence.
 *
 * Exhaustively, for every left end × right end in {plain blunt, enzyme blunt,
 * 5′ of 1..4, 3′ of 1..4}, both methods, and duplex cores of 1..3 bp (a molecule
 * with no base pair at all is not one the model describes):
 *
 * - the sequence matches the oracle and the ends are gone;
 * - every feature over every range (and a two-piece join over every pair)
 *   covers exactly the bases it did, less those removed, and no filled-in
 *   base; a feature left with nothing is dropped;
 * - `bluntShift` is the number of bases lost at the start, and every caret
 *   and selection maps (`mapPositionThrough`, `selectionAfterOp`) to where
 *   its bases went;
 * - undo gives back the very same document, blunting twice is blunting once
 *   (same instance), and a GenBank round trip keeps the blunt sequence with
 *   no ends.
 *
 * A fast-check property then runs the same oracle on random bases and cores.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', T: 'A', C: 'G', G: 'C', N: 'N' };
const comp = (b: string): string => must(COMPLEMENT[b], `a complement for ${b}`);

type EndShape =
  | { readonly kind: 'plain' }
  | { readonly kind: 'blunt' }
  | { readonly kind: "5'" | "3'"; readonly n: number };

const END_SHAPES: readonly EndShape[] = [
  { kind: 'plain' },
  { kind: 'blunt' },
  ...[1, 2, 3, 4].flatMap((n) => [
    { kind: "5'" as const, n },
    { kind: "3'" as const, n },
  ]),
];

const METHODS: readonly BluntMethod[] = ['fill', 'trim'];

/** One base pair position of the two-strand model; `id` follows a top base through the edit. */
interface Column {
  readonly top: string | null;
  /** The bottom strand's own base (the complement of the top one where both are there). */
  readonly bottom: string | null;
  /** Index into the document's sequence, for columns whose top base is there. */
  readonly seqIndex: number | null;
}

interface Built {
  readonly doc: SeqDocument;
  readonly columns: readonly Column[];
}

/**
 * The molecule and its two strands. `bases` supplies every base in order:
 * the left bottom-only overhang (if any), the sequence, the right
 * bottom-only overhang (if any).
 */
function build(
  left: EndShape,
  right: EndShape,
  core: number,
  bases: (i: number) => string,
  features: (length: number) => Feature[] = () => [],
): Built {
  let k = 0;
  const next = (): string => {
    const b = bases(k);
    k += 1;
    return b;
  };
  const leftTopOnly = left.kind === "5'" ? left.n : 0;
  const leftBottomOnly = left.kind === "3'" ? left.n : 0;
  const rightTopOnly = right.kind === "3'" ? right.n : 0;
  const rightBottomOnly = right.kind === "5'" ? right.n : 0;
  const cols: Column[] = [];
  let seq = '';
  for (let i = 0; i < leftBottomOnly; i++)
    cols.push({ top: null, bottom: comp(next()), seqIndex: null });
  const topLen = leftTopOnly + core + rightTopOnly;
  for (let i = 0; i < topLen; i++) {
    const b = next();
    const paired = i >= leftTopOnly && i < leftTopOnly + core;
    cols.push({ top: b, bottom: paired ? comp(b) : null, seqIndex: seq.length });
    seq += b;
  }
  for (let i = 0; i < rightBottomOnly; i++)
    cols.push({ top: null, bottom: comp(next()), seqIndex: null });

  // The ends as the document describes them: overhangs in top-strand reading.
  const readTop = (c: Column): string => c.top ?? comp(must(c.bottom, 'a strand'));
  const describe = (shape: EndShape, side: 'left' | 'right'): StrandEnd => {
    if (shape.kind === 'plain') return { kind: 'blunt', overhang: '', enzyme: null };
    if (shape.kind === 'blunt') return { kind: 'blunt', overhang: '', enzyme: 'SmaI' };
    const span = side === 'left' ? cols.slice(0, shape.n) : cols.slice(cols.length - shape.n);
    return { kind: shape.kind, overhang: span.map(readTop).join(''), enzyme: 'X' };
  };
  const ends: DocumentEnds = { left: describe(left, 'left'), right: describe(right, 'right') };
  const doc = SeqDocument.create({
    name: 'm',
    sequence: seq,
    topology: 'linear',
    features: features(seq.length),
    ends,
  });
  return { doc, columns: cols };
}

interface Outcome {
  /** The top strand after the enzyme. */
  readonly sequence: string;
  /** For each surviving column, the sequence index it came from (null: filled in). */
  readonly origin: readonly (number | null)[];
}

/** What the enzyme leaves, column by column, from the strands alone. */
function oracle(columns: readonly Column[], method: BluntMethod): Outcome {
  const topFirst = columns.findIndex((c) => c.top !== null);
  const bottomFirst = columns.findIndex((c) => c.bottom !== null);
  const kept: Column[] = [];
  columns.forEach((c, i) => {
    if (c.top !== null && c.bottom !== null) {
      kept.push(c);
      return;
    }
    if (method === 'trim') return;
    // A lone strand at the left end: the top strand's left terminus is its
    // 5′ end, the bottom strand's its 3′ end. At the right end it is the
    // other way round. The polymerase fills opposite a lone 5′ end and
    // chews a lone 3′ end away.
    const atLeft = i < Math.max(topFirst, bottomFirst);
    const lone: 'top' | 'bottom' = c.top !== null ? 'top' : 'bottom';
    const terminus = (lone === 'top') === atLeft ? "5'" : "3'";
    if (terminus === "5'") {
      kept.push(
        lone === 'top'
          ? { ...c, bottom: comp(must(c.top, 'top')) }
          : { top: comp(must(c.bottom, 'bottom')), bottom: c.bottom, seqIndex: null },
      );
    }
  });
  return {
    sequence: kept.map((c) => must(c.top, 'a top base')).join(''),
    origin: kept.map((c) => c.seqIndex),
  };
}

/** Every range and every two-piece join on a linear sequence of `L`. */
function everyFeature(L: number): Feature[] {
  const out: Feature[] = [];
  let n = 0;
  const add = (segments: Feature['segments']): void => {
    out.push(
      createFeature({
        id: `f${n}`,
        type: 'misc_feature',
        strand: n % 2 === 0 ? 'forward' : 'reverse',
        segments,
      }),
    );
    n += 1;
  };
  for (let a = 0; a < L; a++) for (let b = a + 1; b <= L; b++) add([rangeSegment(a, b)]);
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++)
      for (let c = b + 1; c < L; c++) add([rangeSegment(a, b), rangeSegment(c, c + 1)]);
  return out;
}

function coveredIndices(f: Feature): number[] {
  const out: number[] = [];
  for (const s of f.segments) {
    if (s.kind !== 'range') throw new Error('expected ranges only');
    for (let i = s.start; i < s.end; i++) out.push(i);
  }
  return out;
}

const cycle =
  (alphabet: string, salt: number) =>
  (i: number): string =>
    alphabet.charAt((i * 3 + salt) % alphabet.length);

function label(left: EndShape, right: EndShape, core: number, method: BluntMethod): string {
  const s = (e: EndShape): string =>
    e.kind === "5'" || e.kind === "3'" ? `${e.kind}${e.n}` : e.kind;
  return `${s(left)} | ${s(right)} core ${core} ${method}`;
}

/** Everything the exhaustive loop asserts about one molecule and method. */
function checkBlunt(built: Built, method: BluntMethod, what: string): void {
  const { doc, columns } = built;
  const want = oracle(columns, method);
  const op: EditOp = { type: 'bluntEnds', method };
  const blunt = doc.bluntEnds(method);

  expect(blunt.sequence.toString(), what).toBe(want.sequence);
  expect(blunt.ends, what).toBeNull();
  expect(blunt.topology).toBe('linear');
  expect(doc.apply(op).sequence.toString(), what).toBe(want.sequence);

  // Where each old base went.
  const newIndexOf = new Map<number, number>();
  want.origin.forEach((o, i) => {
    if (o !== null) newIndexOf.set(o, i);
  });

  // Features: the bases they had, less the removed ones, in the same order.
  const after = new Map(blunt.features.all().map((f) => [f.id, f]));
  for (const f of doc.features.all()) {
    const expected = coveredIndices(f).flatMap((i) => {
      const moved = newIndexOf.get(i);
      return moved === undefined ? [] : [moved];
    });
    const got = after.get(f.id);
    if (expected.length === 0) {
      expect(got, `${what}: ${f.id} should be gone`).toBeUndefined();
      continue;
    }
    const kept = must(got, `${what}: feature ${f.id}`);
    expect(coveredIndices(kept), `${what}: ${f.id}`).toEqual(expected);
    expect(kept.strand).toBe(f.strand);
  }
  // Nothing appears that was not there.
  for (const id of after.keys()) expect(doc.features.get(id), what).toBeDefined();

  // The shift: bases lost before the first surviving original one.
  const firstKept = must(
    want.origin.find((o) => o !== null),
    `${what}: a surviving base`,
  );
  const lostAtStart = firstKept;
  expect(doc.bluntShift(method), what).toBe(lostAtStart);

  // Carets: a gap before old base p lands before however many kept old
  // bases preceded it.
  const gap = (p: number): number => {
    let n = 0;
    for (let i = 0; i < p; i++) if (newIndexOf.has(i)) n += 1;
    return n;
  };
  for (let p = 0; p <= doc.length; p++) {
    expect(doc.mapPositionThrough(op, p), `${what} caret ${p}`).toBe(gap(p));
    for (let q = p; q <= doc.length; q++) {
      expect(selectionAfterOp(doc, { start: p, end: q }, op), `${what} sel ${p}-${q}`).toEqual({
        start: gap(p),
        end: gap(q),
      });
    }
  }

  // Undo is the exact original; blunting again changes nothing.
  const history = History.create(doc).push(blunt, 'blunt');
  expect(history.undo().present).toBe(doc);
  expect(history.undo().redo().present).toBe(blunt);
  expect(blunt.bluntEnds('fill')).toBe(blunt);
  expect(blunt.bluntEnds('trim')).toBe(blunt);
}

describe('bluntEnds, every pair of ends', () => {
  it('matches the two-strand model for every end, method and small core', () => {
    let checked = 0;
    for (const left of END_SHAPES)
      for (const right of END_SHAPES)
        for (let core = 1; core <= 3; core++)
          for (const method of METHODS) {
            const built = build(left, right, core, cycle('ACGTN', core), everyFeature);
            checkBlunt(built, method, label(left, right, core, method));
            checked += 1;
          }
    expect(checked).toBe(END_SHAPES.length * END_SHAPES.length * 3 * 2);
  }, 20_000);

  it('leaves a molecule with no described ends, or a circle, as the same instance', () => {
    for (const topology of ['linear', 'circular'] as const)
      for (const method of METHODS) {
        const doc = SeqDocument.create({ sequence: 'ACGTAC', topology });
        expect(doc.bluntEnds(method)).toBe(doc);
        expect(doc.bluntShift(method)).toBe(0);
        for (let p = 0; p <= doc.length; p++)
          expect(doc.mapPositionThrough({ type: 'bluntEnds', method }, p)).toBe(p);
      }
    // Ends given to a circle are dropped, so it too is left alone.
    const circle = SeqDocument.create({
      sequence: 'AATTCGG',
      topology: 'circular',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: 'blunt', overhang: '', enzyme: null },
      },
    });
    expect(circle.ends).toBeNull();
    expect(circle.bluntEnds('trim')).toBe(circle);
  });

  it('writes a blunted molecule to GenBank and reads it back with no ends', () => {
    for (const left of END_SHAPES)
      for (const right of END_SHAPES)
        for (const method of METHODS) {
          const what = label(left, right, 2, method);
          const { doc } = build(left, right, 2, cycle('ACGT', 1), (L) =>
            L === 0
              ? []
              : [createFeature({ id: 'g', type: 'gene', segments: [rangeSegment(0, L)] })],
          );
          const blunt = doc.bluntEnds(method);
          const [back] = parseGenBank(writeGenBank(blunt)).documents;
          const read = must(back, `${what}: a parsed record`);
          expect(read.ends, what).toBeNull();
          expect(read.sequence.toString().toUpperCase(), what).toBe(
            blunt.sequence.toString().toUpperCase(),
          );
          expect(read.topology).toBe('linear');
          expect(read.features.all().map(coveredIndices), what).toEqual(
            blunt.features.all().map(coveredIndices),
          );
        }
  }, 20_000);
});

describe('bluntEnds, random molecules', () => {
  const endArb: fc.Arbitrary<EndShape> = fc.oneof(
    fc.constant<EndShape>({ kind: 'plain' }),
    fc.constant<EndShape>({ kind: 'blunt' }),
    fc.record({
      kind: fc.constantFrom("5'" as const, "3'" as const),
      n: fc.integer({ min: 1, max: 8 }),
    }),
  );
  const basesArb = fc.array(fc.constantFrom('A', 'C', 'G', 'T', 'N'), {
    minLength: 40,
    maxLength: 40,
  });

  it('match the two-strand model with random bases, cores and features', () => {
    fc.assert(
      fc.property(
        endArb,
        endArb,
        fc.integer({ min: 1, max: 20 }),
        basesArb,
        fc.constantFrom<BluntMethod>('fill', 'trim'),
        fc.array(fc.tuple(fc.nat(), fc.nat()), { maxLength: 6 }),
        (left, right, core, bases, method, spans) => {
          const built = build(
            left,
            right,
            core,
            (i) => must(bases[i % bases.length], 'a base'),
            (L) =>
              L === 0
                ? []
                : spans.map(([a, b], i) => {
                    const start = a % L;
                    const end = start + 1 + (b % (L - start));
                    return createFeature({
                      id: `r${i}`,
                      type: 'CDS',
                      segments: [rangeSegment(start, end)],
                    });
                  }),
          );
          checkBlunt(built, method, label(left, right, core, method));
        },
      ),
      { numRuns: 150 },
    );
  });
});
