import { SeqDocument, isValidSequence } from '@/core';

import { type ParseResult, type ParseWarning, FormatError, warning } from '../types';

/**
 * Parses FASTQ, the text format nanopore and Illumina reads arrive in (#49):
 * per record an `@` header, the bases, a `+` line, and one quality character
 * per base, Phred + 33 (Sanger/Illumina 1.8+). The sequence and quality may
 * each wrap over several lines; the quality is read until it is as long as
 * the sequence, since `@` is also a quality character and cannot mark the
 * next record on its own. Each record becomes a document carrying its
 * qualities as a read without a trace.
 */
export function parseFastq(text: string): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const documents: SeqDocument[] = [];
  const warnings: ParseWarning[] = [];
  let k = 0;
  let lowest = Infinity;
  let highest = -Infinity;
  const skipBlank = (): void => {
    while (k < lines.length && (lines[k] ?? '').trim() === '') k++;
  };

  skipBlank();
  while (k < lines.length) {
    const headerLine = k + 1;
    const header = (lines[k] ?? '').trim();
    if (!header.startsWith('@')) {
      throw new FormatError('FASTQ records must start with an "@" header line', headerLine);
    }
    k++;
    let bases = '';
    while (k < lines.length && !(lines[k] ?? '').startsWith('+')) {
      bases += (lines[k] ?? '').trim();
      k++;
    }
    if (k >= lines.length) throw new FormatError('FASTQ record has no "+" line', headerLine);
    k++; // the + line
    let quality = '';
    while (k < lines.length && quality.length < bases.length) {
      quality += (lines[k] ?? '').trim();
      k++;
    }
    if (quality.length !== bases.length) {
      throw new FormatError(
        `FASTQ record has ${quality.length} quality values for ${bases.length} bases`,
        headerLine,
      );
    }
    const sequence = bases.toUpperCase();
    if (!isValidSequence(sequence)) {
      throw new FormatError('FASTQ sequence is not nucleotide IUPAC', headerLine);
    }
    const qualities = new Uint8Array(sequence.length);
    let belowZero = false;
    for (let q = 0; q < quality.length; q++) {
      const code = quality.charCodeAt(q);
      lowest = Math.min(lowest, code);
      highest = Math.max(highest, code);
      const value = code - 33;
      if (value < 0) belowZero = true;
      qualities[q] = Math.max(0, Math.min(93, value));
    }
    if (belowZero) warnings.push(warning('Quality characters below "!" read as 0', headerLine));
    const body = header.slice(1);
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    documents.push(
      SeqDocument.create({
        name: name === '' ? 'Untitled' : name,
        sequence,
        read: { qualities, trace: null },
        metadata: { description: space < 0 ? '' : body.slice(space).trim() },
      }),
    );
    skipBlank();
  }
  if (documents.length === 0) throw new FormatError('No FASTQ records found');
  const offset = oldEncoding(lowest, highest);
  if (offset !== null) warnings.unshift(warning(offset));
  return { format: 'fastq', documents, warnings };
}

/**
 * The obsolete encodings are not read, only noticed (#146, item 70):
 * Illumina 1.3–1.7 wrote Phred + 64, whose lowest character is `@`, and
 * Solexa/Illumina 1.0 a log-odds score + 64 that goes down to `;`. Read as
 * Phred + 33 they come out 31 too high. A Phred + 33 file with nothing below
 * `@` (Q31) is possible — a good Illumina 1.8+ run tops out at `J`, Q41 —
 * so the warning also wants a character above `J`, which Illumina 1.8 never
 * writes and + 64 does from Q11 up. Below `@` but not below `;`, and
 * reaching `h` (Q40 in + 64, Q71 in + 33), is Solexa. Either way the file
 * is read as Phred + 33, with the warning.
 */
function oldEncoding(lowest: number, highest: number): string | null {
  const semicolon = 59;
  const at = 64;
  const j = 74;
  const h = 104;
  if (!Number.isFinite(lowest)) return null;
  if (lowest >= at && highest > j) {
    return 'No quality character is below "@" and some are above "J": this looks like the old Phred + 64 (Illumina 1.3–1.7) or Solexa encoding, but it was read as Phred + 33, so qualities are about 31 too high';
  }
  if (lowest >= semicolon && highest >= h) {
    return 'Quality characters run from ";" up past "h": this looks like the old Solexa encoding, but it was read as Phred + 33, so qualities are about 31 too high';
  }
  return null;
}

/**
 * Writes a document with a read as one FASTQ record (#58): `@name
 * description`, the bases on one line, `+`, and one Phred + 33 character
 * per base (Sanger / Illumina 1.8+, what `parseFastq` reads). Qualities
 * above 93 are written as 93, the highest the encoding has. Unwrapped, as
 * most tools write it and some require. A trace has no place in FASTQ and is
 * left out; so are features, which a FASTQ cannot hold either.
 *
 * Throws for a document without a read, or one whose read no longer fits
 * its bases: the qualities would describe other bases.
 */
export function writeFastq(doc: SeqDocument): string {
  const read = doc.read;
  if (read === null) throw new Error('This document has no base qualities to write as FASTQ');
  const bases = doc.sequence.toString();
  if (read.qualities.length !== bases.length) {
    throw new Error(`The read has ${read.qualities.length} qualities for ${bases.length} bases`);
  }
  let quality = '';
  for (const q of read.qualities) quality += String.fromCharCode(33 + Math.min(93, q));
  const name = doc.name.trim() === '' ? 'Untitled' : doc.name.trim().replace(/\s+/g, '_');
  const description = doc.metadata.description.replace(/\s+/g, ' ').trim();
  const header = description === '' ? name : `${name} ${description}`;
  return `@${header}\n${bases}\n+\n${quality}\n`;
}
