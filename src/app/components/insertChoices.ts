import { type Range, type SeqDocument, featureExtent, formatSpan, isEmptyRange } from '@/core';

export interface InsertChoice {
  /** `''` for the tab's selection, `'whole'`, or a feature's id; see `BenchSettings.overlap`. */
  readonly value: string;
  readonly label: string;
  readonly range: Range;
}

function describeSpan(range: Range, seqLength: number): string {
  return `${formatSpan(range, seqLength)}, ${(range.end - range.start).toLocaleString()} bp`;
}

/** What of a template can be the insert: its tab's selection first, then its features, then all of it. */
export function insertChoices(
  template: { readonly doc: SeqDocument; readonly selection: Range | null } | undefined,
): InsertChoice[] {
  if (template === undefined) return [];
  const { doc, selection } = template;
  const out: InsertChoice[] = [];
  if (selection !== null && !isEmptyRange(selection)) {
    out.push({
      value: '',
      label: `The selection (${describeSpan(selection, doc.length)})`,
      range: selection,
    });
  }
  for (const f of doc.features) {
    // The whole record is not an insert anyone picks by name.
    if (f.type === 'source') continue;
    const range = featureExtent(f);
    if (range === null || isEmptyRange(range)) continue;
    const name = f.name === '' ? f.type : `${f.name} (${f.type})`;
    out.push({ value: f.id, label: `${name}, ${describeSpan(range, doc.length)}`, range });
  }
  if (!doc.isCircular && doc.length > 0) {
    const all = { start: 0, end: doc.length };
    out.push({ value: 'whole', label: `All of it (${describeSpan(all, doc.length)})`, range: all });
  }
  return out;
}
