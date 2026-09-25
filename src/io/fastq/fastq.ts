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
      const value = quality.charCodeAt(q) - 33;
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
  return { format: 'fastq', documents, warnings };
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
