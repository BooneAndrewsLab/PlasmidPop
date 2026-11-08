import { csvCell } from './collection';

/**
 * A vendor-neutral order sheet for a set of oligos (#358, item 141): one CSV
 * line each, with the plate and well it goes in, ready to be pasted into a
 * vendor's template. Pure; the download is the page's.
 */

/** One oligo to order. */
export interface OrderOligo {
  readonly name: string;
  /** 5′→3′; IUPAC codes are written as they are. */
  readonly sequence: string;
  /** What the row's warnings said, the first of them; blank for none. */
  readonly note?: string;
}

/** Wells run along a row (A1, A2, … A12, B1, …) or down a column (A1, B1, … H1, A2, …). */
export type WellOrder = 'row' | 'column';

export interface OrderOptions {
  /** The synthesis scale written on every line. */
  readonly scale?: string;
  readonly purification?: string;
  readonly wellOrder?: WellOrder;
}

export const DEFAULT_ORDER_SCALE = '25 nmol';
export const DEFAULT_ORDER_PURIFICATION = 'desalted';

export const ORDER_HEADER = 'plate,well,name,sequence,length,scale,purification,notes';

/** Wells on a plate: A-H by 1-12. */
export const PLATE_WELLS = 96;
const PLATE_ROWS = 'ABCDEFGH';
const PLATE_COLUMNS = 12;

/** One line of the sheet. */
export interface OrderLine {
  readonly plate: number;
  readonly well: string;
  readonly name: string;
  readonly sequence: string;
  readonly length: number;
  readonly scale: string;
  readonly purification: string;
  readonly notes: string;
}

export interface OrderSheet {
  readonly lines: readonly OrderLine[];
  /** The CSV, `\r\n` line ends, a header and one line per oligo. */
  readonly csv: string;
  /** What a vendor would reject, in words; an order with any is not to be sent. */
  readonly problems: readonly string[];
}

/** The plate (from 1) and well of the oligo at `index` (from 0). */
export function wellOf(index: number, order: WellOrder): { plate: number; well: string } {
  const plate = Math.floor(index / PLATE_WELLS) + 1;
  const at = index % PLATE_WELLS;
  const row = order === 'row' ? Math.floor(at / PLATE_COLUMNS) : at % PLATE_ROWS.length;
  const column = order === 'row' ? at % PLATE_COLUMNS : Math.floor(at / PLATE_ROWS.length);
  return { plate, well: `${PLATE_ROWS.charAt(row)}${column + 1}` };
}

export function buildOrderSheet(
  oligos: readonly OrderOligo[],
  options: OrderOptions = {},
): OrderSheet {
  const scale = options.scale ?? DEFAULT_ORDER_SCALE;
  const purification = options.purification ?? DEFAULT_ORDER_PURIFICATION;
  const order = options.wellOrder ?? 'row';
  const lines: OrderLine[] = oligos.map((o, i) => {
    const sequence = o.sequence.replace(/\s+/g, '').toUpperCase();
    return {
      ...wellOf(i, order),
      name: o.name,
      sequence,
      length: sequence.length,
      scale,
      purification,
      notes: o.note ?? '',
    };
  });
  const problems: string[] = [];
  // Without regard to case, as the pool check and a vendor's form treat names.
  const used = new Map<string, { name: string; times: number }>();
  for (const o of oligos) {
    const key = o.name.trim().toLowerCase();
    const seen = used.get(key);
    if (seen === undefined) used.set(key, { name: o.name, times: 1 });
    else seen.times++;
  }
  for (const { name, times } of used.values()) {
    if (times > 1)
      problems.push(`The name ${name} is used ${times} times; a vendor rejects repeated names.`);
  }
  for (const l of lines) {
    if (l.name.trim() === '') problems.push('An oligo has no name.');
    if (l.sequence === '') problems.push(`${l.name} has no sequence.`);
    else if (/[^A-Z]/.test(l.sequence))
      problems.push(`${l.name} has characters that are not bases.`);
  }
  const rows = lines.map((l) =>
    [l.plate, l.well, l.name, l.sequence, l.length, l.scale, l.purification, l.notes]
      .map((v) => csvCell(String(v)))
      .join(','),
  );
  return { lines, csv: `${[ORDER_HEADER, ...rows].join('\r\n')}\r\n`, problems };
}
