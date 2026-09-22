/**
 * SHA-1, synchronously.
 *
 * SEGUID is defined as a SHA-1 digest (`seguid.ts`), and the browser already
 * has one in `crypto.subtle.digest`. It is not used here, for two reasons
 * that both come down to the shape of the call rather than the arithmetic:
 *
 * - `SubtleCrypto` is asynchronous, and a checksum is wanted in places that
 *   are not: `writeGenBank` builds a file as a string, a renderer draws a
 *   frame, the status bar reads the front document. A promise at the bottom
 *   of that would have to be awaited at the top of all of it.
 * - `crypto.subtle` is undefined outside a secure context, so the app served
 *   over plain HTTP on a lab machine's LAN address would have no checksums
 *   at all — and "it works when you open the file locally" is exactly the
 *   promise the rest of the app makes.
 *
 * A digest of a plasmid is a few microseconds' work either way. This is the
 * textbook algorithm (FIPS 180-1) and it is pinned by that document's own
 * test vectors in `sha1.test.ts`, which is the only thing that makes writing
 * one's own hash defensible.
 */

const BLOCK_BYTES = 64;

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** SHA-1 of `bytes`, as five 32-bit words. */
function digestWords(bytes: Uint8Array): Int32Array {
  // Padding: a 1 bit, zeroes, then the length in bits as a 64-bit big-endian
  // integer. `length * 8` is exact well past any sequence a browser can hold.
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / BLOCK_BYTES) * BLOCK_BYTES);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);
  for (let block = 0; block < padded.length; block += BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return Int32Array.of(h0, h1, h2, h3, h4);
}

/** The 20 bytes of the SHA-1 digest of `text`, encoded as UTF-8. */
export function sha1Bytes(text: string): Uint8Array {
  const words = digestWords(new TextEncoder().encode(text));
  const out = new Uint8Array(20);
  const view = new DataView(out.buffer);
  for (let i = 0; i < words.length; i++) view.setInt32(i * 4, words[i] ?? 0);
  return out;
}

export function sha1Hex(text: string): string {
  let out = '';
  for (const byte of sha1Bytes(text)) out += byte.toString(16).padStart(2, '0');
  return out;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 of 20 bytes, without the one padding character it would end in.
 * `urlSafe` swaps `+/` for `-_`, which is what SEGUID v2 uses (v1 does not).
 */
function base64(bytes: Uint8Array, urlSafe: boolean): string {
  const alphabet = urlSafe ? BASE64.slice(0, 62) + '-_' : BASE64;
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const chunk = (a << 16) | (b << 8) | c;
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let j = 0; j < chars; j++) out += alphabet[(chunk >>> (18 - j * 6)) & 0x3f] ?? '';
  }
  return out;
}

/** SHA-1 of `text` as unpadded base64url: the 27 characters of a SEGUID v2. */
export function sha1Base64Url(text: string): string {
  return base64(sha1Bytes(text), true);
}

/** SHA-1 of `text` as unpadded standard base64: the 27 characters of a SEGUID v1. */
export function sha1Base64(text: string): string {
  return base64(sha1Bytes(text), false);
}
