import {
  type BatchTemplate,
  type DesignRow,
  type OrderOligo,
  type PoolOligo,
  type PrimerDraft,
  type SeqDocument,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { type PrimerBatchRow } from './primerBatch';
import { type SortState } from './components/tableKeys';
import { pairPreview } from './components/primerDesign';

/**
 * What the Batch page shows of a run (#358, item 141): the runner's rows
 * as lines of one table, their order, the oligos they save and the pool
 * check reads, and the preview a selected row draws on the map. Pure, so the
 * page is only layout.
 */

export type BatchSortKey = 'row' | 'name' | 'status' | 'product' | 'tm';

export const DEFAULT_BATCH_SORT: SortState<BatchSortKey> = { key: 'row', dir: 'asc' };

/** One row of the results table. */
export interface ResultLine {
  readonly index: number;
  /** The line of the table the row came from. */
  readonly line: number;
  readonly name: string;
  readonly status: 'designed' | 'failed';
  readonly kind: 'primers' | 'mutagenesis' | null;
  readonly forward: string;
  readonly reverse: string;
  readonly forwardTm: number | null;
  readonly reverseTm: number | null;
  /** The amplicon, or the mutant plasmid, in bases. */
  readonly product: number | null;
  /** The row's warnings, or what went wrong with it. */
  readonly messages: readonly string[];
}

export function resultLine(row: PrimerBatchRow): ResultLine {
  const base = { index: row.index, line: row.line, name: row.name };
  if (row.status === 'failed') {
    return {
      ...base,
      status: 'failed',
      kind: null,
      forward: '',
      reverse: '',
      forwardTm: null,
      reverseTm: null,
      product: null,
      messages: [row.message],
    };
  }
  if (row.kind === 'primers') {
    // The best pair, as the Design page lists it first.
    const pair = row.pairs[0];
    return {
      ...base,
      status: 'designed',
      kind: 'primers',
      forward: pair?.forward.sequence ?? '',
      reverse: pair?.reverse.sequence ?? '',
      forwardTm: pair?.forward.tm ?? null,
      reverseTm: pair?.reverse.tm ?? null,
      product: pair?.productLength ?? null,
      messages: row.warnings,
    };
  }
  return {
    ...base,
    status: 'designed',
    kind: 'mutagenesis',
    forward: row.design.forward.sequence,
    reverse: row.design.reverse.sequence,
    forwardTm: row.design.forward.tm,
    reverseTm: row.design.reverse.tm,
    product: row.design.mutant.length,
    messages: row.warnings,
  };
}

export function resultLines(rows: readonly PrimerBatchRow[]): ResultLine[] {
  return rows.map(resultLine);
}

/** A column's value for ordering; a row without one goes last whichever way it is turned. */
function keyOf(line: ResultLine, key: BatchSortKey): number | string | null {
  switch (key) {
    case 'row':
      return line.index;
    case 'name':
      return line.name.toLowerCase();
    case 'status':
      return line.status === 'failed' ? 0 : line.messages.length > 0 ? 1 : 2;
    case 'product':
      return line.product;
    case 'tm':
      return line.forwardTm;
  }
}

export function sortLines(
  lines: readonly ResultLine[],
  sort: SortState<BatchSortKey>,
): ResultLine[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...lines].sort((a, b) => {
    const x = keyOf(a, sort.key);
    const y = keyOf(b, sort.key);
    if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
    const c =
      typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return c === 0 ? a.index - b.index : sign * c;
  });
}

/** The status chip's word for a line. */
export function statusOf(line: ResultLine): 'designed' | 'warnings' | 'failed' {
  return line.status === 'failed' ? 'failed' : line.messages.length > 0 ? 'warnings' : 'designed';
}

/** Both oligos of every designed row, named `name fwd` and `name rev`, bases upper case. */
export function batchOligos(lines: readonly ResultLine[]): PoolOligo[] {
  return lines.flatMap((l) =>
    l.status === 'failed'
      ? []
      : [
          { name: `${l.name} fwd`, sequence: l.forward.toUpperCase() },
          { name: `${l.name} rev`, sequence: l.reverse.toUpperCase() },
        ],
  );
}

/** The oligos of the order sheet: the same two per designed row, with the row's first warning as the note. */
export function batchOrderOligos(lines: readonly ResultLine[]): OrderOligo[] {
  return lines.flatMap((l) =>
    l.status === 'failed'
      ? []
      : [
          { name: `${l.name} fwd`, sequence: l.forward, note: l.messages[0] ?? '' },
          { name: `${l.name} rev`, sequence: l.reverse, note: l.messages[0] ?? '' },
        ],
  );
}

/** What Save all puts in My primers: the same oligos, with a note of where they came from. */
export function batchDrafts(lines: readonly ResultLine[], templateNote: string): PrimerDraft[] {
  const note = (l: ResultLine, tm: number | null): string =>
    `Batch design${templateNote === '' ? '' : ` for ${templateNote}`}; ${l.kind === 'mutagenesis' ? 'mutagenesis' : 'primer pair'}${tm === null ? '' : `, Tm ${tm.toFixed(1)} °C`}`;
  return lines.flatMap((l) =>
    l.status === 'failed'
      ? []
      : [
          {
            name: `${l.name} fwd`,
            sequence: l.forward.toUpperCase(),
            notes: note(l, l.forwardTm),
          },
          {
            name: `${l.name} rev`,
            sequence: l.reverse.toUpperCase(),
            notes: note(l, l.reverseTm),
          },
        ],
  );
}

/**
 * What the map draws for the selected row: the pair's sites and product, or
 * the stretch a mutagenesis row changes. Only for a row designed on the
 * document in front as it was then: another template has other coordinates,
 * and an edited document has moved them.
 */
export function rowPreview(
  row: PrimerBatchRow | undefined,
  source: DesignRow | undefined,
  front: SeqDocument,
  ranOn: SeqDocument | null,
  templates: readonly BatchTemplate[],
): OverlaySpan[] {
  if (row === undefined || row.status === 'failed' || source === undefined) return [];
  if (ranOn !== front || source.source.kind !== 'region' || source.template === null) return [];
  const wanted = source.template.toLowerCase();
  const used = templates.find((t) => t.name === source.template || t.name.toLowerCase() === wanted);
  if (used?.document !== front) return [];
  if (row.kind === 'primers') {
    const pair = row.pairs[0];
    return pair === undefined ? [] : pairPreview(pair, row.index + 1, front.length);
  }
  return [
    {
      id: 'change',
      label: row.design.label,
      range: source.source.range,
      strand: 'none',
      shape: 'span',
    },
  ];
}
