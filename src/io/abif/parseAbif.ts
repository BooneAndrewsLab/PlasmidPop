import {
  type SequencingRead,
  type Trace,
  type TraceBase,
  SeqDocument,
  TRACE_BASES,
  isValidSequence,
} from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';

/**
 * Reader for Applied Biosystems' ABIF format (`.ab1`), the file a capillary
 * sequencer writes for a Sanger read, and that several nanopore services
 * deliver their consensus as (#49).
 *
 * The file is big-endian: a 34-byte header whose own directory entry points
 * at the directory, then one 28-byte entry per tag — a four-letter name and
 * a number (PBAS 2), the element type and count, and where the data is. Data
 * of four bytes or fewer sits in the entry itself. The format is described
 * in Applied Biosystems' "ABIF File Format" note (2009); Biopython's
 * `AbiIO` is the reader ours is checked against (`scripts/oracle/abif_local.py`).
 *
 * What is read: the base calls (PBAS), their qualities (PCON) and peak
 * positions (PLOC), and the four analysed trace channels DATA9–DATA12 in
 * the order FWO_1 gives. Each of PBAS, PCON and PLOC has a copy 1 (as
 * called) and a copy 2 (as last edited); 2 is preferred, as Biopython does,
 * and a tag falls back to the other copy only when its length matches.
 */

const HEADER_SIZE = 34;
const ENTRY_SIZE = 28;

interface Entry {
  readonly name: string;
  readonly number: number;
  readonly elementType: number;
  readonly count: number;
  readonly size: number;
  /** Absolute offset of the data in the file. */
  readonly offset: number;
}

export function isAbif(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x41 && // A
    bytes[1] === 0x42 && // B
    bytes[2] === 0x49 && // I
    bytes[3] === 0x46 // F
  );
}

function readDirectory(view: DataView): Map<string, Entry> {
  if (view.byteLength < HEADER_SIZE) throw new FormatError('AB1 file is truncated');
  // The header's directory entry starts at byte 6; its count and offset say
  // where the directory is and how many entries it holds.
  const count = view.getInt32(6 + 12);
  const start = view.getInt32(6 + 20);
  if (count < 0 || start < 0 || start + count * ENTRY_SIZE > view.byteLength) {
    throw new FormatError('AB1 directory lies outside the file');
  }
  const entries = new Map<string, Entry>();
  for (let k = 0; k < count; k++) {
    const at = start + k * ENTRY_SIZE;
    const name = String.fromCharCode(
      view.getUint8(at),
      view.getUint8(at + 1),
      view.getUint8(at + 2),
      view.getUint8(at + 3),
    );
    const number = view.getInt32(at + 4);
    const size = view.getInt32(at + 16);
    // Four bytes or fewer are stored in the offset field itself.
    const offset = size <= 4 ? at + 20 : view.getInt32(at + 20);
    if (size < 0 || offset < 0 || offset + size > view.byteLength) continue;
    entries.set(`${name}${number}`, {
      name,
      number,
      elementType: view.getInt16(at + 8),
      count: view.getInt32(at + 12),
      size,
      offset,
    });
  }
  return entries;
}

// Element types this reader needs (ABIF note, table 2).
const TYPE_BYTE = 1;
const TYPE_CHAR = 2;
const TYPE_SHORT = 4;
const TYPE_LONG = 5;
const TYPE_PSTRING = 18;
const TYPE_CSTRING = 19;

function bytesOf(view: DataView, e: Entry): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset + e.offset, e.size);
}

function textOf(view: DataView, e: Entry): string {
  let bytes = bytesOf(view, e);
  if (e.elementType === TYPE_PSTRING) bytes = bytes.subarray(1, 1 + (bytes[0] ?? 0));
  else if (e.elementType === TYPE_CSTRING) {
    const nul = bytes.indexOf(0);
    if (nul >= 0) bytes = bytes.subarray(0, nul);
  }
  return new TextDecoder('latin1').decode(bytes);
}

function shortsOf(view: DataView, e: Entry): Int16Array | null {
  if (e.elementType !== TYPE_SHORT || e.size < e.count * 2) return null;
  const out = new Int16Array(e.count);
  for (let k = 0; k < e.count; k++) out[k] = view.getInt16(e.offset + k * 2);
  return out;
}

/** Peak positions: shorts in most files, longs in some. */
function positionsOf(view: DataView, e: Entry): Int32Array | null {
  const width = e.elementType === TYPE_LONG ? 4 : e.elementType === TYPE_SHORT ? 2 : 0;
  if (width === 0 || e.size < e.count * width) return null;
  const out = new Int32Array(e.count);
  for (let k = 0; k < e.count; k++) {
    // Shorts are read unsigned: a trace can be longer than 32,767 points.
    out[k] = width === 4 ? view.getInt32(e.offset + k * 4) : view.getUint16(e.offset + k * 2);
  }
  return out;
}

function nameFromFilename(filename: string | undefined): string {
  if (filename === undefined) return 'Untitled';
  const base = filename.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem === '' ? 'Untitled' : stem;
}

export function parseAbif(data: ArrayBuffer | Uint8Array, filename?: string): ParseResult {
  if (!isAbif(data)) throw new FormatError('Not an AB1 file (no ABIF signature)');
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags = readDirectory(view);
  const warnings: ParseWarning[] = [];

  const calls = tags.get('PBAS2') ?? tags.get('PBAS1');
  if (calls === undefined) {
    throw new FormatError(
      'This AB1 file has no base calls. Fragment-analysis files (.fsa) hold traces only.',
    );
  }
  const sequence = textOf(view, calls)
    .toUpperCase()
    .replace(/[\s\0]/g, '');
  if (!isValidSequence(sequence)) {
    throw new FormatError('The base calls of this AB1 file are not IUPAC nucleotides');
  }
  const preferred = calls.number;
  const other = preferred === 2 ? 1 : 2;
  /** The tag of the same copy as the calls, or the other copy if its length fits. */
  const matching = (name: string): Entry | undefined => {
    const own = tags.get(`${name}${preferred}`);
    if (own?.count === sequence.length) return own;
    const alt = tags.get(`${name}${other}`);
    return alt?.count === sequence.length ? alt : undefined;
  };

  const qualityTag = matching('PCON');
  let qualities: Uint8Array;
  if (
    qualityTag !== undefined &&
    (qualityTag.elementType === TYPE_CHAR || qualityTag.elementType === TYPE_BYTE)
  ) {
    qualities = bytesOf(view, qualityTag).slice(0, sequence.length);
  } else {
    qualities = new Uint8Array(sequence.length);
    if (sequence.length > 0) warnings.push(warning('This AB1 file has no base qualities'));
  }

  const trace = readTrace(view, tags, matching('PLOC'), sequence.length, warnings);
  const read: SequencingRead = { qualities, trace };
  const sample = tags.get('SMPL1');
  const document = SeqDocument.create({
    name: nameFromFilename(filename),
    sequence,
    read,
    metadata: sample === undefined ? {} : { description: textOf(view, sample).trim() },
  });
  return { format: 'abif', documents: [document], warnings };
}

function readTrace(
  view: DataView,
  tags: Map<string, Entry>,
  peakTag: Entry | undefined,
  bases: number,
  warnings: ParseWarning[],
): Trace | null {
  const order = tags.get('FWO_1');
  const channelTags = [9, 10, 11, 12].map((n) => tags.get(`DATA${n}`));
  if (order === undefined || channelTags.some((t) => t === undefined)) return null;
  const letters = textOf(view, order).toUpperCase();
  const channels: Partial<Record<TraceBase, Int16Array>> = {};
  for (let k = 0; k < 4; k++) {
    const letter = letters.charAt(k) as TraceBase;
    const tag = channelTags[k];
    if (!TRACE_BASES.includes(letter) || tag === undefined) return null;
    const signal = shortsOf(view, tag);
    if (signal === null) return null;
    channels[letter] = signal;
  }
  const { A, C, G, T } = channels;
  if (A === undefined || C === undefined || G === undefined || T === undefined) return null;
  if (C.length !== A.length || G.length !== A.length || T.length !== A.length) return null;
  const peaks = peakTag === undefined ? null : positionsOf(view, peakTag);
  if (peaks === null || peaks.some((p) => p < 0 || p >= A.length)) {
    if (bases > 0)
      warnings.push(
        warning('The trace of this AB1 file does not line up with its bases, so it is not shown'),
      );
    return null;
  }
  return { channels: { A, C, G, T }, peaks };
}
