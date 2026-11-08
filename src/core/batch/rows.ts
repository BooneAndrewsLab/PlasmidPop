import { codonSpan, isCodingFeature, isPartCodon, translateCds } from '../analysis/cdsTranslation';
import { type TranslationTable, translateCodon } from '../analysis/codons';
import { codonOnForwardStrand } from '../cloning/mutagenesis';
import { type SeqDocument } from '../document';
import {
  type Feature,
  type Segment,
  type Strand,
  LocationError,
  formatLocation,
  parseLocation,
  rangeSegment,
} from '../features';
import { type Range, type Topology, range, rangeLength } from '../range';
import { complement, isValidSequence } from '../sequence';
import { type BatchCells, type BatchColumn, type BatchTable, type RawRow } from './table';

/**
 * Checking a batch's rows before anything is designed (#358, #360, item
 * 141). Each row is either a `DesignRow`, with its template found, its
 * region read as a range of that template and its options as values, or a
 * line and the one thing wrong with it. A bad row never stops the others:
 * the good rows run and the bad ones are listed.
 */

/** The most rows a batch takes: a 96-well plate, as the read batch takes (item 59). */
export const BATCH_ROW_LIMIT = 96;

/** A sequence a row can name as its template: an open tab or a loaded record. */
export interface BatchTemplate {
  readonly name: string;
  readonly document: SeqDocument;
}

export interface BatchContext {
  readonly templates: readonly BatchTemplate[];
  /** The template a row with no template cell uses: the document in front. */
  readonly defaultTemplate?: string | undefined;
}

/** What a row is designed around. */
export type DesignSource =
  /** Bases typed in the row: no template is needed to read them. */
  | { readonly kind: 'sequence'; readonly bases: string }
  /** The whole template, as a row with no region and no sequence means. */
  | { readonly kind: 'whole'; readonly range: Range }
  /**
   * A stretch of the template. `range` is 0-based half-open on the forward
   * strand and wraps the origin of a circular template (`end > length`); a
   * `join(...)` is the span from its first base to its last.
   */
  | {
      readonly kind: 'region';
      readonly range: Range;
      readonly strand: Strand;
      /** The region as written in the row. */
      readonly text: string;
    };

/** The per-row options the table can carry; a row that has none leaves the batch's setting alone. */
export interface DesignOverrides {
  readonly tm?: number;
  readonly size?: number;
  readonly enzyme?: string;
  /** Bases added to the 5′ end of the forward primer. */
  readonly left?: string;
  /** Bases added to the 5′ end of the reverse primer. */
  readonly right?: string;
  readonly includeStart?: boolean;
  readonly includeStop?: boolean;
  readonly kit?: string;
  /** The bases a mutagenesis row writes over its region; empty deletes it. */
  readonly change?: string;
}

export interface DesignRow {
  readonly line: number;
  readonly name: string;
  /** The template's name, or null for a row that has only bases. */
  readonly template: string | null;
  readonly source: DesignSource;
  readonly overrides: DesignOverrides;
  readonly notes: string;
  /** Things the row reads differently from what it says, such as a `join(...)` taken as a span. */
  readonly warnings: readonly string[];
}

export type RowResult =
  | { readonly ok: true; readonly row: DesignRow }
  | {
      readonly ok: false;
      readonly line: number;
      /** The row's name, empty when it has none. */
      readonly name: string;
      readonly message: string;
    };

class RowError extends Error {}

function fail(message: string): never {
  throw new RowError(message);
}

// ------------------------------------------------------------------ reading cells

/** `text` as bases: spaces dropped, U read as T; names what is left over when it is not IUPAC. */
function readBases(text: string, what: string): string {
  const bases = text.replace(/\s+/g, '').toUpperCase().replace(/U/g, 'T');
  if (!isValidSequence(bases)) {
    const odd = [...new Set(bases.replace(/[ACGTRYSWKMBDHVN]/g, ''))]
      .slice(0, 5)
      .map((c) => `“${c}”`)
      .join(', ');
    fail(`The ${what} has ${odd}, which ${odd.includes(',') ? 'are' : 'is'} not an IUPAC base.`);
  }
  return bases;
}

function readBoolean(text: string, what: string): boolean {
  const t = text.trim().toLowerCase();
  if (['yes', 'y', 'true', 't', '1', 'x'].includes(t)) return true;
  if (['no', 'n', 'false', 'f', '0'].includes(t)) return false;
  return fail(`${what} is “${text}”: write yes or no.`);
}

function readOverrides(cells: BatchCells): DesignOverrides {
  const out: { -readonly [K in keyof DesignOverrides]: DesignOverrides[K] } = {};
  const { tm, size, enzyme, left, right, include_start, include_stop, kit, change } = cells;
  if (tm !== undefined) {
    const n = Number(tm.replace(/\s*°?\s*c$/i, ''));
    if (!Number.isFinite(n) || n <= 0 || n > 100) fail(`Tm “${tm}” is not a temperature in °C.`);
    out.tm = n;
  }
  if (size !== undefined) {
    const n = Number(size.replace(/\s*bp$/i, ''));
    if (!Number.isInteger(n) || n <= 0) fail(`Size “${size}” is not a whole number of bases.`);
    out.size = n;
  }
  if (enzyme !== undefined) out.enzyme = enzyme;
  if (left !== undefined) out.left = readBases(left, 'left tail');
  if (right !== undefined) out.right = readBases(right, 'right tail');
  if (include_start !== undefined) out.includeStart = readBoolean(include_start, 'include_start');
  if (include_stop !== undefined) out.includeStop = readBoolean(include_stop, 'include_stop');
  if (kit !== undefined) out.kit = kit;
  if (change !== undefined) {
    out.change = /^(-|del|delete|deletion)$/i.test(change) ? '' : readBases(change, 'change');
  }
  return out;
}

// ------------------------------------------------------------------ templates and regions

function findTemplate(text: string, context: BatchContext): BatchTemplate {
  const exact = context.templates.find((t) => t.name === text);
  if (exact !== undefined) return exact;
  const loose = context.templates.filter((t) => t.name.toLowerCase() === text.toLowerCase());
  if (loose.length === 1 && loose[0] !== undefined) return loose[0];
  if (loose.length > 1)
    return fail(`“${text}” names ${loose.length} templates that differ in case.`);
  return fail(`No template named “${text}”: open it, or load a record of that name.`);
}

/**
 * The span from the first base of a location's first segment to the last
 * base of its last, wrapping a circular template when the pieces are listed
 * across the origin. A site (`5^6`) is the empty range at its position.
 */
function hull(segments: readonly Segment[], length: number, topology: Topology): Range {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (first === undefined || last === undefined) return fail('The region has no bases.');
  const start = first.kind === 'site' ? first.position : first.start;
  let end = last.kind === 'site' ? last.position : last.end;
  if (end < start && topology === 'circular') end += length;
  if (end < start || end - start > length) {
    return fail(`The region runs past the template's ends (1..${length}).`);
  }
  return range(start, end);
}

/** Starts like a GenBank location (`12..40`, `<5..>9`, `join(`, `complement(`), not a feature's name. */
const LOCATION_LIKE = /^(complement|join|order)\s*\(|^[<>]?\d/i;
/** `start-end` as a spreadsheet user writes a range: 12-40, 12–40, 12 to 40, 12:40, 1,200-1,900. */
const SIMPLE_RANGE = /^(\d[\d,]*)\s*(?:-|–|—|:|\.\.|to)\s*(\d[\d,]*)$/i;

interface Resolved {
  readonly range: Range;
  readonly strand: Strand;
  readonly warnings: readonly string[];
}

function resolveRegion(text: string, doc: SeqDocument): Resolved {
  const { length, topology } = doc;
  if (!LOCATION_LIKE.test(text)) {
    const named = doc.features.all().filter((f) => f.name.toLowerCase() === text.toLowerCase());
    if (named.length === 0) return fail(`No feature named “${text}” in the template.`);
    const [only] = named;
    if (named.length > 1 || only === undefined) {
      return fail(`${named.length} features are named “${text}”: give the region as a location.`);
    }
    return {
      range: hull(only.segments, length, topology),
      strand: only.strand,
      warnings: only.segments.length > 1 ? [spanWarning(text)] : [],
    };
  }
  const simple = SIMPLE_RANGE.exec(text);
  const location =
    simple === null ? text : `${simple[1] ?? ''}..${simple[2] ?? ''}`.replace(/,/g, '');
  try {
    const parsed = parseLocation(location, length, topology);
    const warnings = [...parsed.warnings];
    if (parsed.segments.length > 1) warnings.push(spanWarning(text));
    return {
      range: hull(parsed.segments, length, topology),
      strand: parsed.strand,
      warnings,
    };
  } catch (error) {
    if (error instanceof LocationError) {
      const beyond = /outside the sequence|spans the origin of a linear/.test(error.message);
      return fail(
        beyond
          ? `Region “${text}” runs past the template's ends (1..${length}).`
          : `Region “${text}” is not a location: ${error.message}.`,
      );
    }
    throw error;
  }
}

function spanWarning(text: string): string {
  return `“${text}” has several pieces and is read as the span from its first base to its last.`;
}

// ------------------------------------------------------------------ rows

/** One row, checked on its own: duplicate names are the batch's business, `validateBatch`'s. */
export function validateRow(raw: RawRow, context: BatchContext): RowResult {
  const name = raw.cells.name ?? '';
  try {
    if (name === '') fail('The row has no name.');
    const { template: templateText, region, sequence } = raw.cells;
    if (region !== undefined && sequence !== undefined) {
      fail('Give a region or a sequence, not both.');
    }
    const wanted = templateText ?? context.defaultTemplate;
    const template = wanted === undefined ? null : findTemplate(wanted, context);
    if (template === null && sequence === undefined) {
      fail('The row names no template, and no document is in front to use.');
    }
    let source: DesignSource;
    let warnings: readonly string[] = [];
    if (sequence !== undefined) {
      const bases = readBases(sequence, 'sequence');
      if (bases === '') fail('The sequence is empty.');
      source = { kind: 'sequence', bases };
    } else if (template !== null && region !== undefined) {
      const resolved = resolveRegion(region, template.document);
      source = { kind: 'region', range: resolved.range, strand: resolved.strand, text: region };
      warnings = resolved.warnings;
    } else if (template !== null) {
      source = { kind: 'whole', range: range(0, template.document.length) };
    } else {
      return fail('The row has no region or sequence.');
    }
    const row: DesignRow = {
      line: raw.line,
      name,
      template: template?.name ?? null,
      source,
      overrides: readOverrides(raw.cells),
      notes: raw.notes,
      warnings,
    };
    return { ok: true, row };
  } catch (error) {
    if (error instanceof RowError)
      return { ok: false, line: raw.line, name, message: error.message };
    throw error;
  }
}

/** What a row is told when its name was taken by an earlier line. */
export function usedNameMessage(name: string, line: number): string {
  return `The name “${name}” is already used on line ${line}.`;
}

export interface BatchValidation {
  /** One result per row, in the table's order, for the rows within the limit. */
  readonly results: readonly RowResult[];
  /** The rows that can run. */
  readonly rows: readonly DesignRow[];
  /** How many rows came after the limit and were not looked at. */
  readonly overLimit: number;
}

/**
 * Every row of a table checked. A name may be used once (without regard to
 * case, as a vendor's order form treats it): the later row is the bad one,
 * and only a row that is otherwise good takes a name. Rows past
 * `BATCH_ROW_LIMIT` are not checked, and counted in `overLimit`.
 */
export function validateBatch(
  table: BatchTable | readonly RawRow[],
  context: BatchContext,
): BatchValidation {
  const all = 'rows' in table ? table.rows : table;
  const taken = new Map<string, number>();
  const results: RowResult[] = [];
  for (const raw of all.slice(0, BATCH_ROW_LIMIT)) {
    const result = validateRow(raw, context);
    if (result.ok) {
      const key = result.row.name.toLowerCase();
      const before = taken.get(key);
      if (before !== undefined) {
        results.push({
          ok: false,
          line: raw.line,
          name: result.row.name,
          message: usedNameMessage(result.row.name, before),
        });
        continue;
      }
      taken.set(key, raw.line);
    }
    results.push(result);
  }
  const rows = results.flatMap((r) => (r.ok ? [r.row] : []));
  return { results, rows, overLimit: Math.max(0, all.length - BATCH_ROW_LIMIT) };
}

// ------------------------------------------------------------------ scan rows

export interface ScanOptions {
  /** The template the rows name: the document's tab or record name. */
  readonly template: string;
  /** The residue every codon becomes, one letter (`*` for a stop); alanine by default. */
  readonly to?: string;
  /** Row names are `prefix_K12A`; the feature's name by default. */
  readonly prefix?: string;
  /** First and last residue (1-based, inclusive) to include; the whole protein by default. */
  readonly from?: number;
  readonly through?: number;
}

export interface ScanSkip {
  readonly residue: number;
  readonly aminoAcid: string;
  readonly reason: string;
}

export interface ScanRows {
  readonly rows: readonly RawRow[];
  /** The codons left out and why: already the residue, a stop, split by an intron. */
  readonly skipped: readonly ScanSkip[];
}

const BASES = 'ACGT';

/**
 * The codon for `to` that differs from `from` in the fewest bases, so that a
 * scan makes the smallest change it can; the first in A, C, G, T order when
 * several do. Null when the genetic code has no codon for it.
 */
function nearestCodon(from: string, to: string, table: TranslationTable): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const a of BASES) {
    for (const b of BASES) {
      for (const c of BASES) {
        const codon = `${a}${b}${c}`;
        if (translateCodon(codon, table) !== to) continue;
        let distance = 0;
        for (let i = 0; i < 3; i++) if (codon.charAt(i) !== from.charAt(i)) distance++;
        if (distance < bestDistance) {
          best = codon;
          bestDistance = distance;
        }
      }
    }
  }
  return best;
}

/**
 * Rows for a mutagenesis scan (#358): every codon of a coding feature
 * changed to one residue, as ordinary editable rows (`name`, `template`,
 * `region`, `change`), so a scan is checked like pasted rows and the user
 * can drop or change the ones they do not want. The region is the codon on
 * the forward strand, and `change` the new codon written there, so a
 * reverse-strand gene needs no thought; a codon across the origin is a
 * `join(...)`. Codons that cannot be a row are listed in `skipped`.
 */
export function scanRows(doc: SeqDocument, feature: Feature, options: ScanOptions): ScanRows {
  if (!isCodingFeature(feature)) throw new Error(`“${feature.name}” is not a coding feature.`);
  const to = (options.to ?? 'A').toUpperCase();
  const translation = translateCds(doc, feature);
  const prefix = (options.prefix ?? feature.name).trim().replace(/\s+/g, '_');
  const rows: RawRow[] = [];
  const skipped: ScanSkip[] = [];
  if (nearestCodon('AAA', to, translation.table) === null) {
    throw new Error(`The genetic code of “${feature.name}” has no codon for “${to}”.`);
  }
  translation.codons.forEach((codon, index) => {
    const residue = index + 1;
    if (residue < (options.from ?? 1) || residue > (options.through ?? Infinity)) return;
    const skip = (reason: string): void => {
      skipped.push({ residue, aminoAcid: codon.aminoAcid, reason });
    };
    if (isPartCodon(codon)) {
      skip('the two bases a partial CDS ends on are no codon');
      return;
    }
    if (codon.aminoAcid === '*' && to !== '*') {
      skip('a stop codon');
      return;
    }
    if (codon.aminoAcid === to) {
      skip(`already ${to}`);
      return;
    }
    const span = codonSpan(translation, index, index, doc.length);
    if (span === null || rangeLength(span) !== 3) {
      skip('split by an intron');
      return;
    }
    const forward = codon.positions.map((p) => doc.sequence.slice(p, p + 1)).join('');
    const reading = (
      translation.strand === 'reverse' ? complement(forward) : forward
    ).toUpperCase();
    const replacement = nearestCodon(reading, to, translation.table);
    // Stryker disable next-line ConditionalExpression: `to` was checked above, so a codon is always found
    if (replacement === null) {
      skip(`no codon for ${to}`);
      return;
    }
    const cells: Partial<Record<BatchColumn, string>> = {
      name: `${prefix}_${codon.aminoAcid}${residue}${to}`,
      template: options.template,
      region: formatLocation(
        { strand: 'forward', segments: [rangeSegment(span.start, span.end)] },
        doc.length,
        doc.topology,
      ),
      change: codonOnForwardStrand(replacement, translation.strand),
    };
    rows.push({ line: rows.length + 1, cells, notes: '' });
  });
  return { rows, skipped };
}
