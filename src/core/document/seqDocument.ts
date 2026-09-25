import {
  type Feature,
  type FeatureId,
  FeatureSet,
  assertValidSegment,
  closeSiteOnCircle,
  eachSegment,
  flipSegment,
  flipStrand,
  moveFeature,
  rotateSegment,
  shiftFeature,
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
import { type BaseStylePatch, BaseStyles, type StyleRun } from './baseStyles';
import { type BluntMethod, type CaseMode, type EditOp, type FeaturePatch } from './editOp';
import {
  type DocumentEnds,
  BLUNT_END,
  endsEqual,
  flipEnds,
  flipWindow,
  isSameWindow,
  normalizeEnds,
  topStrandOverhang,
} from './ends';
import { type SeqFragment } from './fragment';
import { type DocumentMetadata, EMPTY_METADATA } from './metadata';
import { type SequencingRead, assertValidRead, reverseComplementRead } from './read';
import {
  type HostMethylationState,
  METHYLATED_HOST,
  methylationEqual,
} from '../analysis/methylation';

export interface SeqDocumentInit {
  readonly name?: string;
  readonly sequence: string | SequenceText;
  readonly topology?: Topology;
  readonly features?: Iterable<Feature> | FeatureSet;
  readonly metadata?: Partial<DocumentMetadata>;
  /** Shape of the two ends; see `ends.ts`. Ignored for a circular sequence. */
  readonly ends?: DocumentEnds | null;
  /** Qualities and trace of a sequencing read, one quality per base. */
  readonly read?: SequencingRead | null;
  /** Where the DNA was grown, for the enzymes its methylation blocks (#45). */
  readonly methylation?: HostMethylationState;
  /** How runs of bases are drawn (#89); see `baseStyles.ts`. */
  readonly styles?: BaseStyles | readonly StyleRun[];
}

interface SeqDocumentFields {
  readonly name: string;
  readonly sequence: SequenceText;
  readonly topology: Topology;
  readonly features: FeatureSet;
  readonly metadata: DocumentMetadata;
  readonly ends: DocumentEnds | null;
  readonly read: SequencingRead | null;
  readonly methylation: HostMethylationState;
  readonly styles: BaseStyles;
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
  /**
   * The shape of the two ends of a linear molecule, once something has made
   * them other than plain and blunt — a digest, or a ligation of sticky
   * fragments. Null for a circular sequence, which has no ends, and for a
   * linear one with nothing to say about them.
   */
  readonly ends: DocumentEnds | null;
  /**
   * The qualities and trace of the sequencing read this document was opened
   * from (AB1, FASTQ), or null. Kept while the bases are the read's own: an
   * edit that brings new bases drops it (`with`), and reverse complement
   * turns it over with them.
   */
  readonly read: SequencingRead | null;

  /**
   * The methylation the DNA carries from wherever it was grown, which
   * decides which restriction sites will not cut (`core/analysis/
   * methylation.ts`). An ordinary laboratory strain by default, since that
   * is where a plasmid comes from; what a PCR makes sets it to none.
   */
  readonly methylation: HostMethylationState;

  /**
   * The colours, highlights, bold and sizes the user gave runs of bases
   * (#89, #91). They go where their bases go: an edit moves them as it
   * moves the features.
   */
  readonly styles: BaseStyles;

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
    const read = init.read ?? null;
    if (read !== null) assertValidRead(read, sequence.length);
    const styles =
      init.styles instanceof BaseStyles
        ? BaseStyles.from(init.styles.runs, sequence.length)
        : BaseStyles.from(init.styles ?? [], sequence.length);
    return new SeqDocument({
      name: init.name ?? 'Untitled',
      sequence,
      topology,
      features,
      metadata: { ...EMPTY_METADATA, ...init.metadata },
      ends: normalizeEnds(init.ends, topology),
      read,
      methylation: init.methylation ?? METHYLATED_HOST,
      styles,
    });
  }

  private constructor(fields: SeqDocumentFields) {
    this.name = fields.name;
    this.sequence = fields.sequence;
    this.topology = fields.topology;
    this.features = fields.features;
    this.metadata = fields.metadata;
    this.ends = fields.ends;
    this.read = fields.read;
    this.methylation = fields.methylation;
    this.styles = fields.styles;
  }

  get length(): number {
    return this.sequence.length;
  }

  get isCircular(): boolean {
    return this.topology === 'circular';
  }

  private with(patch: Partial<SeqDocumentFields>): SeqDocument {
    const topology = patch.topology ?? this.topology;
    // `ends` is nullable, so an explicit null has to be told apart from "not
    // in the patch"; every other field can use ??.
    const ends = 'ends' in patch ? patch.ends : this.ends;
    // New bases leave the read describing bases that are no longer there.
    const read = 'read' in patch ? patch.read : patch.sequence === undefined ? this.read : null;
    return new SeqDocument({
      name: patch.name ?? this.name,
      sequence: patch.sequence ?? this.sequence,
      topology,
      features: patch.features ?? this.features,
      metadata: patch.metadata ?? this.metadata,
      ends: normalizeEnds(ends, topology),
      read: read ?? null,
      methylation: patch.methylation ?? this.methylation,
      styles: patch.styles ?? this.styles,
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
      case 'setEnds':
        return this.setEnds(op.ends);
      case 'bluntEnds':
        return this.bluntEnds(op.method);
      case 'setMethylation':
        return this.setMethylation(op.methylation);
      case 'styleBases':
        return this.styleBases(op.range, op.style);
      case 'changeCase':
        return this.changeCase(op.range, op.mode);
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
        moveFeature(
          f,
          this,
          { length: oldLength + count, topology: this.topology },
          eachSegment((seg) => {
            const moved = shiftSegmentForInsert(seg, p, count, oldLength, this.topology);
            return this.isCircular ? closeSiteOnCircle(moved, oldLength + count) : moved;
          }),
        ),
      ),
      ends: this.endsAfterEdit({ start: p, end: p }),
      styles: this.styles.insert(p, count),
    });
  }

  /** Deletes the bases in `r`. Features losing all their bases are removed. */
  delete(r: Range): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    if (isEmptyRange(r)) return this;
    const oldLength = this.length;
    let sequence = this.sequence;
    let styles = this.styles;
    // Remove the head piece (higher coordinates) first so the tail piece's
    // coordinates stay valid.
    for (const piece of rangePieces(r, oldLength)) {
      sequence = sequence.remove(piece.start, piece.end);
      styles = styles.delete(piece.start, piece.end);
    }
    return this.with({
      sequence,
      features: this.features.map((f) =>
        moveFeature(
          f,
          this,
          { length: sequence.length, topology: this.topology },
          eachSegment((seg) => {
            const moved = shiftSegmentForDelete(seg, r, oldLength);
            return moved !== null && this.isCircular
              ? closeSiteOnCircle(moved, sequence.length)
              : moved;
          }),
        ),
      ),
      ends: this.endsAfterEdit(r),
      styles,
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
    // Worked out before anything moves, and applied at the end: the steps
    // below would each judge only their own part of the replacement, and
    // `substitute` changes bases without moving anything at all.
    const ends = this.endsAfterEdit(r);
    const withEnds = (doc: SeqDocument): SeqDocument =>
      endsEqual(doc.ends, ends) ? doc : doc.with({ ends });
    const doc = common > 0 ? this.substitute(r.start, text.slice(0, common)) : this;
    // First position after the substituted prefix, wrapped for circular sequences.
    const pivot =
      doc.isCircular && doc.length > 0 ? (r.start + common) % doc.length : r.start + common;
    if (text.length > oldLen) {
      return withEnds(doc.insert(pivot, text.slice(common)));
    }
    if (oldLen > text.length) {
      return withEnds(doc.delete({ start: pivot, end: pivot + (oldLen - common) }));
    }
    return withEnds(doc);
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
    // The pasted bases look as they did where they were copied, not like
    // the run they landed in.
    const end = p + fragment.sequence.length;
    doc = doc.with({ styles: doc.styles.replaceWithin(p, end, fragment.styles ?? []) });
    const from = { length: fragment.sequence.length, topology: 'linear' } as const;
    for (const f of fragment.features) {
      const shifted = shiftFeature(f, p, from, doc);
      // A site at the fragment's far end can land on the end of a circle.
      const length = doc.length;
      doc = doc.addFeature(
        doc.isCircular
          ? { ...shifted, segments: shifted.segments.map((seg) => closeSiteOnCircle(seg, length)) }
          : shifted,
      );
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
    const doc = this.onBottomStrand();
    const length = doc.length;
    return doc.with({
      ends: flipEnds(doc.ends),
      read: doc.read === null ? null : reverseComplementRead(doc.read),
      sequence: Rope.from(reverseComplement(doc.sequence.toString())),
      styles: doc.styles.reverse(length),
      features: doc.features.map((f) =>
        moveFeature(f, doc, doc, (loc) => ({
          strand: flipStrand(loc.strand),
          segments: [...loc.segments]
            .reverse()
            .map((seg) => flipSegment(seg, length, doc.topology)),
        })),
      ),
    });
  }

  /**
   * The same molecule with `sequence` written over the bases the *bottom*
   * strand covers, which is the window the new top strand will read once it
   * is reverse-complemented (`flipWindow` in `ends.ts` says why it moves).
   *
   * So a sticky-ended molecule comes out of a flip a different length: the
   * bases a bottom-strand overhang carries arrive, and the ones only the old
   * top strand had leave, taking any annotation on them with them. Nothing
   * about the molecule changes here, only which of its two strands is being
   * written out.
   */
  private onBottomStrand(): SeqDocument {
    const window = flipWindow(this.ends);
    if (isSameWindow(window)) return this;
    const { head, tail, trimStart, trimEnd } = window;
    // Each step is a no-op when its end has nothing to move, so all four run.
    const framed = this.insert(this.length, tail).insert(0, head);
    const trimmed = framed
      .delete({ start: framed.length - trimEnd, end: framed.length })
      .delete({ start: 0, end: trimStart });
    // Every one of those edits reached a tip and so blunted the end it
    // reached; the molecule itself is the one it was.
    return trimmed.with({ ends: this.ends });
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
      styles: this.styles.rotate(p, length),
      features: this.features.map((f) =>
        moveFeature(
          f,
          this,
          this,
          eachSegment((seg) => rotateSegment(seg, p, length)),
        ),
      ),
    });
  }

  /**
   * Changes topology. Making a circular sequence linear splits any segment
   * that wraps the origin into two segments (a GenBank `join`).
   */
  setTopology(topology: Topology): SeqDocument {
    if (topology === this.topology) return this;
    const length = this.length;
    if (topology === 'circular') {
      // Closing the molecule leaves no ends to describe; `with` drops them.
      return this.with({
        topology,
        features: this.features.map((f) =>
          moveFeature(
            f,
            this,
            { length, topology },
            eachSegment((seg) => closeSiteOnCircle(seg, length)),
          ),
        ),
      });
    }
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

  /**
   * The bases in `r` (which may run over the origin) written in upper or
   * lower case, or each swapped (#90). The bases are the same ones, so
   * features, styles, the ends and a read's qualities all stay; only the
   * letters differ.
   */
  changeCase(r: Range, mode: CaseMode): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    let sequence = this.sequence;
    for (const piece of rangePieces(r, this.length)) {
      const before = sequence.slice(piece.start, piece.end);
      const after = withCase(before, mode);
      if (after !== before) {
        sequence = sequence.remove(piece.start, piece.end).insert(piece.start, after);
      }
    }
    return sequence === this.sequence ? this : this.with({ sequence, read: this.read });
  }

  /**
   * `patch` applied to the style of every base in `r`, which may run over
   * the origin of a circle (#89).
   */
  styleBases(r: Range, patch: BaseStylePatch): SeqDocument {
    assertValidRange(r, this.length, this.topology);
    let styles = this.styles;
    for (const piece of rangePieces(r, this.length))
      styles = styles.restyle(piece.start, piece.end, patch);
    return styles.equals(this.styles) ? this : this.with({ styles });
  }

  /** Says where the DNA was grown, which decides what its methylation blocks. */
  setMethylation(methylation: HostMethylationState): SeqDocument {
    return methylationEqual(methylation, this.methylation) ? this : this.with({ methylation });
  }

  /** Gives the document the qualities and trace of the read it is (or none). */
  setRead(read: SequencingRead | null): SeqDocument {
    if (read === this.read) return this;
    if (read !== null) assertValidRead(read, this.length);
    return this.with({ read });
  }

  /**
   * Describes the ends of a linear molecule (see `ends.ts`). Blunt ends with
   * no enzyme, or any ends on a circular sequence, are stored as none.
   */
  setEnds(ends: DocumentEnds | null): SeqDocument {
    const next = normalizeEnds(ends, this.topology);
    return endsEqual(next, this.ends) ? this : this.with({ ends: next });
  }

  /**
   * Makes both ends blunt, as `method` does on the bench (`BluntMethod`).
   *
   * Which bases change depends on which strand is the longer one at each end
   * (`ends.ts`): the top strand's own overhang bases are in the sequence, the
   * bottom strand's are not. So a 5′ overhang on the left is already in the
   * sequence, and filling in only pairs it, while trimming deletes it; a 5′
   * overhang on the right hangs off the bottom strand, and filling it in
   * extends the sequence by it. A 3′ overhang is chewed back either way,
   * which deletes it from the sequence on the right and removes nothing of
   * the sequence on the left. The right end goes first, so the left end's
   * deletion does not move it.
   */
  bluntEnds(method: BluntMethod): SeqDocument {
    const ends = this.ends;
    if (ends === null || this.isCircular) return this;
    const { left, right } = ends;
    const afterRight =
      right.kind === "3'"
        ? this.delete({ start: Math.max(0, this.length - right.overhang.length), end: this.length })
        : right.kind === "5'" && method === 'fill'
          ? this.insert(this.length, right.overhang)
          : this;
    const doc =
      left.kind === "5'" && method === 'trim'
        ? afterRight.delete({ start: 0, end: Math.min(left.overhang.length, afterRight.length) })
        : afterRight;
    return doc.setEnds(null);
  }

  /**
   * How many bases `bluntEnds` removes from the start of the sequence: the
   * one case that moves every position.
   */
  bluntShift(method: BluntMethod): number {
    const left = this.ends?.left;
    return left?.kind === "5'" && method === 'trim' && !this.isCircular ? left.overhang.length : 0;
  }

  /**
   * The ends after an edit over `r`. An edit in the middle leaves them
   * alone; one that reaches the tip of the molecule — the single-stranded
   * bases of an overhang, or the very first or last base pair — leaves an
   * end that is no longer the one the enzyme made, so that end goes back to
   * being an undescribed blunt one rather than a lie.
   */
  private endsAfterEdit(r: Range): DocumentEnds | null {
    const ends = this.ends;
    if (ends === null) return null;
    const left = r.start <= topStrandOverhang(ends.left, 'left') ? BLUNT_END : ends.left;
    const right =
      r.end >= this.length - topStrandOverhang(ends.right, 'right') ? BLUNT_END : ends.right;
    return { left, right };
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
    if (op.type === 'bluntEnds') {
      const shifted = position - this.bluntShift(op.method);
      return Math.max(0, Math.min(shifted, this.bluntEnds(op.method).length));
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

/** `text` in the case `mode` asks for. */
function withCase(text: string, mode: CaseMode): string {
  if (mode === 'upper') return text.toUpperCase();
  if (mode === 'lower') return text.toLowerCase();
  let out = '';
  for (const ch of text) {
    const upper = ch.toUpperCase();
    out += ch === upper ? ch.toLowerCase() : upper;
  }
  return out;
}

function validateFeature(feature: Feature, seqLength: number, topology: Topology): void {
  if (feature.segments.length === 0) {
    throw new RangeError(`Feature "${feature.name}" (${feature.id}) has no segments`);
  }
  for (const seg of feature.segments) assertValidSegment(seg, seqLength, topology);
}
