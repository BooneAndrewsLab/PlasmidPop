import { Cell, type DifferenceRegion, isDifference, type Stack } from './alignmentStack';
import { ColumnClass } from './alignmentTrack';
import { isGood } from './alignmentVerdict';

/**
 * Which differences Next/Previous stop at in the large view (#122). With
 * dozens of reads most differences are poor calls at a read's ends; the
 * filter lets the walk skip them. It only narrows the stops and the counter:
 * the overview, the body and the differences list still show every one.
 */

/** Where a difference must fall: anywhere, in any feature, or in a CDS (or found ORF). */
export type DifferenceWhere = 'any' | 'feature' | 'cds';

export interface DifferenceFilter {
  readonly where: DifferenceWhere;
  /** Only where a carrying sample's base is at or above `readConfidentQuality`. */
  readonly goodQuality: boolean;
  /** Only where the picked sample carries it; no effect while none is picked. */
  readonly pickedOnly: boolean;
  /** Not the differences marked reviewed or taken into the document (#123). */
  readonly skipReviewed: boolean;
}

/** Every difference, reviewed or not. */
export const NO_FILTER: DifferenceFilter = {
  where: 'any',
  goodQuality: false,
  pickedOnly: false,
  skipReviewed: false,
};

/** What a first opening starts with: everything but what was already looked at. */
export const DEFAULT_FILTER: DifferenceFilter = { ...NO_FILTER, skipReviewed: true };

export const DIFFERENCE_WHERE: readonly {
  readonly key: DifferenceWhere;
  readonly label: string;
}[] = [
  { key: 'any', label: 'Anywhere' },
  { key: 'feature', label: 'In a feature' },
  { key: 'cds', label: 'In a CDS or ORF' },
];

export interface FilterContext {
  /** Per column, a `ColumnClass` (`classifyColumns`); null without a document, when only 'any' passes. */
  readonly classes: Uint8Array | null;
  readonly confidentFrom: number;
  /** The picked row of the stack, or null. */
  readonly pickedRow: number | null;
  /** Indices into the regions of those marked reviewed or taken. */
  readonly reviewed: ReadonlySet<number>;
}

/** The highest class of any column in the region. */
function classOf(classes: Uint8Array | null, region: DifferenceRegion): number {
  if (classes === null) return ColumnClass.None;
  let top: number = ColumnClass.None;
  for (let c = region.start; c < region.end; c++) top = Math.max(top, classes[c] ?? 0);
  return top;
}

/**
 * The indices of the regions the filter lets through, ascending. A region
 * passes when one of the rows considered (the picked one, or every row)
 * has a differing cell in it that is, when asked, at good quality: the same
 * test the verdict uses (`isGood`), so a deletion counts and a read without
 * qualities is trusted.
 */
export function filterRegions(
  stack: Stack,
  regions: readonly DifferenceRegion[],
  filter: DifferenceFilter,
  context: FilterContext,
): number[] {
  const { classes, confidentFrom, pickedRow, reviewed } = context;
  const needed =
    filter.where === 'cds'
      ? ColumnClass.Cds
      : filter.where === 'feature'
        ? ColumnClass.Feature
        : ColumnClass.None;
  const rows =
    filter.pickedOnly && pickedRow !== null
      ? stack.rows.slice(pickedRow, pickedRow + 1)
      : stack.rows;
  const out: number[] = [];
  regions.forEach((region, i) => {
    if (filter.skipReviewed && reviewed.has(i)) return;
    if (classOf(classes, region) < needed) return;
    const carried = rows.some((row) => {
      for (let c = region.start; c < region.end; c++) {
        const cell = row.cells[c] ?? Cell.Blank;
        if (!isDifference(cell)) continue;
        if (!filter.goodQuality || isGood(cell, row.qualities?.[c], confidentFrom)) return true;
      }
      return false;
    });
    if (carried) out.push(i);
  });
  return out;
}

/** Whether the filter asks for anything beyond skipping reviewed differences. */
export function narrows(filter: DifferenceFilter, picked: boolean): boolean {
  return filter.where !== 'any' || filter.goodQuality || (filter.pickedOnly && picked);
}

/**
 * The counter beside Next/Previous: "41 differences", "12 of 41 differences"
 * when the filter leaves some out, "3 of 12" once on a stop that passes it.
 * `position` is the stop's place among the passing ones, or null.
 */
export function counterText(passing: number, total: number, position: number | null): string {
  if (position !== null) return `${(position + 1).toLocaleString()} of ${passing.toLocaleString()}`;
  const noun = total === 1 ? 'difference' : 'differences';
  return passing === total
    ? `${total.toLocaleString()} ${noun}`
    : `${passing.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
}
