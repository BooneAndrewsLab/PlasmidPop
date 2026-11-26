import { type SeqDocument } from '@/core';

export type FormatId = 'genbank' | 'fasta' | 'raw' | 'snapgene' | 'abif' | 'fastq';

export interface ParseWarning {
  readonly message: string;
  /** 1-based line in the input, when known. */
  readonly line?: number;
  /**
   * Set when this warning is about features that GenBank output cannot write
   * as they were read (#464); the save says so from these.
   */
  readonly inexact?: InexactFeature;
}

/**
 * A feature, or a run of them, that cannot be written back as it was read:
 * `mixed-strand` is kept with its parts on the forward strand, `skipped-location`
 * (a remote or other unsupported location) was left out at open. Names and
 * types only, never sequence. `count` is more than 1 for a summary of the
 * skipped features that were not listed one by one, which have no name.
 */
export interface InexactFeature {
  readonly kind: 'mixed-strand' | 'skipped-location';
  readonly featureType: string;
  readonly name: string;
  readonly count: number;
}

export interface ParseResult {
  readonly format: FormatId;
  readonly documents: readonly SeqDocument[];
  readonly warnings: readonly ParseWarning[];
  /**
   * Set only when a GenBank record that says linear has features that run
   * across the end of the sequence (#462): for each document, how many. They
   * are dropped with a warning unless the file is read again with
   * `wrappingAsCircular`, which the app does when the user asks for it.
   */
  readonly originSpanning?: readonly number[];
}

/** What reading a sequence file can be asked to do differently (#462). */
export interface ParseOptions {
  /**
   * Read a GenBank record whose LOCUS line says linear (or says nothing) as
   * circular when it has features that run across the end of the sequence,
   * and keep them, instead of dropping them with a warning. Records without
   * such features are read as the file says; other formats ignore this.
   */
  readonly wrappingAsCircular?: boolean;
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

/**
 * Where in a record a parser stopped (#459). A closed set, so the problem
 * report can name it without quoting the file.
 */
export type FailureSection = 'header' | 'feature table' | 'sequence';

/** What a parser knows about where it stopped, beyond the line (#459). */
export interface FailureDetail {
  readonly section?: FailureSection;
  readonly recordsParsed?: number;
}

/** The input could not be understood at all. Recoverable problems become warnings instead. */
export class FormatError extends Error {
  readonly line: number | undefined;
  /** What kind of failure this is; a parser's own complaint is a `parse-error`. */
  readonly reason: OpenFailureReason;
  /** The part of the record the parser stopped in, when it knows. */
  readonly section: FailureSection | undefined;
  /** Records read completely before this one, when the parser counts them. */
  recordsParsed: number | undefined;

  constructor(
    message: string,
    line?: number,
    reason: OpenFailureReason = 'parse-error',
    detail: FailureDetail = {},
  ) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'FormatError';
    this.line = line;
    this.reason = reason;
    this.section = detail.section;
    this.recordsParsed = detail.recordsParsed;
  }
}

/** The class of a failed open: the error's own, or `other` for anything unexpected. */
export function openFailureReason(e: unknown): OpenFailureReason {
  return e instanceof FormatError ? e.reason : 'other';
}

export function warning(message: string, line?: number, inexact?: InexactFeature): ParseWarning {
  return {
    message,
    ...(line === undefined ? {} : { line }),
    ...(inexact === undefined ? {} : { inexact }),
  };
}
