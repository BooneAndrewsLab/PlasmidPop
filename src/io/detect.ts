import { SeqDocument, normalizeSequenceInput } from '@/core';

import { isAbif, parseAbif } from './abif';
import { parseFasta } from './fasta';
import { parseFastq } from './fastq';
import { parseGenBank } from './genbank';
import { isSnapGene, parseSnapGene } from './snapgene';
import { type FormatId, type ParseResult, FormatError } from './types';

const GENBANK_EXTENSIONS = new Set(['gb', 'gbk', 'genbank', 'gbff', 'ape']);
const FASTA_EXTENSIONS = new Set(['fa', 'fasta', 'fna', 'ffn', 'fas', 'seq', 'txt']);
const FASTQ_EXTENSIONS = new Set(['fastq', 'fq']);

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
  if (/^\s*@/.test(head)) return 'fastq';
  if (text.trim() !== '' && /^[\sA-Za-z0-9]+$/.test(text) && !/[EFIJLOPQXZefijlopqxz]/.test(text)) {
    return 'raw';
  }
  if (filename !== undefined) {
    const ext = extensionOf(filename);
    if (GENBANK_EXTENSIONS.has(ext)) return 'genbank';
    if (FASTA_EXTENSIONS.has(ext)) return 'fasta';
    if (FASTQ_EXTENSIONS.has(ext)) return 'fastq';
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

/**
 * Parses file contents of any supported format. Binary input is checked for
 * the SnapGene and ABIF signatures first; anything else is decoded as UTF-8
 * text. A gzipped file has to go through `readSequenceData` instead.
 */
export function parseSequenceData(
  data: ArrayBuffer | Uint8Array | string,
  filename?: string,
): ParseResult {
  if (typeof data === 'string') return parseSequenceFile(data, filename);
  if (isSnapGene(data)) return parseSnapGene(data, filename);
  if (isAbif(data)) return parseAbif(data, filename);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (isGzip(bytes)) {
    throw new FormatError('This file is gzipped; it has to be decompressed before it is read');
  }
  return parseSequenceFile(new TextDecoder('utf-8').decode(bytes), filename);
}

/** Parses a text file in any supported format, detecting which one it is. */
export function parseSequenceFile(text: string, filename?: string): ParseResult {
  const format = detectFormat(text, filename);
  switch (format) {
    case 'genbank':
      return parseGenBank(text);
    case 'fasta':
      return parseFasta(text);
    case 'fastq':
      return parseFastq(text);
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
    case 'snapgene':
    case 'abif':
      throw new FormatError('This format is binary; pass the file bytes to parseSequenceData');
    case null:
      throw new FormatError(
        filename === undefined
          ? 'Unrecognised sequence format'
          : `Unrecognised sequence format for "${filename}"`,
      );
  }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * `parseSequenceData` for a whole file, which may be gzipped: FASTQ from a
 * nanopore run usually comes as `.fastq.gz`. Decompressed with the
 * platform's DecompressionStream, so nothing is bundled for it.
 */
export async function readSequenceData(data: ArrayBuffer, filename?: string): Promise<ParseResult> {
  const bytes = new Uint8Array(data);
  if (!isGzip(bytes)) return parseSequenceData(bytes, filename);
  let inflated: ArrayBuffer;
  try {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const stream = source.pipeThrough(new DecompressionStream('gzip'));
    inflated = await new Response(stream).arrayBuffer();
  } catch {
    throw new FormatError('This gzipped file could not be decompressed');
  }
  return parseSequenceData(inflated, filename?.replace(/\.gz$/i, ''));
}
