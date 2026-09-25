/**
 * A document in a link.
 *
 * The GenBank text of a document, deflated and base64url-encoded, to ride in
 * a URL fragment. Everything after `#` stays in the browser — it is not sent
 * in the request and not in `Referer` — so a share link carries a sequence
 * to whoever opens it without it touching any server. That is what lets
 * sharing exist in an app with no backend at all.
 *
 * GenBank rather than a format of our own: the writer and parser are already
 * tested against real files, and the ends comment rides along, so a linear
 * molecule keeps its overhangs. It also means a link that will not decode
 * can still be read by a human who base64-decodes it by hand.
 */

const PREFIX = '1';

/** The fragment key a link's payload sits under: `#d=…`. */
export const SHARE_KEY = 'd';

/**
 * Longest payload a link may carry, in characters.
 *
 * No browser minds a fragment of this size — nothing is sent to a server, so
 * the usual 8 kB request-line limit does not apply — but a link has to
 * survive being pasted into mail and chat, and past a certain length that
 * stops being true. The fixtures put an ordinary annotated plasmid well
 * under it: pBR322 encodes to about 10,800 characters and the 5.4 kb
 * NC_001422 to 11,300, so the limit leaves room for a record with several
 * times their annotation before it refuses.
 */
export const MAX_SHARE_PAYLOAD = 32_000;

/** Sequence text that a decoded payload may expand to, as a guard against a bomb. */
const MAX_DECODED_CHARS = 8_000_000;

/** A link that cannot be made, or cannot be read. */
export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareLinkError';
  }
}

/** The document is too big to put in a link; it has to go as a file. */
export class ShareTooLargeError extends ShareLinkError {
  readonly chars: number;

  /**
   * `withoutReferences` when it is too long even with its references and
   * comments left out (#39); the message then says so and points to a
   * link of a selection.
   */
  constructor(chars: number, withoutReferences = false) {
    super(
      `This document makes a link of ${chars.toLocaleString()} characters` +
        (withoutReferences ? ' even without its references and comments' : '') +
        `, past the ${MAX_SHARE_PAYLOAD.toLocaleString()} a link can carry without being ` +
        'mangled in mail and chat. ' +
        (withoutReferences
          ? 'Copy a link to a selection of it, or download the GenBank file and send that instead.'
          : 'Download the GenBank file and send that instead.'),
    );
    this.name = 'ShareTooLargeError';
    this.chars = chars;
  }
}

/**
 * Feeds one buffer through a compression stream and collects the result.
 * The write is not awaited before reading starts, or a buffer larger than
 * the stream's queue would sit there waiting for a reader that never comes.
 */
async function through(
  transform: TransformStream<BufferSource, Uint8Array>,
  input: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // A damaged payload fails on both sides of the stream. The reader's error
  // is the one worth reporting, so the writer's is swallowed here rather
  // than left to surface later as an unhandled rejection.
  const written = writer
    .write(input)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  await written;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function deflate(text: string): Promise<Uint8Array> {
  return await through(new CompressionStream('deflate-raw'), new TextEncoder().encode(text));
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return new TextDecoder().decode(await through(new DecompressionStream('deflate-raw'), bytes));
}

/** Bytes to base64url, in chunks because `String.fromCharCode` takes only so many arguments. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encodes a document's file text as a link payload, or throws
 * `ShareTooLargeError` when the result is longer than a link can carry.
 */
export async function encodeSharePayload(text: string): Promise<string> {
  const payload = PREFIX + toBase64Url(await deflate(text));
  if (payload.length > MAX_SHARE_PAYLOAD) throw new ShareTooLargeError(payload.length);
  return payload;
}

/** Reads a payload back, throwing `ShareLinkError` if it is not one of ours. */
export async function decodeSharePayload(payload: string): Promise<string> {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(PREFIX)) {
    throw new ShareLinkError(
      'This link was not made by PlasmidPop, or comes from a later version.',
    );
  }
  let text: string;
  try {
    text = await inflate(fromBase64Url(trimmed.slice(PREFIX.length)));
  } catch {
    throw new ShareLinkError('This share link is damaged — it may have been cut short in transit.');
  }
  if (text.length > MAX_DECODED_CHARS) {
    throw new ShareLinkError('This share link unpacks to more sequence than the app will open.');
  }
  return text;
}
