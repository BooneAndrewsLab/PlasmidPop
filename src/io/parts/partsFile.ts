import {
  type MyPart,
  type PartDraft,
  MY_PARTS_ORIGIN,
  SeqDocument,
  createFeature,
  partsFromDocument,
  rangeSegment,
} from '@/core';

import { detectFormat } from '../detect';
import { parseFasta } from '../fasta';
import { parseGenBank, writeGenBankRecords } from '../genbank';
import { FormatError } from '../types';

/**
 * Parts as a file (#210): a GenBank or FASTA file of the user's parts is
 * read into drafts (each feature of a record is a part, a record with none is
 * a part itself; see `partsFromDocument`), and My parts goes out as a GenBank
 * file of one record per part, which reads back as the same parts.
 */
export function readPartsFile(text: string, fileName?: string): PartDraft[] {
  const format = detectFormat(text, fileName);
  if (format !== 'genbank' && format !== 'fasta') {
    throw new FormatError('Open a GenBank or FASTA file of parts.');
  }
  const { documents } = format === 'genbank' ? parseGenBank(text) : parseFasta(text);
  return documents.flatMap((d) => partsFromDocument(d, MY_PARTS_ORIGIN));
}

/**
 * My parts as GenBank, one record per part holding one feature of its type
 * across all of it, with the part's notes. Parts known only by a protein
 * have no bases to write; they are counted in `skipped` and left out.
 */
export function writePartsGenBank(parts: readonly MyPart[]): {
  readonly text: string;
  readonly skipped: number;
} {
  const docs: SeqDocument[] = [];
  let skipped = 0;
  for (const p of parts) {
    if (p.sequence === '') {
      skipped++;
      continue;
    }
    docs.push(
      SeqDocument.create({
        name: p.name,
        sequence: p.sequence,
        features: [
          createFeature({
            type: p.type,
            name: p.name,
            segments: [rangeSegment(0, p.sequence.length)],
            qualifiers: [
              { name: 'label', value: p.name },
              ...(p.notes === '' ? [] : [{ name: 'note', value: p.notes }]),
            ],
          }),
        ],
      }),
    );
  }
  return { text: docs.length === 0 ? '' : writeGenBankRecords(docs), skipped };
}
