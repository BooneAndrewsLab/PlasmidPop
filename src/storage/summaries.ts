import { type DocumentKind } from './db';

/** How many kept files Recent files shows before "Browse all files…" (item 111). */
export const RECENT_FILES_LIMIT = 6;

/** What listing, searching, sorting and grouping stored documents need of each. */
export interface ListedRow {
  readonly id: string;
  readonly name: string;
  readonly fileName: string | null;
  readonly length: number;
  readonly kind: DocumentKind;
  readonly updatedAt: number;
  readonly parentChecksum?: string;
  readonly parentName?: string;
}

/** What the browse panel orders by. */
export type SortKey = 'updated' | 'name' | 'size';

/** The rows whose name or file name contains `query` (case aside); all of them for a blank query. */
export function searchRows<T extends ListedRow>(rows: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter(
    (r) =>
      r.name.toLowerCase().includes(needle) ||
      (r.fileName?.toLowerCase().includes(needle) ?? false),
  );
}

/**
 * The rows in the order of `key`: most recently updated first, by name
 * (numbers in names ordered as numbers: pUC2 before pUC10), or largest
 * first. Ties keep the order given, so a listing does not shuffle.
 */
export function sortRows<T extends ListedRow>(rows: readonly T[], key: SortKey): T[] {
  const order: Record<SortKey, (a: T, b: T) => number> = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    size: (a, b) => b.length - a.length,
  };
  return [...rows].sort(order[key]);
}

/** One line of a listing: a document, or the products of one parent shown together. */
export type ListEntry<T extends ListedRow> =
  | { readonly type: 'row'; readonly row: T }
  | {
      readonly type: 'group';
      readonly parentChecksum: string;
      readonly parentName: string;
      readonly rows: readonly T[];
    };

/**
 * Folds the scratch documents that share a parent into one entry each
 * (item 111), in the place of the first of them, the rest in the order
 * given. A kept document, one with no parent, and a scratch document alone
 * with its parent stay rows: a group is for two or more.
 */
export function groupByParent<T extends ListedRow>(rows: readonly T[]): ListEntry<T>[] {
  const members = new Map<string, T[]>();
  for (const r of rows) {
    if (r.kind !== 'scratch' || r.parentChecksum === undefined) continue;
    const list = members.get(r.parentChecksum);
    if (list === undefined) members.set(r.parentChecksum, [r]);
    else list.push(r);
  }
  const entries: ListEntry<T>[] = [];
  const placed = new Set<string>();
  for (const r of rows) {
    const key = r.kind === 'scratch' ? r.parentChecksum : undefined;
    const group = key === undefined ? undefined : members.get(key);
    if (key === undefined || group === undefined || group.length < 2) {
      entries.push({ type: 'row', row: r });
    } else if (!placed.has(key)) {
      placed.add(key);
      entries.push({
        type: 'group',
        parentChecksum: key,
        parentName: group.find((g) => g.parentName !== undefined)?.parentName ?? 'Untitled',
        rows: group,
      });
    }
  }
  return entries;
}
