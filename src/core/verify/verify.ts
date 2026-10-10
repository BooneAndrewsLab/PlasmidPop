import { type AlignmentOptions, type StrandedAlignment } from '../alignment';
import { alignToDocument, applyAlignment, type MoleculeAlignment } from '../checksum';
import { SeqDocument } from '../document';
import { reverseComplement } from '../sequence/alphabet';

import { type Variant, describeVariant, placeVariants, variantsOf } from './variants';

/**
 * Verify clones (#218): the consensus sequences of a plate of clones each
 * checked against the construct that was meant to be made. A clone goes to
 * the construct it was named for, or else the one it shares the most 16-mers
 * with; it is turned to the construct's origin and strand, aligned end to end
 * (in the analysis worker, one request a clone), and its differences are
 * placed on the construct's features.
 */

export type CloneVerdict =
  /** No difference at all. */
  | 'match'
  /** At least one difference lies inside a feature of the construct. */
  | 'in-feature'
  /** Differences, none inside a feature. */
  | 'outside'
  /** Too little in common with the construct to be it. */
  | 'wrong'
  /** Could not be checked (too large, worker error). */
  | 'failed';

/** Below this identity over the alignment a clone is not the construct. */
export const WRONG_IDENTITY = 0.75;

/** Below this share of a clone's 16-mers found in a construct, the clone is not aligned to it at all. */
export const MIN_SHARED = 0.05;

const K = 16;

export interface Construct {
  readonly name: string;
  readonly doc: SeqDocument;
  /**
   * Text looked for, case-insensitively, in a clone's file name or name to
   * send it to this construct; empty to say nothing. Where several match the
   * longest wins.
   */
  readonly pattern: string;
}

export interface CloneInput {
  /** The file name, or the record's name when a file holds several. */
  readonly name: string;
  readonly doc: SeqDocument;
}

export interface CloneResult {
  readonly name: string;
  readonly length: number;
  /** Index in the constructs given, or null when a clone was not checked. */
  readonly construct: number | null;
  readonly constructName: string;
  readonly verdict: CloneVerdict;
  /** Alignment identity, 0 to 1, or null when not aligned. */
  readonly identity: number | null;
  /** Share of the clone's 16-mers the construct holds, 0 to 1. */
  readonly shared: number;
  readonly variants: readonly Variant[];
  /** Columns matched only through an ambiguity code (an N in the clone, say). */
  readonly ambiguous: number;
  /** How the clone had to be turned to line up, or null for as written. */
  readonly turned: MoleculeAlignment | null;
  readonly strand: 'forward' | 'reverse';
  /** True when the aligner could not check its answer was the best (#171). */
  readonly unchecked: boolean;
  /** Whether the construct was chosen by file name rather than by sequence. */
  readonly byName: boolean;
  readonly message: string | null;
}

/** One alignment in the worker, or a stand-in in tests. */
export type VerifyAlign = (
  a: string,
  b: string,
  options: AlignmentOptions,
  long?: AlignLong,
) => Promise<StrandedAlignment>;

/** Progress and cancel for one alignment, as the worker client takes them. */
export interface AlignLong {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

function kmers(text: string, circular: boolean): Set<string> {
  const ring = circular ? text + text.slice(0, K - 1) : text;
  const out = new Set<string>();
  for (let i = 0; i + K <= ring.length; i++) out.add(ring.slice(i, i + K));
  return out;
}

/** The constructs' 16-mers, both strands, to score clones against. */
export function indexConstructs(constructs: readonly Construct[]): ReadonlySet<string>[] {
  return constructs.map((c) => {
    const text = c.doc.sequence.toString().toUpperCase();
    const circular = c.doc.topology === 'circular';
    const both = kmers(text, circular);
    for (const k of kmers(reverseComplement(text), circular)) both.add(k);
    return both;
  });
}

/** The share of `text`'s 16-mers that `index` holds. */
export function sharedShare(text: string, index: ReadonlySet<string>): number {
  let total = 0;
  let found = 0;
  for (let i = 0; i + K <= text.length; i++) {
    total++;
    if (index.has(text.slice(i, i + K))) found++;
  }
  return total === 0 ? 0 : found / total;
}

/**
 * The construct a clone goes to: the one whose pattern is in its name (the
 * longest, if several), else the one sharing most of its 16-mers (the first
 * on a tie). Null only when no construct is given.
 */
export function chooseConstruct(
  name: string,
  text: string,
  constructs: readonly Construct[],
  index: readonly ReadonlySet<string>[],
): { readonly index: number; readonly shared: number; readonly byName: boolean } | null {
  if (constructs.length === 0) return null;
  const lower = name.toLowerCase();
  let named = -1;
  let longest = 0;
  constructs.forEach((c, i) => {
    const p = c.pattern.trim().toLowerCase();
    if (p.length > longest && lower.includes(p)) {
      named = i;
      longest = p.length;
    }
  });
  if (named >= 0) {
    return { index: named, shared: sharedShare(text, index[named] ?? new Set()), byName: true };
  }
  let best = 0;
  let bestShare = -1;
  constructs.forEach((_c, i) => {
    const s = sharedShare(text, index[i] ?? new Set());
    if (s > bestShare) {
      best = i;
      bestShare = s;
    }
  });
  return { index: best, shared: bestShare, byName: false };
}

/** Bases of the construct's start or end looked for in the clone to find where its origin is. */
const ORIGIN_ANCHOR = 24;

function rotate(text: string, origin: number): string {
  return origin === 0 ? text : text.slice(origin) + text.slice(0, origin);
}

/**
 * Where on the circle `text` the construct's first base is, when its first
 * (or else its last) 24 bases are found there exactly and once; null when a
 * difference in them or a repeat leaves that open.
 */
export function exactOrigin(construct: string, text: string): number | null {
  const n = text.length;
  if (construct.length < 2 * ORIGIN_ANCHOR || n < 2 * ORIGIN_ANCHOR) return null;
  const ring = text + text.slice(0, ORIGIN_ANCHOR - 1);
  const once = (anchor: string): number | null => {
    const at = ring.indexOf(anchor);
    return at < 0 || at >= n || ring.slice(at + 1).includes(anchor) ? null : at;
  };
  const first = once(construct.slice(0, ORIGIN_ANCHOR));
  if (first !== null) return first;
  const last = once(construct.slice(-ORIGIN_ANCHOR));
  return last === null ? null : (last + ORIGIN_ANCHOR) % n;
}

function failed(
  clone: CloneInput,
  construct: Construct | null,
  index: number | null,
  message: string,
  shared = 0,
): CloneResult {
  return {
    name: clone.name,
    length: clone.doc.length,
    construct: index,
    constructName: construct?.name ?? '',
    verdict: 'failed',
    identity: null,
    shared,
    variants: [],
    ambiguous: 0,
    turned: null,
    strand: 'forward',
    unchecked: false,
    byName: false,
    message,
  };
}

/**
 * One clone checked. `index` is `indexConstructs(constructs)`, built once for
 * the plate. Never throws: a clone that cannot be aligned is a `failed` row.
 */
export async function verifyClone(
  clone: CloneInput,
  constructs: readonly Construct[],
  index: readonly ReadonlySet<string>[],
  align: VerifyAlign,
  long: AlignLong = {},
): Promise<CloneResult> {
  const text = clone.doc.sequence.toString().toUpperCase();
  if (clone.doc.isProtein)
    return failed(clone, null, null, 'A protein cannot be checked against DNA.');
  if (text === '') return failed(clone, null, null, 'The sequence is empty.');
  const chosen = chooseConstruct(clone.name, text, constructs, index);
  if (chosen === null) return failed(clone, null, null, 'No expected construct was chosen.');
  const construct = constructs[chosen.index];
  // Stryker disable ConditionalExpression,StringLiteral: `chooseConstruct` answers an index into `constructs`; this narrows the type for `noUncheckedIndexedAccess`
  if (construct === undefined)
    return failed(clone, null, null, 'No expected construct was chosen.');
  // Stryker restore ConditionalExpression,StringLiteral
  const expected = construct.doc;
  const base = {
    name: clone.name,
    length: clone.doc.length,
    construct: chosen.index,
    constructName: construct.name,
    shared: chosen.shared,
    byName: chosen.byName,
  };
  // Nothing in common: aligning it would only say so slowly.
  if (!chosen.byName && chosen.shared < MIN_SHARED) {
    return {
      ...base,
      verdict: 'wrong',
      identity: null,
      variants: [],
      ambiguous: 0,
      turned: null,
      strand: 'forward',
      unchecked: false,
      message: null,
    };
  }
  try {
    const mine = expected.sequence.toString().toUpperCase();
    // A circle is turned to the construct's origin and strand; a line has only its strand to find.
    let b = text;
    let turned: MoleculeAlignment | null = null;
    if (expected.topology === 'circular') {
      const ring = SeqDocument.create({ name: clone.name, sequence: text, topology: 'circular' });
      turned = alignToDocument(expected, ring);
      const oriented =
        turned === null ? text : applyAlignment(ring, { ...turned, origin: 0 }).sequence.toString();
      // The shared stretches only say where the origin is to within a base
      // or two when the clone has an indel; an exact match of the
      // construct's own first (or last) bases says it exactly.
      const exact = exactOrigin(mine, oriented.toUpperCase());
      if (exact !== null) b = rotate(oriented.toUpperCase(), exact);
      else if (turned !== null) b = applyAlignment(ring, turned).sequence.toString().toUpperCase();
      if (turned !== null && exact !== null) turned = { ...turned, origin: exact, exact: false };
    }
    const best = await align(mine, b, { mode: 'global', fast: true }, long);
    const { alignment } = best;
    const variants = placeVariants(variantsOf(alignment), expected.features, expected.length);
    const wrong = alignment.identity < WRONG_IDENTITY;
    const verdict: CloneVerdict = wrong
      ? 'wrong'
      : variants.length === 0
        ? 'match'
        : variants.some((v) => v.features.length > 0)
          ? 'in-feature'
          : 'outside';
    return {
      ...base,
      verdict,
      identity: alignment.identity,
      variants,
      ambiguous: alignment.ambiguous,
      turned,
      strand: best.strand,
      unchecked: alignment.unchecked === true,
      message: null,
    };
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AnalysisCancelledError') throw e;
    return failed(
      clone,
      construct,
      chosen.index,
      e instanceof Error ? e.message : String(e),
      chosen.shared,
    );
  }
}

/** The words for a verdict, as the table and the CSV say it. */
export const VERDICT_LABELS: Readonly<Record<CloneVerdict, string>> = {
  match: 'Matches',
  'in-feature': 'Differs inside a feature',
  outside: 'Differs outside features',
  wrong: 'Wrong construct',
  failed: 'Could not be checked',
};

/** What differs, in a line: the first few variants, each with the features it is in. */
export function describeResult(r: CloneResult, limit = 3): string {
  if (r.message !== null) return r.message;
  if (r.verdict === 'wrong') {
    return r.identity === null
      ? 'Shares almost nothing with the construct.'
      : `Only ${(r.identity * 100).toFixed(1)}% identical to ${r.constructName}.`;
  }
  const parts = r.variants.slice(0, limit).map((v) => {
    const where = v.features.map((f) => f.text).join('; ');
    return where === '' ? describeVariant(v) : `${describeVariant(v)}: ${where}`;
  });
  if (r.variants.length > limit)
    parts.push(`and ${(r.variants.length - limit).toLocaleString()} more`);
  return parts.join('. ');
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The results as CSV, a row a clone: its construct, verdict, identity,
 * differences and a sentence about them. Every variant is in `details`,
 * separated by `|`.
 */
export function verifyCsv(results: readonly CloneResult[]): string {
  const header = [
    'clone',
    'length',
    'construct',
    'verdict',
    'identity',
    'differences',
    'orientation',
    'details',
  ];
  const rows = results.map((r) => {
    const orientation =
      r.turned === null && r.strand === 'forward'
        ? 'as written'
        : [
            r.strand === 'reverse' || r.turned?.flipped === true ? 'reverse complemented' : '',
            r.turned !== null && r.turned.origin > 0
              ? `rotated to base ${r.turned.origin + 1}`
              : '',
          ]
            .filter((s) => s !== '')
            .join(', ') || 'as written';
    const details =
      r.message ??
      (r.verdict === 'wrong'
        ? describeResult(r)
        : r.variants
            .map((v) => {
              const where = v.features.map((f) => f.text).join('; ');
              return where === '' ? describeVariant(v) : `${describeVariant(v)}: ${where}`;
            })
            .join(' | '));
    return [
      r.name,
      String(r.length),
      r.constructName,
      VERDICT_LABELS[r.verdict],
      r.identity === null ? '' : (r.identity * 100).toFixed(2),
      r.verdict === 'wrong' || r.verdict === 'failed' ? '' : String(r.variants.length),
      orientation,
      details,
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}
