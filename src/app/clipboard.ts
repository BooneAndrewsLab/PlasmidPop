import { type SeqFragment, fragmentToJSON, parseFragmentJSON } from '@/core';

/**
 * Clipboard type carrying a fragment with its features. Browsers keep custom
 * types like this one for copy/paste within the same browser; other
 * applications only see the plain-text bases written alongside it.
 */
export const FRAGMENT_MIME = 'application/x-plasmidpop-fragment+json';

/**
 * The fragment most recently copied in this tab. Some browsers drop custom
 * clipboard types, so a paste whose text matches this fragment's bases is
 * taken to be that fragment, features included.
 */
let lastCopied: SeqFragment | null = null;

export function writeFragment(data: DataTransfer, fragment: SeqFragment): void {
  data.setData('text/plain', fragment.sequence);
  data.setData(FRAGMENT_MIME, fragmentToJSON(fragment));
  lastCopied = fragment;
}

/**
 * What a paste event carries: a fragment when the clipboard holds one we
 * wrote (or its bases match the last copy), otherwise the plain text.
 */
export function readClipboard(data: DataTransfer): SeqFragment | string {
  const json = data.getData(FRAGMENT_MIME);
  if (json !== '') {
    const fragment = parseFragmentJSON(json);
    if (fragment !== null) return fragment;
  }
  const text = data.getData('text/plain');
  if (lastCopied !== null && text.trim() === lastCopied.sequence) return lastCopied;
  return text;
}

/** For tests. */
export function resetClipboardMemory(): void {
  lastCopied = null;
}
