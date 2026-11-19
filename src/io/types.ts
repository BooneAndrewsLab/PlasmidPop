import { type SeqDocument } from '@/core';

export type FormatId = 'genbank' | 'fasta' | 'raw' | 'snapgene' | 'abif' | 'fastq';

export interface ParseWarning {
  readonly message: string;
  /** 1-based line in the input, when known. */
  readonly line?: number;
}

export interface ParseResult {
  readonly format: FormatId;
  readonly documents: readonly SeqDocument[];
  readonly warnings: readonly ParseWarning[];
}

/**
 * Why an open failed, as a closed set (#447, item 38). It is what the
 * `file / open-failed` event may carry: a class of failure, never a message,
 * which can quote a file name or a line of the file.
 */
export const OPEN_FAILURE_REASONS = [
  'unrecognised-format',
  'empty',
  'binary',
  'corrupt',
  'parse-error',
  'too-large',
  'unsupported',
  'unreadable',
  'other',
] as const;

export type OpenFailureReason = (typeof OPEN_FAILURE_REASONS)[number];

/** The input could not be understood at all. Recoverable problems become warnings instead. */
export class FormatError extends Error {
  readonly line: number | undefined;
  /** What kind of failure this is; a parser's own complaint is a `parse-error`. */
  readonly reason: OpenFailureReason;

  constructor(message: string, line?: number, reason: OpenFailureReason = 'parse-error') {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'FormatError';
    this.line = line;
    this.reason = reason;
  }
}

/** The class of a failed open: the error's own, or `other` for anything unexpected. */
export function openFailureReason(e: unknown): OpenFailureReason {
  return e instanceof FormatError ? e.reason : 'other';
}

export function warning(message: string, line?: number): ParseWarning {
  return line === undefined ? { message } : { message, line };
}
