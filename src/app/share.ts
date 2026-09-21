/**
 * Sharing a document as a link.
 *
 * The whole document rides in the URL fragment (`…/#d=<payload>`). Nothing
 * is uploaded: everything after `#` is never sent in the HTTP request and is
 * left out of `Referer`, so a link reaches the person it is sent to without
 * the sequence reaching Pages, us, or anyone's log. It is the same promise
 * as the rest of the app — no round-trip, nothing of the science leaves the
 * browser — rather than an exception to it.
 *
 * The price is that a link is a snapshot with no way back: it cannot be
 * updated or withdrawn, and whoever holds it can open the document. The
 * banner after a copy says so.
 */

import { type SeqDocument } from '@/core';
import { SHARE_KEY, decodeSharePayload, encodeSharePayload } from '@/io';

import { analytics } from './analytics';
import { copyText } from './clipboard';
import { openText } from './openFile';
import { serialize } from './saveFile';
import { editorStore } from './state/editorStore';

/** Where a link should point: this app, without whatever fragment is on it now. */
function appUrl(): string {
  const { origin, pathname } = globalThis.location;
  return `${origin}${pathname}`;
}

/** The payload in a fragment, or null when there is none. Takes `#d=…` or `d=…`. */
export function sharePayloadIn(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const payload = params.get(SHARE_KEY);
  return payload === null || payload === '' ? null : payload;
}

/** A link carrying `doc`, as GenBank. Throws `ShareTooLargeError` past the limit. */
export async function shareUrlFor(doc: SeqDocument, base: string = appUrl()): Promise<string> {
  const payload = await encodeSharePayload(serialize(doc, 'genbank'));
  return `${base}#${SHARE_KEY}=${payload}`;
}

/**
 * Puts a link to `doc` on the clipboard and says what was copied, or reports
 * why it could not be made.
 */
export async function copyShareLink(doc: SeqDocument): Promise<void> {
  let url: string;
  try {
    url = await shareUrlFor(doc);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return;
  }
  copyText(url);
  analytics.track('share', 'copy');
  editorStore.noteShareCopied(url.length);
}

/**
 * Reads the payload out of the address bar and takes it off, so the sequence
 * is not left in the URL, in the browser's history, or in anything that
 * later reads `location.href`. Returns null when the page was not opened
 * from a share link.
 */
export function takeShareFragment(): string | null {
  const { location, history } = globalThis;
  const payload = sharePayloadIn(location.hash);
  if (payload === null) return null;
  try {
    history.replaceState(history.state, '', appUrl());
  } catch {
    // Not fatal: the document still opens, the fragment just stays put.
  }
  return payload;
}

/**
 * Opens the document a share payload carries, in a tab of its own. It gets
 * no file name and no origin: there is no file on this computer it came
 * from, so it is the reader's own document from the first keystroke, and
 * "dirty" means what it means everywhere else — not downloaded yet.
 */
export async function openSharedPayload(payload: string): Promise<string | null> {
  let text: string;
  try {
    text = await decodeSharePayload(payload);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return null;
  }
  analytics.track('share', 'open');
  return openText(text, null);
}
