/**
 * "Report this problem" (#459, item 156): a prefilled email the user reads
 * and sends themselves. The app sends nothing.
 *
 * The text is built from STRUCTURED facts only: a closed reason, a format
 * guessed from the extension, a line number, the section a parser stopped in,
 * a size, a coarse content class. It never takes the failure's message (which
 * can quote the first characters of the file or a line of it, see
 * `failureHints.ts`), the file name, or anything read from the file: there is
 * no parameter through which that text could arrive.
 */
import { type FailureSection, type OpenFailureReason, FormatError, isZip } from '@/io';

import { formatOfFileName } from './analytics';

/**
 * Where reports go. The real address does not exist yet, so this is a
 * placeholder in the reserved `.invalid` TLD, and while it still is one the
 * "Report this problem" link is NOT rendered (`canMailReport`): a release
 * must never ship a mailto that goes nowhere. Replace it with the real
 * address to switch the link on; "Copy report" works either way.
 */
export const REPORT_ADDRESS = 'problem-reports@plasmidpop.invalid';

/** True when a mailto to `address` would reach someone: it is not a `.invalid` placeholder. */
export function canMailReport(address: string = REPORT_ADDRESS): boolean {
  return address !== '' && !/\.invalid$/i.test(address);
}

/** The only extensions a report names; anything else is reported as `other`. */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  'gb',
  'gbk',
  'genbank',
  'gbff',
  'gp',
  'gpff',
  'ape',
  'fa',
  'fasta',
  'fna',
  'fas',
  'ffn',
  'faa',
  'seq',
  'txt',
  'dna',
  'prot',
  'rna',
  'ab1',
  'abi',
  'fastq',
  'fq',
  'gz',
  'zip',
]);

/** The file's extension if it is on the fixed list, else `other`. */
export function reportExtension(fileName: string | null): string {
  if (fileName === null) return 'other';
  const dot = fileName.lastIndexOf('.');
  const ext = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : 'other';
}

export type ContentClass = 'text' | 'binary' | 'UTF-16' | 'gzipped' | 'unknown';

/** What the bytes are, coarsely: gzip, UTF-16 text, other binary (NUL bytes, ZIP), or text. */
export function classifyContent(bytes: Uint8Array): ContentClass {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzipped';
  const b0 = bytes[0];
  const b1 = bytes[1];
  if (bytes.length >= 2 && ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff))) {
    return 'UTF-16';
  }
  if (isZip(bytes.subarray(0, 4))) return 'binary';
  const head = bytes.subarray(0, 4000);
  if (head.includes(0)) {
    // UTF-16 text without a BOM has a NUL in every other byte.
    let evenNuls = 0;
    let oddNuls = 0;
    head.forEach((b, i) => {
      if (b !== 0) return;
      if (i % 2 === 0) evenNuls++;
      else oddNuls++;
    });
    const pairs = Math.floor(head.length / 2);
    return pairs > 0 && (evenNuls * 3 >= pairs || oddNuls * 3 >= pairs) ? 'UTF-16' : 'binary';
  }
  return 'text';
}

/** Everything a failed-open report says; each field is a fixed word, a number or a count. */
export interface OpenFailureFacts {
  readonly kind: 'open-failed';
  readonly reason: OpenFailureReason;
  /** From the extension, as `formatOfFileName` (`genbank`, `fasta`, ..., `other`). */
  readonly format: string;
  readonly line: number | null;
  readonly section: FailureSection | 'unknown';
  readonly sizeBytes: number | null;
  readonly extension: string;
  readonly content: ContentClass;
  readonly recordsParsed: number | null;
}

/** What a report needs from the file, without keeping it: its name and bytes or text. */
export interface FailedInput {
  readonly fileName: string | null;
  readonly bytes?: Uint8Array;
  readonly text?: string;
}

/** The facts of a failure of reading `input`, from the error's structured fields only. */
export function openFailureFacts(
  reason: OpenFailureReason,
  input: FailedInput,
  error?: unknown,
): OpenFailureFacts {
  const fe = error instanceof FormatError ? error : null;
  const bytes = input.bytes;
  const text = input.text;
  return {
    kind: 'open-failed',
    reason,
    format: input.fileName === null ? 'other' : formatOfFileName(input.fileName),
    line: fe?.line ?? null,
    section: fe?.section ?? 'unknown',
    sizeBytes:
      bytes !== undefined
        ? bytes.length
        : text !== undefined
          ? new TextEncoder().encode(text).length
          : null,
    extension: reportExtension(input.fileName),
    content: bytes !== undefined ? classifyContent(bytes) : text !== undefined ? 'text' : 'unknown',
    recordsParsed: fe?.recordsParsed ?? null,
  };
}

/** A report with nothing but the reason, for failures that were not about a file's contents. */
export function bareFacts(reason: OpenFailureReason): OpenFailureFacts {
  return openFailureFacts(reason, { fileName: null });
}

/** A fixed sentence per reason, written for the reader of the report. */
export const REASON_EXPLANATIONS: Readonly<Record<OpenFailureReason, string>> = {
  'unrecognised-format':
    'The file was not recognised as any format PlasmidPop reads (GenBank, FASTA, SnapGene, AB1, FASTQ, bare bases).',
  empty: 'The file was empty, or held only blank lines.',
  binary: 'The file looks binary (or UTF-16 text), not a text sequence file.',
  corrupt: 'The file was recognised but is damaged, cut off, or would not decompress.',
  'parse-error':
    'The file was recognised as a sequence format, but a record in it could not be read.',
  'too-large': 'The file is larger than PlasmidPop will open.',
  unsupported: 'The file is a kind PlasmidPop does not read, or a record type it cannot use.',
  unreadable: 'The browser could not read the file.',
  other: 'The failure was not one of the known kinds.',
};

/** What a report says about the build and the browser. */
export interface ReportEnvironment {
  readonly version: string;
  readonly buildDate: string;
  readonly userAgent: string;
}

/** The running build and browser. */
export function currentEnvironment(): ReportEnvironment {
  return {
    version: __APP_VERSION__,
    buildDate: __BUILD_DATE__,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  };
}

/** Browser family and OS family from a user-agent string: names only, no versions. */
export function coarseBrowser(userAgent: string): string {
  const ua = userAgent;
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : ua.includes('Firefox/')
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : ua.includes('Safari/')
            ? 'Safari'
            : 'other';
  const os = ua.includes('Android')
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : ua.includes('Windows')
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : ua.includes('CrOS')
            ? 'ChromeOS'
            : /Linux|X11/.test(ua)
              ? 'Linux'
              : 'other';
  return `${browser} on ${os}`;
}

export interface Report {
  readonly subject: string;
  readonly body: string;
}

const CLOSING =
  'If you are willing to share the file, attach it to this email; nothing was sent automatically.';

function head(env: ReportEnvironment): string[] {
  return [
    `PlasmidPop ${env.version} (built ${env.buildDate})`,
    `Browser: ${coarseBrowser(env.userAgent)}`,
  ];
}

/** The report of a failed open. */
export function failureReport(facts: OpenFailureFacts, env: ReportEnvironment): Report {
  const orUnknown = (n: number | null): string => (n === null ? 'unknown' : String(n));
  return {
    subject: `PlasmidPop problem report: ${facts.format}:${facts.reason} (${env.version})`,
    body: [
      ...head(env),
      `Failure: ${facts.reason}`,
      `What it means: ${REASON_EXPLANATIONS[facts.reason]}`,
      `Format (from the extension): ${facts.format}`,
      `Extension: ${facts.extension}`,
      `Content: ${facts.content}`,
      `Size: ${facts.sizeBytes === null ? 'unknown' : `${String(facts.sizeBytes)} bytes`}`,
      `Stopped at line: ${orUnknown(facts.line)}`,
      `Stopped in: ${facts.section}`,
      `Records read before the failure: ${orUnknown(facts.recordsParsed)}`,
      '',
      CLOSING,
    ].join('\n'),
  };
}

/** The categories a warning can fall in, by how its text begins; the text itself is never reported. */
const WARNING_CATEGORIES: readonly (readonly [string, string])[] = [
  ['Feature table and sequence', 'Feature table and sequence'],
  ['Feature table', 'Feature table'],
  ['Sequence', 'Sequence'],
  ['Skipped ', 'Skipped feature'],
  ['Record at line', 'Record left out'],
  ['Only the first', 'Extra records'],
];

/** The fixed category a warning falls in; `other` when its start is not one we know. */
export function warningCategory(message: string): string {
  for (const [prefix, name] of WARNING_CATEGORIES) {
    if (message.startsWith(prefix)) return name;
  }
  return 'other';
}

export interface WarningFacts {
  readonly kind: 'warnings';
  readonly format: string;
  readonly extension: string;
  /** Category (a fixed word) to how many warnings, and the lines they name. */
  readonly categories: readonly { name: string; count: number; lines: readonly number[] }[];
}

/** At most this many line numbers are listed per category. */
const MAX_LINES = 8;

/** The facts of the warnings an opened file raised: counts, categories and lines. */
export function warningFacts(
  warnings: readonly { readonly message: string; readonly line?: number }[],
  fileName: string | null,
): WarningFacts {
  const byName = new Map<string, { count: number; lines: number[] }>();
  for (const w of warnings) {
    const name = warningCategory(w.message);
    const entry = byName.get(name) ?? { count: 0, lines: [] };
    entry.count++;
    if (w.line !== undefined && entry.lines.length < MAX_LINES && !entry.lines.includes(w.line)) {
      entry.lines.push(w.line);
    }
    byName.set(name, entry);
  }
  return {
    kind: 'warnings',
    format: fileName === null ? 'other' : formatOfFileName(fileName),
    extension: reportExtension(fileName),
    categories: [...byName].map(([name, v]) => ({ name, count: v.count, lines: v.lines })),
  };
}

/** The report of warnings raised by a file that did open, where content may have been left out. */
export function warningReport(facts: WarningFacts, env: ReportEnvironment): Report {
  const total = facts.categories.reduce((n, c) => n + c.count, 0);
  return {
    subject: `PlasmidPop problem report: ${facts.format}:warnings (${env.version})`,
    body: [
      ...head(env),
      'The file opened, with warnings: parts of it may have been left out.',
      `Format (from the extension): ${facts.format}`,
      `Extension: ${facts.extension}`,
      `Warnings: ${String(total)}`,
      ...facts.categories.map(
        (c) =>
          `- ${c.name}: ${String(c.count)}${c.lines.length === 0 ? '' : `, at line ${c.lines.join(', ')}`}`,
      ),
      '',
      CLOSING,
    ].join('\n'),
  };
}

/** A mailto link carrying the report; the user's mail client opens with it ready to read and send. */
export function mailtoUrl(address: string, report: Report): string {
  return `mailto:${address}?subject=${encodeURIComponent(report.subject)}&body=${encodeURIComponent(report.body).replace(/%0A/g, '%0D%0A')}`;
}
