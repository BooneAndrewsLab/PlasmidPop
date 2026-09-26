import { SeqDocument, guessAlphabet, isValidProtein, normalizeSequenceInput } from '@/core';

import { isAbif, parseAbif } from './abif';
import { parseFasta } from './fasta';
import { parseFastq } from './fastq';
import { parseGenBank } from './genbank';
import { isSnapGene, parseSnapGene } from './snapgene';
import { type FormatId, type ParseResult, FormatError } from './types';

const GENBANK_EXTENSIONS = new Set(['gb', 'gbk', 'genbank', 'gbff', 'ape', 'gp', 'gpff', 'gpept']);
const FASTA_EXTENSIONS = new Set(['fa', 'fasta', 'fna', 'ffn', 'faa', 'fas', 'seq', 'txt']);
const FASTQ_EXTENSIONS = new Set(['fastq', 'fq']);

/**
 * Shortest run of letters that reads as a piece of sequence rather than a
 * word (#95). A pasted protein arrives as one block or as wrapped lines of
 * sixty; prose arrives as words of a few letters, and every letter but J is
 * an amino acid, so the shape is what tells them apart.
 */
const SEQUENCE_RUN = 10;

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
  // Bare letters: bases, or the residues of a protein (#95). Bases are
  // taken as they always were. Residues need more care, because nearly
  // every letter is an amino acid and so is any English word: the text must
  // also be shaped like a sequence — blocks of at least `SEQUENCE_RUN`
  // letters, as a copied sequence comes, rather than the short words of
  // prose. `guessAlphabet` decides which of the two it is when it is parsed.
  if (text.trim() !== '' && /^[\sA-Za-z0-9*]+$/.test(text)) {
    const letters = text.replace(/[\s0-9]/g, '');
    if (!/[EFIJLOPQXZefijlopqxz*]/.test(letters)) return 'raw';
    const words = text.trim().split(/[\s0-9]+/);
    const runs = words.every((w) => w.length >= SEQUENCE_RUN);
    if (runs && letters.length >= SEQUENCE_RUN && isValidProtein(letters)) return 'raw';
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
    case 'raw': {
      // The letters say what they are, by the same rule a FASTA record
      // without a header would be read by (#66, #95).
      const alphabet = guessAlphabet(text.replace(/[^A-Za-z*]/g, ''));
      return {
        format,
        documents: [
          SeqDocument.create({
            name: nameFromFilename(filename),
            sequence: normalizeSequenceInput(text, alphabet),
            alphabet,
          }),
        ],
        warnings: [],
      };
    }
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
