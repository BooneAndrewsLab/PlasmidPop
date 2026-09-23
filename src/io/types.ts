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

/** The input could not be understood at all. Recoverable problems become warnings instead. */
export class FormatError extends Error {
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'FormatError';
    this.line = line;
  }
}

export function warning(message: string, line?: number): ParseWarning {
  return line === undefined ? { message } : { message, line };
}
