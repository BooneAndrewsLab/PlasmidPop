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

/**
 * Copies plain text (a translation, say) from a button.
 *
 * `navigator.clipboard` exists only in a secure context, so a page served
 * over plain http falls back to selecting the text in an off-screen
 * textarea and the old `execCommand('copy')`, which still works there.
 */
export function copyText(text: string): void {
  const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
  if (clipboard === undefined) {
    copyBySelection(text);
    return;
  }
  clipboard.writeText(text).catch(() => {
    copyBySelection(text);
  });
}

function copyBySelection(text: string): void {
  // execCommand is deprecated and typed as such, but it is the only copy
  // there is outside a secure context, and older browsers may lack it.
  const doc = document as { execCommand?: (command: string) => boolean };
  if (typeof doc.execCommand !== 'function') return;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.append(area);
  const selection = document.getSelection();
  const previous = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  area.select();
  try {
    doc.execCommand('copy');
  } finally {
    area.remove();
    if (selection !== null && previous !== null) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
  }
}
