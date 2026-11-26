import { type InexactFeature, type ParseWarning } from '@/io/types';

/** How many features the save notice names before it says "and N more". */
const NAMED = 5;

/**
 * The features a GenBank save cannot write as they were read (#464), taken
 * from the warnings the document was opened with. Empty for a document that
 * was not read from such a file, so its save says nothing.
 */
export function inexactFeatures(warnings: readonly ParseWarning[]): readonly InexactFeature[] {
  const out: InexactFeature[] = [];
  for (const w of warnings) if (w.inexact !== undefined) out.push(w.inexact);
  return out;
}

function label(f: InexactFeature): string {
  const what = f.name === '' ? f.featureType : `${f.featureType} ${f.name}`;
  return f.kind === 'mixed-strand'
    ? `${what} (trans-spliced, written on the forward strand)`
    : `${what} (not read, so not written)`;
}

/**
 * The sentence for the notice after a save, or null when nothing was lost.
 * Names up to five features, then how many more.
 */
export function inexactSaveMessage(items: readonly InexactFeature[]): string | null {
  const total = items.reduce((n, f) => n + f.count, 0);
  if (total === 0) return null;
  const named = items.filter((f) => f.featureType !== '').slice(0, NAMED);
  const more = total - named.length;
  const list = named.map(label).join('; ');
  return (
    `Saved. ${total.toLocaleString()} feature${total === 1 ? '' : 's'} can’t be written exactly as read` +
    (list === '' ? '' : `: ${list}`) +
    (more > 0 && list !== '' ? `; and ${more.toLocaleString()} more` : '') +
    '.'
  );
}
