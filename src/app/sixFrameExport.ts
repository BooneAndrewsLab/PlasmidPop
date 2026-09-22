import {
  type FrameTranslation,
  type Range,
  type SeqDocument,
  type TranslationTable,
  DEFAULT_TABLE,
  geneticCode,
} from '@/core';
import { formatFastaRecord } from '@/io';

import { fileNameFor } from './saveFile';

/** 1-based inclusive bounds of a range, the end folded back onto the sequence when it wraps. */
export function rangeBounds(r: Range, seqLength: number): { from: number; to: number } {
  return { from: r.start + 1, to: ((r.end - 1) % Math.max(1, seqLength)) + 1 };
}

/** ASCII frame label (`+1`, `-1`) for file names and FASTA headers. */
function asciiFrame(f: FrameTranslation): string {
  return f.frame > 0 ? `+${f.frame}` : `-${-f.frame}`;
}

function stemOf(doc: SeqDocument): string {
  return fileNameFor(doc, 'fasta').replace(/\.fasta$/, '');
}

/** File name for the six-frame export of `r`. */
export function sixFrameFileName(doc: SeqDocument, r: Range): string {
  const { from, to } = rangeBounds(r, doc.length);
  return `${stemOf(doc)}_${from}-${to}_6frames.fasta`;
}

/**
 * Multi-record protein FASTA of every frame with at least one amino acid.
 * The genetic code is named in the description only when it is not the
 * standard one: that is the assumption a reader makes, and saying it on
 * every header would bury the one case where it matters.
 */
export function sixFrameFasta(
  doc: SeqDocument,
  r: Range,
  frames: readonly FrameTranslation[],
  table: TranslationTable = DEFAULT_TABLE,
): string {
  const stem = stemOf(doc);
  const { from, to } = rangeBounds(r, doc.length);
  const code =
    table === DEFAULT_TABLE ? '' : `, genetic code ${table} (${geneticCode(table).name})`;
  return frames
    .filter((f) => f.protein !== '')
    .map((f) =>
      formatFastaRecord(
        `${stem}_${from}-${to}_frame${asciiFrame(f)} ${doc.name} ${from}..${to} frame ${asciiFrame(f)}, ${f.protein.length} aa${code}`,
        f.protein,
      ),
    )
    .join('');
}
