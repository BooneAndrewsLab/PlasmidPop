import { SeqDocument, normalizeSequenceInput } from '@/core';

import { parseFasta } from './fasta';
import { parseGenBank } from './genbank';
import { type FormatId, type ParseResult, FormatError } from './types';

const GENBANK_EXTENSIONS = new Set(['gb', 'gbk', 'genbank', 'gbff', 'ape']);
const FASTA_EXTENSIONS = new Set(['fa', 'fasta', 'fna', 'ffn', 'fas', 'seq', 'txt']);

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Sniffs the format from content first (it is more reliable than the
 * extension), falling back to the file extension. Returns `null` when the
 * text is not recognised.
 */
export function detectFormat(text: string, filename?: string): FormatId | null {
  const head = text.slice(0, 4000);
  if (/^\s*LOCUS\s/.test(head) || /^(LOCUS|FEATURES|ORIGIN)\b/m.test(head)) return 'genbank';
  if (/^\s*>/.test(head)) return 'fasta';
  if (text.trim() !== '' && /^[\sA-Za-z0-9]+$/.test(text) && !/[EFIJLOPQXZefijlopqxz]/.test(text)) {
    return 'raw';
  }
  if (filename !== undefined) {
    const ext = extensionOf(filename);
    if (GENBANK_EXTENSIONS.has(ext)) return 'genbank';
    if (FASTA_EXTENSIONS.has(ext)) return 'fasta';
  }
  return null;
}

function nameFromFilename(filename: string | undefined): string {
  if (filename === undefined) return 'Untitled';
  const base = filename.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem === '' ? 'Untitled' : stem;
}

/** Parses a text file in any supported format, detecting which one it is. */
export function parseSequenceFile(text: string, filename?: string): ParseResult {
  const format = detectFormat(text, filename);
  switch (format) {
    case 'genbank':
      return parseGenBank(text);
    case 'fasta':
      return parseFasta(text);
    case 'raw':
      return {
        format,
        documents: [
          SeqDocument.create({
            name: nameFromFilename(filename),
            sequence: normalizeSequenceInput(text),
          }),
        ],
        warnings: [],
      };
    case null:
      throw new FormatError(
        filename === undefined
          ? 'Unrecognised sequence format'
          : `Unrecognised sequence format for "${filename}"`,
      );
  }
}
