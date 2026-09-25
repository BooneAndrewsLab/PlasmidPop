import { type SeqFragment, fragmentToJSON, parseFragmentJSON } from '@/core';

/**
 * Clipboard type carrying a fragment with its features. Browsers keep custom
 * types like this one for copy/paste within the same browser; other
 * applications only see the plain-text bases written alongside it.
 */
export const FRAGMENT_MIME = 'application/x-plasmidpop-fragment+json';

/**
 * The attribute the fragment also rides in, on the `text/html` copy. Some
 * browsers drop custom types on the way to another browser tab (#3), but
 * every browser keeps `text/html`, and every application that reads it sees
 * a `<pre>` of the bases, which is what it would paste anyway.
 */
const HTML_ATTRIBUTE = 'data-plasmidpop-fragment';

/**
 * The fragment most recently copied in this tab. Some browsers drop custom
 * clipboard types, so a paste whose text matches this fragment's bases is
 * taken to be that fragment, features included.
 */
let lastCopied: SeqFragment | null = null;

export function writeFragment(data: DataTransfer, fragment: SeqFragment): void {
  data.setData('text/plain', fragment.sequence);
  const json = fragmentToJSON(fragment);
  data.setData(FRAGMENT_MIME, json);
  data.setData('text/html', fragmentHtml(fragment.sequence, json));
  lastCopied = fragment;
}

function fragmentHtml(sequence: string, json: string): string {
  const pre = document.createElement('pre');
  pre.setAttribute(HTML_ATTRIBUTE, json);
  pre.textContent = sequence;
  return pre.outerHTML;
}

/**
 * The fragment carried in pasted HTML, if it is ours and still matches the
 * plain text beside it. The HTML may come from anywhere, so it is parsed
 * inert and only the one attribute is read; `parseFragmentJSON` then checks
 * the contents as it does for the typed copy.
 */
function fragmentFromHtml(html: string, text: string): SeqFragment | null {
  if (!html.includes(HTML_ATTRIBUTE)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const json = doc.querySelector(`[${HTML_ATTRIBUTE}]`)?.getAttribute(HTML_ATTRIBUTE);
  if (json === null || json === undefined) return null;
  const fragment = parseFragmentJSON(json);
  // An application that rewrote the text but kept the markup has changed
  // what was copied; the text is what the user can see, so it wins.
  if (fragment === null || (text !== '' && text.trim() !== fragment.sequence)) return null;
  return fragment;
}

/**
 * What a paste event carries: a fragment when the clipboard holds one we
 * wrote — typed, or in the HTML copy, or failing both, bases matching the
 * last copy made in this tab — otherwise the plain text.
 */
export function readClipboard(data: DataTransfer): SeqFragment | string {
  const json = data.getData(FRAGMENT_MIME);
  if (json !== '') {
    const fragment = parseFragmentJSON(json);
    if (fragment !== null) return fragment;
  }
  const text = data.getData('text/plain');
  const fromHtml = fragmentFromHtml(data.getData('text/html'), text);
  if (fromHtml !== null) return fromHtml;
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

/**
 * Copies a fragment from a button, where there is no copy event to write
 * into: the phone's long-press Copy (#43). The bases go out as plain text,
 * which is what another app would paste; the async clipboard takes no
 * custom types, so the features ride on the last-copied memory instead and
 * a paste back into this tab still brings them.
 */
export function copyFragment(fragment: SeqFragment): void {
  copyText(fragment.sequence);
  lastCopied = fragment;
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
