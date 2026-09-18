import {
  type Feature,
  type FeatureId,
  type Segment,
  FeatureSet,
  assertValidSegment,
  flipSegment,
  flipStrand,
  rotateSegment,
  shiftSegmentBy,
  shiftSegmentForDelete,
  shiftSegmentForInsert,
  splitWrappedSegment,
} from '../features';
import {
  type Range,
  type Topology,
  assertValidPosition,
  assertValidRange,
  isEmptyRange,
  normalizePosition,
  rangeLength,
  rangePieces,
  shiftPositionForDelete,
} from '../range';
import { type SequenceText, Rope, assertValidSequence, reverseComplement } from '../sequence';
import { type EditOp, type FeaturePatch } from './editOp';
import { type SeqFragment } from './fragment';
import { type DocumentMetadata, EMPTY_METADATA } from './metadata';

export interface SeqDocumentInit {
  readonly name?: string;
  readonly sequence: string | SequenceText;
  readonly topology?: Topology;
  readonly features?: Iterable<Feature> | FeatureSet;
  readonly metadata?: Partial<DocumentMetadata>;
}

interface SeqDocumentFields {
  readonly name: string;
  readonly sequence: SequenceText;
  readonly topology: Topology;
  readonly features: FeatureSet;
  readonly metadata: DocumentMetadata;
}

/**
 * An immutable DNA sequence document: sequence text, topology and annotated
 * features. Every edit returns a new document and leaves this one intact, so
 * undo is just "keep the previous instance". Sequence storage is a persistent
 * rope and feature sets share structure, so keeping many versions is cheap.
 *
 * Coordinates: 0-based half-open unrolled ranges everywhere (see `Range`).
 */
export class SeqDocument {
  readonly name: string;
  readonly sequence: SequenceText;
  readonly topology: Topology;
  readonly features: FeatureSet;
  readonly metadata: DocumentMetadata;

  static create(init: SeqDocumentInit): SeqDocument {
    let sequence: SequenceText;
    if (typeof init.sequence === 'string') {
      assertValidSequence(init.sequence);
      sequence = Rope.from(init.sequence);
    } else {
      sequence = init.sequence;
    }
    const topology = init.topology ?? 'linear';
    const features =
      init.features instanceof FeatureSet ? init.features : FeatureSet.from(init.features ?? []);
    for (const f of features) validateFeature(f, sequence.length, topology);
    return new SeqDocument({
      name: init.name ?? 'Untitled',
      sequence,
      topology,
      features,
      metadata: { ...EMPTY_METADATA, ...init.metadata },
    });
  }

  private constructor(fields: SeqDocumentFields) {
    this.name = fields.name;
    this.sequence = fields.sequence;
    this.topology = fields.topology;
    this.features = fields.features;
    this.metadata = fields.metadata;
  }

  get length(): number {
    return this.sequence.length;
  }

  get isCircular(): boolean {
    return this.topology === 'circular';
  }

  private with(patch: Partial<SeqDocumentFields>): SeqDocument {
    return new SeqDocument({
      name: patch.name ?? this.name,
      sequence: patch.sequence ?? this.sequence,
      topology: patch.topology ?? this.topology,
      features: patch.features ?? this.features,
      metadata: patch.metadata ?? this.metadata,
    });
  }

  // ---------------------------------------------------------------- reading

  /** Bases covered by `r`, following the sequence around the origin if needed. */
  subsequence(r: Range): string {
    assertValidRange(r, this.length, this.topology);
    return rangePieces(r, this.length)
      .map((piece) => this.sequence.slice(piece.start, piece.end))
      .join('');
  }

  /**
   * Biological sequence of a feature: its range segments concatenated in
   * order, reverse-complemented for reverse-strand features.
   */
  featureSequence(featureOrId: Feature | FeatureId): string {
    const feature =
      typeof featureOrId === 'string' ? this.requireFeature(featureOrId) : featureOrId;
    let text = '';
    for (const seg of feature.segments) {
      if (seg.kind === 'range') text += this.subsequence(seg);
    }
    return feature.strand === 'reverse' ? reverseComplement(text) : text;
  }

  getFeature(id: FeatureId): Feature | undefined {
    return this.features.get(id);
  }

  requireFeature(id: FeatureId): Feature {
    const f = this.features.get(id);
    if (f === undefined) throw new Error(`Unknown feature id "${id}"`);
    return f;
  }

  // ---------------------------------------------------------------- editing

  apply(op: EditOp): SeqDocument {
    switch (op.type) {
      case 'insert':
        return this.insert(op.position, op.text);
      case 'delete':
        return this.delete(op.range);
      case 'replace':
        return this.replace(op.range, op.text);
      case 'insertFragment':
        return this.insertFragment(op.range, op.fragment);
      case 'reverseComplement':
        return this.reverseComplement();
      case 'setOrigin':
        return this.setOrigin(op.position);
      case 'setTopology':
        return this.setTopology(op.topology);
      case 'rename':
        return this.rename(op.name);
      case 'setMetadata':
        return this.setMetadata(op.patch);
      case 'addFeature':
        return this.addFeature(op.feature);
      case 'updateFeature':
        return this.updateFeature(op.id, op.patch);
      case 'removeFeature':
        return this.removeFeature(op.id);
    }
  }

  rename(name: string): SeqDocument {
    return name === this.name ? this : this.with({ name });
  }

  setMetadata(patch: Partial<DocumentMetadata>): SeqDocument {
    return this.with({ metadata: { ...this.metadata, ...patch } });
  }

  /** Inserts `text` before the base at `position`. `text` must be valid IUPAC. */
  insert(position: number, text: string): SeqDocument {
    assertValidPosition(position, this.length, this.topology);
    assertValidSequence(text);
    if (text.length === 0) return this;
    const p = normalizePosition(position, this.length, this.topology);
    const count = text.length;
    const oldLength = this.length;
    return this.with({
      sequence: this.sequence.insert(p, text),
      features: this.features.map((f) =>
        mapSegments(f, (seg) => shiftSegmentForInsert(seg, p, count, oldLength, this.topology)),
      ),
    });
  }

  /** Deletes the bases in `r`. Features losing all their bases are removed. */
  delete(r: Range): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    if (isEmptyRange(r)) return this;
    const oldLength = this.length;
    let sequence = this.sequence;
    // Remove the head piece (higher coordinates) first so the tail piece's
    // coordinates stay valid.
    for (const piece of rangePieces(r, oldLength))
      sequence = sequence.remove(piece.start, piece.end);
    return this.with({
      sequence,
      features: this.features.map((f) =>
        mapSegments(f, (seg) => shiftSegmentForDelete(seg, r, oldLength)),
      ),
    });
  }

  /**
   * Replaces the bases in `r` with `text`.
   *
   * The common prefix is substituted in place (no coordinate changes), then
   * the length difference is inserted or deleted right after it. So
   * replacing bases inside a feature keeps the feature covering the new
   * text, and same-length replacement never moves any annotation.
   */
  replace(r: Range, text: string): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    assertValidSequence(text);
    const oldLen = rangeLength(r);
    const common = Math.min(oldLen, text.length);
    const doc = common > 0 ? this.substitute(r.start, text.slice(0, common)) : this;
    // First position after the substituted prefix, wrapped for circular sequences.
    const pivot =
      doc.isCircular && doc.length > 0 ? (r.start + common) % doc.length : r.start + common;
    if (text.length > oldLen) {
      return doc.insert(pivot, text.slice(common));
    }
    if (oldLen > text.length) {
      return doc.delete({ start: pivot, end: pivot + (oldLen - common) });
    }
    return doc;
  }

  /**
   * Removes the bases in `r` (nothing for a caret) and puts the fragment's
   * sequence there, then adds its features shifted to the paste position.
   * Feature ids come from the fragment, so callers pasting the same fragment
   * twice must give it fresh ids first.
   */
  insertFragment(r: Range, fragment: SeqFragment): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    assertValidSequence(fragment.sequence);
    const removed = this.delete(r);
    const p = removed.pastePosition(this, r);
    if (fragment.sequence.length === 0) return removed;
    let doc = removed.insert(p, fragment.sequence);
    for (const f of fragment.features) {
      doc = doc.addFeature({ ...f, segments: f.segments.map((seg) => shiftSegmentBy(seg, p)) });
    }
    return doc;
  }

  /** Where `r.start` of `before` lands in this document once `r` has been deleted from it. */
  private pastePosition(before: SeqDocument, r: Range): number {
    if (this.length === 0) return 0;
    const start = normalizePosition(r.start, before.length, before.topology);
    const moved = shiftPositionForDelete(start, r, before.length);
    return this.isCircular ? moved % this.length : Math.min(moved, this.length);
  }

  /** Same-length overwrite starting at `position`; never moves annotations. */
  private substitute(position: number, text: string): SeqDocument {
    const p = normalizePosition(position, this.length, this.topology);
    let sequence = this.sequence;
    let offset = 0;
    for (const piece of rangePieces({ start: p, end: p + text.length }, this.length)) {
      const len = rangeLength(piece);
      sequence = sequence
        .remove(piece.start, piece.end)
        .insert(piece.start, text.slice(offset, offset + len));
      offset += len;
    }
    return this.with({ sequence });
  }

  /** Reverse-complements the whole sequence; features flip strand and position. */
  reverseComplement(): SeqDocument {
    const length = this.length;
    return this.with({
      sequence: Rope.from(reverseComplement(this.sequence.toString())),
      features: this.features.map((f) => ({
        ...f,
        strand: flipStrand(f.strand),
        segments: [...f.segments].reverse().map((seg) => flipSegment(seg, length, this.topology)),
      })),
    });
  }

  /** Rotates a circular sequence so that the base at `position` becomes base 0. */
  setOrigin(position: number): SeqDocument {
    if (this.topology !== 'circular') {
      throw new Error('setOrigin is only defined for circular sequences');
    }
    assertValidPosition(position, this.length, this.topology);
    const p = normalizePosition(position, this.length, this.topology);
    if (p === 0) return this;
    const length = this.length;
    const text = this.sequence.toString();
    return this.with({
      sequence: Rope.from(text.slice(p) + text.slice(0, p)),
      features: this.features.map((f) => mapSegments(f, (seg) => rotateSegment(seg, p, length))),
    });
  }

  /**
   * Changes topology. Making a circular sequence linear splits any segment
   * that wraps the origin into two segments (a GenBank `join`).
   */
  setTopology(topology: Topology): SeqDocument {
    if (topology === this.topology) return this;
    if (topology === 'circular') return this.with({ topology });
    const length = this.length;
    return this.with({
      topology,
      features: this.features.map((f) => {
        const segments = f.segments.flatMap((seg) => splitWrappedSegment(seg, length));
        return segments.length === f.segments.length ? f : { ...f, segments };
      }),
    });
  }

  addFeature(feature: Feature): SeqDocument {
    validateFeature(feature, this.length, this.topology);
    return this.with({ features: this.features.add(feature) });
  }

  updateFeature(id: FeatureId, patch: FeaturePatch): SeqDocument {
    const existing = this.requireFeature(id);
    const updated: Feature = { ...existing, ...patch, id };
    validateFeature(updated, this.length, this.topology);
    return this.with({ features: this.features.replace(updated) });
  }

  removeFeature(id: FeatureId): SeqDocument {
    if (!this.features.has(id)) return this;
    return this.with({ features: this.features.remove(id) });
  }

  // ---------------------------------------------------------------- helpers

  /** Where a cursor at `position` ends up after `op`. Useful for the UI. */
  mapPositionThrough(op: EditOp, position: number): number {
    if (op.type === 'insert') {
      return position >= normalizePosition(op.position, this.length, this.topology)
        ? position + op.text.length
        : position;
    }
    if (op.type === 'delete') return shiftPositionForDelete(position, op.range, this.length);
    if (op.type === 'replace') {
      // Mirrors replace(): the common prefix is overwritten in place, then the
      // difference in length is inserted at, or deleted after, the pivot.
      const oldLen = rangeLength(op.range);
      const common = Math.min(oldLen, op.text.length);
      const pivot =
        this.isCircular && this.length > 0
          ? (op.range.start + common) % this.length
          : op.range.start + common;
      if (op.text.length > oldLen)
        return position >= pivot ? position + op.text.length - common : position;
      if (oldLen > op.text.length) {
        return shiftPositionForDelete(
          position,
          { start: pivot, end: pivot + (oldLen - common) },
          this.length,
        );
      }
      return position;
    }
    if (op.type === 'insertFragment') {
      const removed = this.delete(op.range);
      const p = removed.pastePosition(this, op.range);
      const moved = shiftPositionForDelete(position, op.range, this.length);
      return moved >= p ? moved + op.fragment.sequence.length : moved;
    }
    return position;
  }
}

function validateFeature(feature: Feature, seqLength: number, topology: Topology): void {
  if (feature.segments.length === 0) {
    throw new RangeError(`Feature "${feature.name}" (${feature.id}) has no segments`);
  }
  for (const seg of feature.segments) assertValidSegment(seg, seqLength, topology);
}

/** Rebuilds a feature's segments; drops the feature when none survive. */
function mapSegments(feature: Feature, fn: (seg: Segment) => Segment | null): Feature | null {
  const segments: Segment[] = [];
  let changed = false;
  for (const seg of feature.segments) {
    const next = fn(seg);
    if (next === null) {
      changed = true;
      continue;
    }
    if (next !== seg) changed = true;
    segments.push(next);
  }
  if (segments.length === 0) return null;
  return changed ? { ...feature, segments } : feature;
}
