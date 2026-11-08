import {
  type CloningBatchRecipe,
  type DesignRow,
  type OrderOligo,
  type PrimerDraft,
  type Protocol,
  type SeqDocument,
  KIT_NAMES,
  buildProtocol,
  cleanPrimer,
  renameProtocolOligos,
} from '@/core';
import { writeGenBank } from '@/io';

import { type CloningBatchRow } from './cloningBatch';
import { type BatchSortKey } from './batchResults';

/**
 * What the Batch page shows of a cloning run (#360, item 141): the runner's
 * rows as lines of one table, the oligos they save and order, the constructs
 * a zip holds and the protocols a batch protocol joins. Pure, so the page is
 * only layout. The primer batch's counterpart is `batchResults.ts`.
 */

/** A part of an oligo, 5′→3′, as the Cloning page tells them apart. */
export interface OligoPart {
  readonly kind: 'padding' | 'site' | 'spacer' | 'extra' | 'tail' | 'annealing';
  readonly text: string;
}

export interface CloningOligo {
  /** 5′→3′, as it is ordered: the tail in lower case, what anneals in upper (a kit's tail in upper). */
  readonly sequence: string;
  readonly tm: number;
  readonly parts: readonly OligoPart[];
}

/** One row of the cloning results table. */
export interface CloningLine {
  readonly index: number;
  readonly line: number;
  readonly name: string;
  readonly status: 'designed' | 'failed';
  readonly recipe: CloningBatchRecipe['recipe'] | null;
  readonly forward: CloningOligo | null;
  readonly reverse: CloningOligo | null;
  /** The forward primer's Tm, which the table sorts by. */
  readonly forwardTm: number | null;
  /** The construct in bases, or null when none was made. */
  readonly product: number | null;
  /** The row's warnings, or what went wrong with it. */
  readonly messages: readonly string[];
  /** The kit's name, for a homology row. */
  readonly kit: string | null;
}

function parts(entries: readonly (readonly [OligoPart['kind'], string])[]): OligoPart[] {
  return entries.filter(([, text]) => text !== '').map(([kind, text]) => ({ kind, text }));
}

export function cloningLine(row: CloningBatchRow): CloningLine {
  const base = { index: row.index, line: row.line, name: row.name };
  if (row.status === 'failed') {
    return {
      ...base,
      status: 'failed',
      recipe: null,
      forward: null,
      reverse: null,
      forwardTm: null,
      product: null,
      messages: [row.message],
      kit: null,
    };
  }
  const common = {
    ...base,
    status: 'designed' as const,
    product: row.product?.length ?? null,
    messages: row.warnings,
  };
  if (row.recipe === 'homology') {
    const made = row.design.primers;
    const oligo = (p: NonNullable<typeof made>['forward']): CloningOligo => ({
      sequence: p.sequence,
      tm: p.tm,
      parts: parts([
        ['tail', p.tail],
        ['annealing', p.sequence.slice(p.tail.length)],
      ]),
    });
    return {
      ...common,
      recipe: 'homology',
      forward: made === null ? null : oligo(made.forward),
      reverse: made === null ? null : oligo(made.reverse),
      forwardTm: made?.forward.tm ?? null,
      kit: KIT_NAMES[row.kit],
    };
  }
  // The tail in lower case and what anneals in upper, as the Cloning page's oligos are.
  const oligo = (p: typeof row.design.forward): CloningOligo => ({
    sequence: p.sequence,
    tm: p.tm,
    parts: parts([
      ['padding', p.segments.padding.toLowerCase()],
      ['site', p.segments.site.toLowerCase()],
      ['spacer', p.segments.spacer.toLowerCase()],
      ['extra', (p.segments.extra ?? '').toLowerCase()],
      ['annealing', p.segments.annealing.toUpperCase()],
    ]),
  });
  return {
    ...common,
    recipe: row.recipe,
    forward: oligo(row.design.forward),
    reverse: oligo(row.design.reverse),
    forwardTm: row.design.forward.tm,
    kit: null,
  };
}

export function cloningLines(rows: readonly CloningBatchRow[]): CloningLine[] {
  return rows.map(cloningLine);
}

/** The order of the table's columns: the row, then the name, status, product and the forward Tm. */
export type CloningSortKey = BatchSortKey;

/** The oligos of the designed rows, named `name fwd` and `name rev`; what Save all and the order sheet hold. */
function oligosOf(
  lines: readonly CloningLine[],
): { name: string; line: CloningLine; o: CloningOligo }[] {
  return lines.flatMap((l) =>
    l.forward === null || l.reverse === null
      ? []
      : [
          { name: `${l.name} fwd`, line: l, o: l.forward },
          { name: `${l.name} rev`, line: l, o: l.reverse },
        ],
  );
}

/** What the order sheet takes: the two oligos of each designed row, the row's first warning as the note. */
export function cloningOrderOligos(lines: readonly CloningLine[]): OrderOligo[] {
  return oligosOf(lines).map(({ name, line, o }) => ({
    name,
    sequence: o.sequence,
    note: line.messages[0] ?? '',
  }));
}

/** What Save all puts in My primers: the same oligos, as the Cloning page saves its own, with where they came from. */
export function cloningDrafts(lines: readonly CloningLine[], vectorName: string): PrimerDraft[] {
  return oligosOf(lines).map(({ name, line, o }) => ({
    name,
    sequence: o.sequence,
    notes: `Batch ${
      line.kit === null
        ? line.recipe === 'golden-gate'
          ? 'Golden Gate part'
          : 'restriction cloning'
        : `${line.kit} ends`
    } of ${line.name} into ${vectorName}; Tm of the annealing part ${o.tm.toFixed(1)} °C`,
  }));
}

/** The file name a construct is written under: the row's name, safe for a path, and not one already used. */
export function constructFileNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const stem = name.replace(/[^\w.+-]+/g, '_').replace(/^[._]+|[._]+$/g, '') || 'construct';
    let candidate = stem;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}_${String(n)}`;
    used.add(candidate.toLowerCase());
    return `${candidate}.gb`;
  });
}

/** The rows that made a construct. */
export function constructRows(
  rows: readonly CloningBatchRow[],
): { readonly row: CloningBatchRow; readonly product: SeqDocument }[] {
  return rows.flatMap((row) =>
    row.status === 'designed' && row.product !== null ? [{ row, product: row.product }] : [],
  );
}

/** One GenBank file per construct, for the zip; the entries are named for the rows. */
export function constructEntries(
  rows: readonly CloningBatchRow[],
): { readonly path: string; readonly data: Uint8Array }[] {
  const made = constructRows(rows);
  const names = constructFileNames(made.map((m) => m.row.name));
  const encoder = new TextEncoder();
  return made.map((m, i) => ({
    path: names[i] ?? `construct_${String(i + 1)}.gb`,
    data: encoder.encode(writeGenBank(m.product)),
  }));
}

/** The oligos by upper-case bases, called as Save all and the order sheet call them. */
function oligoNames(lines: readonly CloningLine[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const { name, o } of oligosOf(lines)) {
    const key = cleanPrimer(o.sequence).toUpperCase();
    if (!names.has(key)) names.set(key, name);
  }
  return names;
}

export interface BatchProtocolParts {
  /** One protocol per construct, its oligos named as the order sheet names them. */
  readonly protocols: readonly Protocol[];
  /** The rows with no protocol: no construct, or one with no record of how it was made. */
  readonly without: readonly string[];
}

/**
 * The per-construct protocols of a run (`buildProtocol` on each product, which
 * carries its lineage), the oligos renamed as Save all and the order sheet
 * name them so a name means one oligo across the document. Gives the page
 * a turn between constructs, as a hundred in silico digests would not.
 */
export async function batchProtocols(
  rows: readonly CloningBatchRow[],
  options: Parameters<typeof buildProtocol>[1],
): Promise<BatchProtocolParts> {
  const lines = cloningLines(rows);
  const names = oligoNames(lines);
  const protocols: Protocol[] = [];
  const without: string[] = [];
  for (const row of rows) {
    if (row.status !== 'designed') continue;
    // A protocol digests its product in silico: leave the page free between constructs.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const made = row.product === null ? null : buildProtocol(row.product, options);
    if (made === null) without.push(row.name);
    else
      protocols.push({
        ...renameProtocolOligos(made, names),
        product: made.product === row.name ? row.name : `${row.name}: ${made.product}`,
      });
  }
  return { protocols, without };
}

/** The columns each recipe reads besides the name, as the table's headers spell them. */
export const RECIPE_COLUMNS: Readonly<Record<CloningBatchRecipe['recipe'], readonly string[]>> = {
  restriction: ['template', 'region', 'sequence', 'enzyme', 'left', 'right', 'tm'],
  'golden-gate': [
    'template',
    'region',
    'sequence',
    'enzyme',
    'left',
    'right',
    'include_start',
    'include_stop',
    'tm',
  ],
  homology: ['template', 'region', 'sequence', 'kit'],
};

/** The columns set in some row that the recipe does not read, so the page can say so before the run. */
export function ignoredColumns(
  rows: readonly DesignRow[],
  recipe: CloningBatchRecipe['recipe'],
): string[] {
  const read = RECIPE_COLUMNS[recipe];
  const set = new Set<string>();
  for (const { overrides: o } of rows) {
    const named: [string, unknown][] = [
      ['tm', o.tm],
      ['size', o.size],
      ['enzyme', o.enzyme],
      ['left', o.left],
      ['right', o.right],
      ['include_start', o.includeStart],
      ['include_stop', o.includeStop],
      ['kit', o.kit],
      ['change', o.change],
    ];
    for (const [column, value] of named)
      if (value !== undefined && !read.includes(column)) set.add(column);
  }
  return [...set];
}
