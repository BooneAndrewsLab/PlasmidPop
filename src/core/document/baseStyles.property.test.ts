import fc from 'fast-check';

import { type Topology, normalizePosition, rangePieces } from '../range';

import { type BaseStyle, type BaseStylePatch, BASE_SIZES, type StyleRun } from './baseStyles';
import { SeqDocument } from './seqDocument';

/**
 * Styles against the obvious model: one style (or none) per base, in an
 * array edited with `splice`. Whatever the edits, the document's runs must
 * say, base for base, what the array says.
 */

type Cell = BaseStyle | null;

const same = (a: Cell, b: Cell): boolean => JSON.stringify(a) === JSON.stringify(b);

function expand(runs: readonly StyleRun[], length: number): Cell[] {
  const out: Cell[] = new Array<Cell>(length).fill(null);
  for (const run of runs) for (let i = run.start; i < run.end; i++) out[i] = run.style;
  return out;
}

function patchCell(cell: Cell, patch: BaseStylePatch): Cell {
  const merged = new Map<string, unknown>(Object.entries(cell ?? {}));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null || v === false) merged.delete(k);
    else merged.set(k, v);
  }
  // Keys in the one order the model writes them, so equal styles compare equal.
  const ordered: Record<string, unknown> = {};
  for (const k of ['color', 'highlight', 'bold', 'size'])
    if (merged.has(k)) ordered[k] = merged.get(k);
  return Object.keys(ordered).length === 0 ? null : ordered;
}

/** Bases inserted at `p` take the style of the run they land inside, if any. */
function inherited(cells: readonly Cell[], p: number): Cell {
  const left = cells[p - 1] ?? null;
  const right = cells[p] ?? null;
  return p > 0 && p < cells.length && left !== null && same(left, right) ? left : null;
}

const patchArb: fc.Arbitrary<BaseStylePatch> = fc.record(
  {
    color: fc.constantFrom('#ff0000', '#00aa00', null),
    highlight: fc.constantFrom('#ffff00', null),
    bold: fc.constantFrom(true, null),
    size: fc.constantFrom(...BASE_SIZES, null),
  },
  { requiredKeys: [] },
);

type Shape =
  | { kind: 'style'; at: number; len: number; patch: BaseStylePatch }
  | { kind: 'insert'; at: number; len: number }
  | { kind: 'delete'; at: number; len: number }
  | { kind: 'replace'; at: number; len: number; text: number }
  | { kind: 'paste'; at: number; len: number; text: number; styled: number }
  | { kind: 'reverse' }
  | { kind: 'origin'; at: number }
  | { kind: 'topology' };

const shapeArb: fc.Arbitrary<Shape> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('style' as const),
      at: fc.nat(),
      len: fc.nat(),
      patch: patchArb,
    }),
    weight: 5,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('insert' as const), at: fc.nat(), len: fc.nat() }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), len: fc.nat() }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('replace' as const),
      at: fc.nat(),
      len: fc.nat(),
      text: fc.nat(8),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('paste' as const),
      at: fc.nat(),
      len: fc.nat(),
      text: fc.nat(8),
      styled: fc.nat(),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: 'reverse' as const }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant('origin' as const), at: fc.nat() }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'topology' as const }), weight: 1 },
);

function span(doc: SeqDocument, at: number, len: number, min: number) {
  const L = doc.length;
  const start = L === 0 ? 0 : at % L;
  const max = doc.isCircular ? L : L - start;
  if (max < min) return null;
  return { start, end: start + min + (len % (max - min + 1)) };
}

/** Indices of the bases `r` covers, in order, around the origin if it wraps. */
function indices(r: { start: number; end: number }, length: number): number[] {
  const out: number[] = [];
  for (const piece of rangePieces(r, length))
    for (let i = piece.start; i < piece.end; i++) out.push(i);
  return out;
}

function step(doc: SeqDocument, cells: Cell[], shape: Shape): [SeqDocument, Cell[]] {
  const L = doc.length;
  switch (shape.kind) {
    case 'style': {
      const r = span(doc, shape.at, shape.len, 0);
      if (r === null) return [doc, cells];
      const next = [...cells];
      for (const i of indices(r, L)) next[i] = patchCell(next[i] ?? null, shape.patch);
      return [doc.styleBases(r, shape.patch), next];
    }
    case 'insert': {
      const p = normalizePosition(shape.at % (L + 1), L, doc.topology);
      const n = 1 + (shape.len % 5);
      const next = [...cells];
      next.splice(p, 0, ...new Array<Cell>(n).fill(inherited(cells, p)));
      return [doc.insert(p, 'A'.repeat(n)), next];
    }
    case 'delete': {
      const r = span(doc, shape.at, shape.len, 1);
      if (r === null) return [doc, cells];
      const gone = new Set(indices(r, L));
      return [doc.delete(r), cells.filter((_, i) => !gone.has(i))];
    }
    case 'replace': {
      const r = span(doc, shape.at, shape.len, 0);
      if (r === null) return [doc, cells];
      const oldLen = r.end - r.start;
      const common = Math.min(oldLen, shape.text);
      const pivot = doc.isCircular && L > 0 ? (r.start + common) % L : r.start + common;
      let next = [...cells];
      if (shape.text > oldLen) {
        next.splice(
          pivot,
          0,
          ...new Array<Cell>(shape.text - common).fill(inherited(cells, pivot)),
        );
      } else if (oldLen > shape.text) {
        const gone = new Set(indices({ start: pivot, end: pivot + oldLen - common }, L));
        next = next.filter((_, i) => !gone.has(i));
      }
      return [doc.replace(r, 'C'.repeat(shape.text)), next];
    }
    case 'paste': {
      const r = span(doc, shape.at, shape.len, 0);
      if (r === null) return [doc, cells];
      const text = 'G'.repeat(shape.text);
      const styled = shape.text === 0 ? 0 : shape.styled % (shape.text + 1);
      const style: BaseStyle = { bold: true };
      const fragmentStyles: StyleRun[] = styled === 0 ? [] : [{ start: 0, end: styled, style }];
      const gone = new Set(indices(r, L));
      const kept = cells.filter((_, i) => !gone.has(i));
      // Where the first base of the range was, in the bases left.
      const before = indices(r, L)[0] ?? r.start;
      let p = cells.slice(0, L === 0 ? 0 : before % L).filter((_, i) => !gone.has(i)).length;
      if (doc.isCircular) p = kept.length === 0 ? 0 : p % kept.length;
      const pasted: Cell[] = Array.from({ length: shape.text }, (_, i) =>
        i < styled ? style : null,
      );
      kept.splice(p, 0, ...pasted);
      const next = doc.insertFragment(r, { sequence: text, features: [], styles: fragmentStyles });
      return [next, kept];
    }
    case 'reverse':
      return [doc.reverseComplement(), [...cells].reverse()];
    case 'origin': {
      if (!doc.isCircular || L === 0) return [doc, cells];
      const p = shape.at % L;
      return [doc.setOrigin(p), [...cells.slice(p), ...cells.slice(0, p)]];
    }
    case 'topology':
      return [doc.setTopology(doc.isCircular ? 'linear' : 'circular'), cells];
  }
}

describe('base styles under random editing', () => {
  it('say base for base what a per-base model says', () => {
    fc.assert(
      fc.property(
        fc.nat(40),
        fc.constantFrom<Topology>('linear', 'circular'),
        fc.array(shapeArb, { maxLength: 25 }),
        (length, topology, shapes) => {
          let doc = SeqDocument.create({ sequence: 'T'.repeat(length), topology });
          let cells: Cell[] = new Array<Cell>(length).fill(null);
          for (const shape of shapes) {
            [doc, cells] = step(doc, cells, shape);
            const actual = expand(doc.styles.runs, doc.length);
            if (
              actual.length !== cells.length ||
              actual.some((c, i) => !same(c, cells[i] ?? null))
            ) {
              throw new Error(
                `after ${shape.kind}: ${JSON.stringify(doc.styles.runs)} vs ${JSON.stringify(cells)}`,
              );
            }
            // Runs are tidy: in order, apart, never two alike side by side.
            doc.styles.runs.forEach((run, i) => {
              const prev = doc.styles.runs[i - 1];
              if (
                prev !== undefined &&
                (prev.end > run.start || (prev.end === run.start && same(prev.style, run.style)))
              ) {
                throw new Error(`untidy runs ${JSON.stringify(doc.styles.runs)}`);
              }
            });
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});
