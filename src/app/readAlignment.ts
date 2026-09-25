import {
  type Alignment,
  type AlignmentMode,
  type Range,
  type SequencingRead,
  type StrandedAlignment,
  columnQualities,
  reverseComplementRead,
  trimByQuality,
} from '@/core';

/**
 * One read aligned to one reference, the steps either side of the worker's
 * alignment: trimming the read and building what is sent (`prepare…`), and
 * turning the answer into what the Align tab shows (`finish…`). Shared by a
 * single alignment, by one whose document is the read (#57) and by a batch
 * of reads (#59), so the three cannot drift apart.
 */

/** A sequence to align as the read: its bases, and its qualities when it has them. */
export interface ReadInput {
  readonly sequence: string;
  readonly read: SequencingRead | null;
}

/** What the read is aligned to. */
export interface ReferenceInput {
  /** The reference's bases: the document, its selection, or the box's record. */
  readonly sequence: string;
  /** Where `sequence` starts in what the positions are numbered along. */
  readonly offset: number;
  /**
   * The reference's length when a read may run through its origin (a local
   * alignment against the whole of a circle), else null (#51).
   */
  readonly wrap: number | null;
}

export interface AlignmentJob {
  /** The first sequence sent: the reference, its start repeated past its end to wrap. */
  readonly a: string;
  /** The second: the read, trimmed. */
  readonly b: string;
  readonly reference: ReferenceInput;
  /** The read's whole length, before trimming. */
  readonly readLength: number;
  /** The stretch of the read kept, 0-based half-open. */
  readonly kept: { readonly start: number; readonly end: number };
  /** Bases trimmed from each end, or null when the read was not trimmed. */
  readonly trimmed: { readonly start: number; readonly end: number } | null;
  /** The kept stretch's qualities, or null without any. */
  readonly qualities: ArrayLike<number> | null;
  readonly read: SequencingRead | null;
}

export type Prepared =
  | { readonly ok: true; readonly job: AlignmentJob }
  | { readonly ok: false; readonly message: string };

/**
 * Trims the read (when it has qualities and `trimCutoff` is not null) and
 * builds the pair to align. Fails, saying why, for an empty read or one
 * with no stretch good enough to keep.
 */
export function prepareReadAlignment(
  reference: ReferenceInput,
  input: ReadInput,
  trimCutoff: number | null,
): Prepared {
  const full = input.sequence;
  if (full === '') return { ok: false, message: 'The read is empty.' };
  const all = input.read?.qualities ?? null;
  const trimming = all !== null && trimCutoff !== null;
  const kept = trimming ? trimByQuality(all, trimCutoff) : { start: 0, end: full.length };
  if (kept.end <= kept.start) {
    return {
      ok: false,
      message:
        'No stretch of this read is of good enough quality to align. Untick the trimming to align it all.',
    };
  }
  const b = full.slice(kept.start, kept.end);
  const own = reference.sequence;
  const a = reference.wrap === null ? own : own + own.slice(0, Math.min(b.length, own.length - 1));
  return {
    ok: true,
    job: {
      a,
      b,
      reference,
      readLength: full.length,
      kept,
      trimmed: trimming ? { start: kept.start, end: full.length - kept.end } : null,
      qualities: all === null ? null : all.slice(kept.start, kept.end),
      read: input.read,
    },
  };
}

/** A read's alignment as the Align tab shows it. */
export interface ReadAlignment {
  readonly alignment: Alignment;
  readonly strand: 'forward' | 'reverse';
  /** Where the reference's position 0 is in its numbering. */
  readonly offset: number;
  /** The reference's length when the alignment may run past its origin, else null. */
  readonly wrap: number | null;
  /**
   * Where the aligned read starts, as numbered on screen: along the read,
   * or along its reverse complement when it aligned reversed.
   */
  readonly offsetB: number;
  /** The aligned (trimmed) read's length. */
  readonly lengthB: number;
  /** The whole read's length. */
  readonly readLength: number;
  readonly trimmed: { readonly start: number; readonly end: number } | null;
  /** The read's quality under each column, when it had qualities. */
  readonly qualities: readonly number[] | null;
  /** The read with its trace, turned the way it aligned, when it had a trace. */
  readonly trace: SequencingRead | null;
}

/** The worker's answer for `job`, turned into what is shown. */
export function finishReadAlignment(job: AlignmentJob, best: StrandedAlignment): ReadAlignment {
  const reverse = best.strand === 'reverse';
  const { wrap } = job.reference;
  // The reverse complement's qualities run the other way; so does its
  // numbering, which counts along the reverse complement of the whole read.
  const q = job.qualities;
  const oriented = q === null ? null : reverse ? Array.from(q).reverse() : q;
  // Found wholly in the repeated start: the same alignment one turn back.
  const turn = wrap !== null && best.alignment.startA >= wrap ? wrap : 0;
  const alignment =
    turn === 0
      ? best.alignment
      : {
          ...best.alignment,
          startA: best.alignment.startA - turn,
          endA: best.alignment.endA - turn,
        };
  const read = job.read;
  return {
    alignment,
    strand: best.strand,
    offset: job.reference.offset,
    wrap,
    offsetB: reverse ? job.readLength - job.kept.end : job.kept.start,
    lengthB: job.b.length,
    readLength: job.readLength,
    trimmed: job.trimmed,
    qualities: oriented === null ? null : columnQualities(alignment, oriented),
    // The whole read, so the trace keeps the read's own numbering.
    trace: read?.trace == null ? null : reverse ? reverseComplementRead(read) : read,
  };
}

/**
 * A stretch of the read as aligned (0-based along the read as numbered on
 * screen, from `offsetB`) as a range of the read itself: the same, or
 * mirrored when it aligned reversed. `start === end` is a point between
 * bases. For a document that is the read (#57).
 */
export function readRange(result: ReadAlignment, start: number, end: number): Range {
  return result.strand === 'forward'
    ? { start, end }
    : { start: result.readLength - end, end: result.readLength - start };
}

/** The reference range the alignment covers, in the reference's own numbering. */
export function alignedReferenceRange(result: ReadAlignment): Range | null {
  const start = result.offset + result.alignment.startA;
  // Past the origin is fine (a wrapping range); round it more than once is not.
  const end = Math.min(
    result.offset + result.alignment.endA,
    start + (result.wrap ?? Number.POSITIVE_INFINITY),
  );
  return end > start ? { start, end } : null;
}

/** The mode an alignment starts in, and why when it is not the usual Global. */
export interface SuggestedMode {
  readonly mode: AlignmentMode;
  /** Why Local, to follow "it is …" by the mode select; null for Global. */
  readonly reason: string | null;
}

/**
 * The mode to align `query` to a reference of `referenceLength` in, until
 * the user picks one (#86). Global scores a read across the whole of a
 * plasmid it covers a sixth of: a perfect 750 bp read against a 4.4 kb
 * plasmid came out at 17% identity. So a read (a sequence with qualities)
 * and a sequence under half the reference's length start in Local; the
 * rest in Global, the end-to-end comparison of two versions of one thing.
 */
export function suggestAlignMode(
  query: { readonly length: number; readonly isRead: boolean },
  referenceLength: number,
): SuggestedMode {
  if (query.isRead) {
    return { mode: 'local', reason: 'a read' };
  }
  if (query.length > 0 && query.length * 2 < referenceLength) {
    return { mode: 'local', reason: 'under half the length of what it is aligned to' };
  }
  return { mode: 'global', reason: null };
}
