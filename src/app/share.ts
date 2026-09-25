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

import { type Range, type SeqDocument, extractRange } from '@/core';
import { SHARE_KEY, ShareTooLargeError, decodeSharePayload, encodeSharePayload } from '@/io';

import { analytics } from './analytics';
import { copyText } from './clipboard';
import { openText } from './openFile';
import { serialize } from './saveFile';
import { type ShareNoticeInfo, editorStore } from './state/editorStore';

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
 * `doc` without the header material that describes where a record was
 * published rather than the construct (#39): its REFERENCE blocks and the
 * COMMENT blocks it was read with. In a GenBank record from NCBI they are
 * most of the header and a large part of a link. Everything else stays:
 * the bases, features, topology, sticky ends, host, where it was derived
 * from and what it was made from, which are fields of their own and are
 * written as comments of ours whatever `comments` holds.
 */
export function withoutReferences(doc: SeqDocument): SeqDocument {
  const { references, comments } = doc.metadata;
  if (references.length === 0 && comments.length === 0) return doc;
  return doc.setMetadata({ references: [], comments: [] });
}

/** Whether `withoutReferences` would leave anything out of `doc`. */
export function hasReferences(doc: SeqDocument): boolean {
  return doc.metadata.references.length > 0 || doc.metadata.comments.length > 0;
}

/** A link that was made, and what went into it. */
export interface ShareLink {
  readonly url: string;
  /**
   * The length the link would have had with its references and comments,
   * when it was too long with them and they were left out; else null.
   */
  readonly fullChars: number | null;
}

/**
 * A link to `doc`, whole when it fits, and without its references and
 * comments when only that makes it fit (#39). Throws `ShareTooLargeError`
 * when even that is too long, saying so.
 */
export async function shareLinkFor(doc: SeqDocument, base: string = appUrl()): Promise<ShareLink> {
  try {
    return { url: await shareUrlFor(doc, base), fullChars: null };
  } catch (e) {
    if (!(e instanceof ShareTooLargeError) || !hasReferences(doc)) throw e;
    try {
      const url = await shareUrlFor(withoutReferences(doc), base);
      // The error counts the payload; the notice counts the whole link.
      return { url, fullChars: e.chars + `${base}#${SHARE_KEY}=`.length };
    } catch (again) {
      if (!(again instanceof ShareTooLargeError)) throw again;
      throw new ShareTooLargeError(again.chars, true);
    }
  }
}

/** The part of `doc` in `selection`, as Export selection as GenBank writes it. */
export function selectionForShare(doc: SeqDocument, selection: Range): SeqDocument {
  return extractRange(doc, selection);
}

/**
 * Puts a link to `doc`, or to the part of it in `selection`, on the
 * clipboard and says what was copied, or reports why it could not be made.
 */
export async function copyShareLink(
  doc: SeqDocument,
  selection: Range | null = null,
): Promise<void> {
  const shared = selection === null ? doc : selectionForShare(doc, selection);
  let link: ShareLink;
  try {
    link = await shareLinkFor(shared);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return;
  }
  copyText(link.url);
  analytics.track('share', 'copy', selection === null ? 'document' : 'selection');
  if (link.fullChars !== null) analytics.track('share', 'without-references');
  editorStore.noteShareCopied({
    chars: link.url.length,
    of: selection === null ? 'document' : 'selection',
    fullChars: link.fullChars,
  });
}

/**
 * Past this many characters a link does not survive every chat app (#41,
 * tested 2026-09-25): Slack refused to send a 10k-character link, and Teams
 * sent it but covered the screen with its tooltip when the pointer passed
 * over it. 2,000 is the length links are generally safe to, until an app is
 * measured more closely.
 */
export const LONG_LINK_CHARS = 2_000;

/** What the notice adds for a link some chat apps will not carry; null for a short one. */
export function longLinkWarning({ chars, of }: ShareNoticeInfo): string | null {
  if (chars <= LONG_LINK_CHARS) return null;
  const smaller =
    of === 'selection'
      ? 'a smaller selection'
      : 'File ▸ Copy link to selection for just the part they need';
  return (
    `A link this long may not get through chat apps: Slack refuses to send one, and Teams ` +
    `makes it hard to click. For those, download the file and attach it, or use ${smaller}.`
  );
}

/** What the notice says: which link, how long, and what it left out (#39). */
export function shareNoticeText({ chars, of, fullChars }: ShareNoticeInfo): string {
  const what = of === 'selection' ? 'Link to the selection' : 'Share link';
  const length = `${chars.toLocaleString()} characters`;
  const head =
    fullChars === null
      ? `${what} copied — ${length}.`
      : `Too long with its references and comments (${fullChars.toLocaleString()} characters); ` +
        `${what.charAt(0).toLowerCase()}${what.slice(1)} copied without them — ${length}.`;
  const carried = of === 'selection' ? 'The selection, with its features,' : 'The document';
  return `${head} ${carried} travels inside the link itself, so nothing was uploaded and anyone you send it to can open it.`;
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
