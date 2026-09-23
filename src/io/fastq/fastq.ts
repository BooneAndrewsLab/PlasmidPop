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
