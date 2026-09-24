import fc from 'fast-check';

import {
  type EditOp,
  type Feature,
  type SeqFragment,
  type Topology,
  SeqDocument,
  createFeature,
  flipStrand,
  isValidSegment,
  normalizePosition,
  rangeSegment,
  reverseComplement,
  siteSegment,
} from '@/core';

/**
 * fast-check generators for random editing sessions, and a naive reference
 * model to check them against. Shared by the property tests of the document
 * model, the editor store and the GenBank round trip.
 *
 * Ops are generated as abstract "shapes" (raw integers) and only resolved
 * against the document as it stands when they are applied, so any sequence
 * of shapes is valid for any document and shrinking stays meaningful.
 */

// Upper and lower case plus ambiguity codes: all of it has to survive editing.
const BASE = fc.constantFrom(...Array.from('ACGTACGTACGTNRYKMacgtn'));

export const dnaArb = (minLength: number, maxLength: number): fc.Arbitrary<string> =>
  fc.string({ unit: BASE, minLength, maxLength });

/** Where a feature lies, independent of the sequence length it will be laid on. */
export interface FeatureShape {
  readonly start: number;
  readonly span: number;
  /** Cut points splitting the span into a join; every other piece is kept. */
  readonly cuts: readonly number[];
  readonly reverse: boolean;
  readonly type: string;
  /** A site between two bases (GenBank `5^6`) rather than a range. */
  readonly site: boolean;
}

const featureShapeArb: fc.Arbitrary<FeatureShape> = fc.record({
  start: fc.nat(),
  span: fc.nat(),
  cuts: fc.array(fc.nat(), { maxLength: 4 }),
  reverse: fc.boolean(),
  type: fc.constantFrom('gene', 'CDS', 'misc_feature', 'promoter'),
  site: fc.oneof(
    { arbitrary: fc.constant(false), weight: 6 },
    { arbitrary: fc.constant(true), weight: 1 },
  ),
});

/**
 * Lays a shape on a sequence: a single range or a join of disjoint pieces in
 * ascending order, possibly wrapping the origin of a circular sequence.
 * A site can sit in any gap, the far end of a linear sequence included.
 * Null for a range on an empty sequence, which cannot carry one.
 */
export function layFeature(
  shape: FeatureShape,
  id: string,
  length: number,
  topology: Topology,
): Feature | null {
  if (shape.site) {
    const gaps = topology === 'circular' ? Math.max(length, 1) : length + 1;
    return createFeature({ id, type: shape.type, segments: [siteSegment(shape.start % gaps)] });
  }
  if (length === 0) return null;
  const start = shape.start % length;
  const maxSpan = topology === 'circular' ? length : length - start;
  const span = 1 + (shape.span % maxSpan);
  const cuts = [...new Set(shape.cuts.map((c) => c % span).filter((c) => c > 0))].sort(
    (a, b) => a - b,
  );
  const bounds = [0, ...cuts, span];
  const segments = [];
  for (let i = 0; i + 1 < bounds.length; i += 2) {
    let a = start + (bounds[i] ?? 0);
    let b = start + (bounds[i + 1] ?? 0);
    if (a >= length) {
      a -= length;
      b -= length;
    }
    segments.push(rangeSegment(a, b));
  }
  return createFeature({
    id,
    type: shape.type,
    strand: shape.reverse ? 'reverse' : 'forward',
    segments,
  });
}

export interface DocShape {
  readonly sequence: string;
  readonly topology: Topology;
  readonly features: readonly FeatureShape[];
}

/**
 * Mostly plasmid-sized toy sequences; now and then one longer than a rope
 * leaf (1024) so edits cross leaf boundaries.
 */
export const docShapeArb: fc.Arbitrary<DocShape> = fc.record({
  sequence: fc.oneof(
    { withCrossShrink: true },
    { arbitrary: dnaArb(0, 120), weight: 5 },
    { arbitrary: dnaArb(1100, 2600), weight: 1 },
  ),
  topology: fc.constantFrom<Topology>('circular', 'linear'),
  features: fc.array(featureShapeArb, { maxLength: 8 }),
});

export function layFeatures(shape: DocShape, prefix = 'f'): Feature[] {
  const out: Feature[] = [];
  shape.features.forEach((f, i) => {
    const laid = layFeature(f, `${prefix}${i}`, shape.sequence.length, shape.topology);
    if (laid !== null) out.push(laid);
  });
  return out;
}

export type OpShape =
  | { readonly kind: 'insert'; readonly at: number; readonly text: string }
  | { readonly kind: 'delete'; readonly at: number; readonly len: number }
  | { readonly kind: 'replace'; readonly at: number; readonly len: number; readonly text: string }
  | {
      readonly kind: 'paste';
      readonly at: number;
      readonly len: number;
      readonly text: string;
      readonly features: readonly FeatureShape[];
    }
  | { readonly kind: 'reverseComplement' }
  | { readonly kind: 'setOrigin'; readonly at: number }
  | { readonly kind: 'toggleTopology' }
  | { readonly kind: 'addFeature'; readonly feature: FeatureShape };

export const opShapeArb: fc.Arbitrary<OpShape> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('insert' as const),
      at: fc.nat(),
      text: dnaArb(1, 12),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), len: fc.nat() }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('replace' as const),
      at: fc.nat(),
      len: fc.nat(),
      text: dnaArb(0, 12),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('paste' as const),
      at: fc.nat(),
      len: fc.nat(),
      text: dnaArb(0, 20),
      features: fc.array(featureShapeArb, { maxLength: 3 }),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: 'reverseComplement' as const }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant('setOrigin' as const), at: fc.nat() }), weight: 2 },
  { arbitrary: fc.constant({ kind: 'toggleTopology' as const }), weight: 1 },
  {
    arbitrary: fc.record({ kind: fc.constant('addFeature' as const), feature: featureShapeArb }),
    weight: 1,
  },
);

/** A range of `len` taken from a raw shape, valid on `doc`; `minLen` 0 allows a caret. */
function shapeRange(doc: SeqDocument, at: number, len: number, minLen: number) {
  const L = doc.length;
  const start = L === 0 ? 0 : at % L;
  const maxLen = doc.isCircular ? L : L - start;
  const cap = Math.min(maxLen, 30);
  const n = cap < minLen ? -1 : minLen + (len % (cap - minLen + 1));
  // Now and then take everything that is left, to cover whole-sequence edits.
  const size = len % 17 === 0 && maxLen >= minLen ? maxLen : n;
  return size < 0 ? null : { start, end: start + size };
}

let idCounter = 0;
/** Fresh ids, since pasted and added features must not clash with existing ones. */
export function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

/** Turns a shape into a concrete op on `doc`, or null when it makes no sense there. */
export function resolveOp(doc: SeqDocument, shape: OpShape): EditOp | null {
  const L = doc.length;
  switch (shape.kind) {
    case 'insert':
      return { type: 'insert', position: shape.at % (L + 1), text: shape.text };
    case 'delete': {
      const range = shapeRange(doc, shape.at, shape.len, 1);
      return range === null ? null : { type: 'delete', range };
    }
    case 'replace': {
      const range = shapeRange(doc, shape.at, shape.len, 0);
      return range === null ? null : { type: 'replace', range, text: shape.text };
    }
    case 'paste': {
      const range = shapeRange(doc, shape.at, shape.len, 0);
      if (range === null) return null;
      // The clipboard never carries annotations without bases.
      const features = (shape.text === '' ? [] : shape.features).flatMap((f) => {
        const laid = layFeature(f, freshId('p'), shape.text.length, 'linear');
        return laid === null ? [] : [laid];
      });
      const fragment: SeqFragment = { sequence: shape.text, features };
      return { type: 'insertFragment', range, fragment };
    }
    case 'reverseComplement':
      return { type: 'reverseComplement' };
    case 'setOrigin':
      return doc.isCircular && L > 0 ? { type: 'setOrigin', position: shape.at % (L + 1) } : null;
    case 'toggleTopology':
      return { type: 'setTopology', topology: doc.isCircular ? 'linear' : 'circular' };
    case 'addFeature': {
      const feature = layFeature(shape.feature, freshId('a'), L, doc.topology);
      return feature === null ? null : { type: 'addFeature', feature };
    }
  }
}

// ---------------------------------------------------------------- reference model

/**
 * The reference: a plain array of bases, each carrying an identity that
 * travels with it. Edits are done the obvious way with `splice`, so the
 * model is easy to trust, and identities let a test say exactly which
 * original bases a feature covers after any number of edits.
 */
export interface Cell {
  readonly id: number;
  readonly base: string;
}

export interface ModelStep {
  /** Identities of cells removed by the op. */
  readonly deleted: ReadonlySet<number>;
  /** Identities of cells the op created, in sequence order. */
  readonly inserted: readonly number[];
  /** True when the op reversed the molecule (reverse complement). */
  readonly reversed: boolean;
}

export class RefModel {
  private nextId = 0;
  cells: Cell[];
  topology: Topology;
  /** The cells as they stood before the last deletion. */
  private lastCells: readonly Cell[] = [];

  constructor(sequence: string, topology: Topology) {
    this.cells = Array.from(sequence).map((base) => this.cell(base));
    this.topology = topology;
  }

  /** An independent copy that goes on numbering where this one stands. */
  clone(): RefModel {
    const copy = new RefModel('', this.topology);
    copy.cells = [...this.cells];
    copy.nextId = this.nextId;
    return copy;
  }

  private cell(base: string): Cell {
    const c = { id: this.nextId, base };
    this.nextId += 1;
    return c;
  }

  get text(): string {
    return this.cells.map((c) => c.base).join('');
  }

  get length(): number {
    return this.cells.length;
  }

  /** Cell identities covered by `feature`, segment by segment, in coordinate order. */
  covered(feature: Feature): number[] {
    return this.coveredBySegment(feature).flat();
  }

  /** The same, kept apart per range segment. */
  coveredBySegment(feature: Feature): number[][] {
    const L = this.cells.length;
    const out: number[][] = [];
    for (const seg of feature.segments) {
      if (seg.kind !== 'range') continue;
      const ids: number[] = [];
      for (let i = seg.start; i < seg.end; i++) ids.push(this.at(i % L).id);
      out.push(ids);
    }
    return out;
  }

  private at(i: number): Cell {
    const c = this.cells[i];
    if (c === undefined) throw new Error(`no cell at ${i}`);
    return c;
  }

  /** Identity of the cell just before the one at index `i`, cyclically on a circle. */
  leftOf(i: number): number | undefined {
    const L = this.cells.length;
    if (i > 0) return this.cells[i - 1]?.id;
    return this.topology === 'circular' && L > 0 ? this.cells[L - 1]?.id : undefined;
  }

  private insertAt(position: number, text: string): number[] {
    const p = normalizePosition(position, this.cells.length, this.topology);
    const fresh = Array.from(text).map((b) => this.cell(b));
    this.cells.splice(p, 0, ...fresh);
    return fresh.map((c) => c.id);
  }

  private deleteRange(start: number, end: number): Set<number> {
    const L = this.cells.length;
    const doomed = new Set<number>();
    for (let i = start; i < end; i++) doomed.add(this.at(i % L).id);
    this.lastCells = this.cells;
    this.cells = this.cells.filter((c) => !doomed.has(c.id));
    return doomed;
  }

  apply(op: EditOp): ModelStep {
    const none: ModelStep = { deleted: new Set(), inserted: [], reversed: false };
    switch (op.type) {
      case 'insert':
        return { ...none, inserted: this.insertAt(op.position, op.text) };
      case 'delete':
        return { ...none, deleted: this.deleteRange(op.range.start, op.range.end) };
      case 'replace': {
        // Overwrite the common prefix in place (the bases keep their identity,
        // as annotations over them must not move), then insert or delete the
        // difference right after it.
        const L = this.cells.length;
        const oldLen = op.range.end - op.range.start;
        const common = Math.min(oldLen, op.text.length);
        for (let i = 0; i < common; i++) {
          const idx = (op.range.start + i) % L;
          this.cells[idx] = { id: this.at(idx).id, base: op.text.charAt(i) };
        }
        const pivot =
          this.topology === 'circular' && L > 0
            ? (op.range.start + common) % L
            : op.range.start + common;
        if (op.text.length > oldLen)
          return { ...none, inserted: this.insertAt(pivot, op.text.slice(common)) };
        if (oldLen > op.text.length)
          return { ...none, deleted: this.deleteRange(pivot, pivot + oldLen - common) };
        return none;
      }
      case 'insertFragment': {
        // The paste lands where the range's first base was, counted in the
        // bases that survive the deletion (wrapping to 0 on a circle).
        const L = this.cells.length;
        const start = L === 0 ? 0 : op.range.start % L;
        const deleted = this.deleteRange(op.range.start, op.range.end);
        const oldCells = this.lastCells;
        let p = oldCells.slice(0, start).filter((c) => !deleted.has(c.id)).length;
        const left = this.cells.length;
        if (this.topology === 'circular') p = left === 0 ? 0 : p % left;
        const fresh = Array.from(op.fragment.sequence).map((b) => this.cell(b));
        this.cells.splice(p, 0, ...fresh);
        return { ...none, deleted, inserted: fresh.map((c) => c.id) };
      }
      case 'reverseComplement':
        this.cells = this.cells
          .reverse()
          .map((c) => ({ id: c.id, base: reverseComplement(c.base) }));
        return { ...none, reversed: true };
      case 'setOrigin': {
        const p = normalizePosition(op.position, this.cells.length, this.topology);
        this.cells = [...this.cells.slice(p), ...this.cells.slice(0, p)];
        return none;
      }
      case 'setTopology':
        this.topology = op.topology;
        return none;
      // The rest touch no bases. (`bluntEnds` would, but the documents
      // generated here have no sticky ends, so it leaves them alone.)
      case 'setEnds':
      case 'bluntEnds':
      case 'rename':
      case 'setMetadata':
      case 'addFeature':
      case 'updateFeature':
      case 'removeFeature':
        return none;
    }
  }
}

// ---------------------------------------------------------------- the check

function sameIds(actual: readonly number[], expected: readonly number[], what: string): void {
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${what}: covers [${actual.join(',')}], expected [${expected.join(',')}]`);
  }
}

/**
 * Checks one edit, `before` → `after` by `op`, against the reference model
 * (already advanced by `step`), and throws on the first thing wrong:
 *
 * 1. the sequence equals the model's, letter for letter, and so does the topology;
 * 2. every segment lies on the sequence;
 * 3. every feature that was there covers exactly the bases it covered, less
 *    the deleted ones (reversed by a reverse complement), is dropped exactly
 *    when none are left, keeps its type and flips strand only on a reverse
 *    complement;
 * 4. inserted bases join a feature exactly when they land between two
 *    adjacent bases of one of its segments (or anywhere in a segment that
 *    goes all the way round a circle), as one run, in order, in that gap;
 * 5. pasted and added features read what they read before.
 *
 * `coveredBefore` is `model.coveredBySegment` of every feature of `before`,
 * taken before the model was advanced.
 */
export function checkEdit(
  before: SeqDocument,
  after: SeqDocument,
  op: EditOp,
  model: RefModel,
  step: ModelStep,
  coveredBefore: ReadonlyMap<string, readonly (readonly number[])[]>,
): void {
  if (after.sequence.toString() !== model.text) {
    throw new Error(`sequence ${after.sequence.toString()}, expected ${model.text}`);
  }
  if (after.topology !== model.topology) throw new Error(`topology ${after.topology}`);
  for (const f of after.features) {
    for (const seg of f.segments) {
      if (!isValidSegment(seg, after.length, after.topology)) {
        throw new Error(`${f.id}: segment ${JSON.stringify(seg)} is off the sequence`);
      }
    }
  }

  const inserted = new Set(step.inserted);
  const first = step.inserted[0];
  const firstIndex = first === undefined ? -1 : model.cells.findIndex((c) => c.id === first);
  const left = firstIndex < 0 ? undefined : model.leftOf(firstIndex);
  const rightIndex = firstIndex + step.inserted.length;
  const right =
    firstIndex < 0 || (model.topology === 'linear' && rightIndex >= model.length)
      ? undefined
      : model.cells[rightIndex % model.length]?.id;
  const lengthBeforeInsert = model.length - step.inserted.length;

  for (const f of before.features) {
    let segments = (coveredBefore.get(f.id) ?? [])
      .map((ids) => ids.filter((id) => !step.deleted.has(id)))
      .filter((ids) => ids.length > 0);
    if (step.reversed) segments = segments.reverse().map((ids) => [...ids].reverse());
    const core = segments.flat();
    const found = after.getFeature(f.id);
    const isSite = f.segments.every((s) => s.kind === 'site');
    if (core.length === 0 && !isSite) {
      if (found !== undefined) throw new Error(`${f.id} lost every base but survived`);
      continue;
    }
    if (found === undefined) throw new Error(`${f.id} was dropped though bases remain`);
    if (found.type !== f.type) throw new Error(`${f.id}: type changed to ${found.type}`);
    const strand = step.reversed ? flipStrand(f.strand) : f.strand;
    if (found.strand !== strand) throw new Error(`${f.id}: strand ${found.strand}`);

    const covered = model.covered(found);
    sameIds(
      covered.filter((id) => !inserted.has(id)),
      core,
      f.id,
    );
    const grown = covered.filter((id) => inserted.has(id));
    const shouldGrow =
      step.inserted.length > 0 &&
      segments.some(
        (ids) =>
          (model.topology === 'circular' && ids.length === lengthBeforeInsert) ||
          (left !== undefined &&
            right !== undefined &&
            ids.some((id, i) => id === left && ids[i + 1] === right)),
      );
    if (shouldGrow !== grown.length > 0) {
      throw new Error(
        `${f.id} ${shouldGrow ? 'should have grown' : 'grew'} on an insertion between ${String(left)} and ${String(right)}: covers [${covered.join(',')}]`,
      );
    }
    if (grown.length > 0) {
      sameIds(grown, step.inserted, `${f.id} growth`);
      const at = covered.indexOf(first ?? -1);
      sameIds(covered.slice(at, at + grown.length), step.inserted, `${f.id} run`);
      if (at > 0 && covered[at - 1] !== left)
        throw new Error(`${f.id}: run not after ${String(left)}`);
      const next = covered[at + grown.length];
      if (next !== undefined && next !== right)
        throw new Error(`${f.id}: run not before ${String(right)}`);
    }
  }

  if (op.type === 'insertFragment') {
    const fragment = SeqDocument.create({
      sequence: op.fragment.sequence,
      features: op.fragment.features,
    });
    for (const f of op.fragment.features) {
      if (after.featureSequence(f.id) !== fragment.featureSequence(f)) {
        throw new Error(`pasted ${f.id} reads ${after.featureSequence(f.id)}`);
      }
      for (const id of model.covered(after.requireFeature(f.id))) {
        if (!inserted.has(id))
          throw new Error(`pasted ${f.id} covers a base it was not pasted with`);
      }
    }
  }
  if (
    op.type === 'addFeature' &&
    after.featureSequence(op.feature.id) !== before.featureSequence(op.feature)
  ) {
    throw new Error(`added ${op.feature.id} reads ${after.featureSequence(op.feature.id)}`);
  }
}
