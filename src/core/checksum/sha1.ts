/**
 * SHA-1, synchronously, and `sha1Base64UrlAsync` for the analysis worker.
 *
 * SEGUID is defined as a SHA-1 digest (`seguid.ts`), and the browser already
 * has one in `crypto.subtle.digest`. The synchronous one here is what most
 * callers use, for two reasons that both come down to the shape of the call
 * rather than the arithmetic:
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
 * one's own hash defensible. It runs at about 150 MB/s once V8 has compiled
 * it (#273, design note 102); the worker's checksum of a genome, already
 * asynchronous, takes `crypto.subtle` where there is one (#276), with this as
 * the fallback.
 */

const BLOCK_BYTES = 64;

const K1 = 0x5a827999;
const K2 = 0x6ed9eba1;
const K3 = 0x8f1bbcdc;
const K4 = 0xca62c1d6;

// Rotations of a 32-bit word, as int32. V8 inlines these.
const rotl1 = (x: number): number => (x << 1) | (x >>> 31);
const rotl5 = (x: number): number => (x << 5) | (x >>> 27);
const rotl30 = (x: number): number => (x << 30) | (x >>> 2);

/**
 * The message schedule, one for the module: `blocks` fills and reads it
 * within one block and nothing else touches it, so no block allocates.
 */
const W = new Int32Array(80);

/**
 * The compression function over the 64-byte blocks of `bytes` from `from`
 * to `to` (a multiple of 64 past it), updating the state `h` in place. Its
 * shape is for V8 (#273, design note 102, measured in `docs/perf-notes.md`):
 *
 * - Every value stays an int32: `| 0` after each sum, `>>>` only inside a
 *   rotation, and a word read as one by `getInt32` (some 10% faster than
 *   four byte reads and shifts).
 * - The state is written back to `h` inside the loop, not after it. V8
 *   compiles this loop while it runs (on-stack replacement), before the code
 *   after it has run once; with the write-back there, the optimized code
 *   bailed out at the end of nearly every call for want of type feedback,
 *   and the speed of the old loop depended on how it had been called.
 * - The rounds stay one loop that picks its function by the round number.
 *   Four loops of 20 were 7% faster once compiled, and the 80 rounds written
 *   out 40%, but V8 took longer to compile each (some 40 ms for the written
 *   out ones), and a plasmid's digest is usually the first call: it was
 *   slower than before, not faster.
 */
function blocks(h: Int32Array, bytes: Uint8Array, from: number, to: number): void {
  const w = W;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let h0 = h[0] ?? 0;
  let h1 = h[1] ?? 0;
  let h2 = h[2] ?? 0;
  let h3 = h[3] ?? 0;
  let h4 = h[4] ?? 0;
  for (let p = from; p < to; p += BLOCK_BYTES) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(p + 4 * i);
    for (let i = 16; i < 80; i++) {
      w[i] = rotl1((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0));
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      if (i < 20) f = ((d ^ (b & (c ^ d))) + K1) | 0;
      else if (i < 40) f = ((b ^ c ^ d) + K2) | 0;
      else if (i < 60) f = (((b & c) | (d & (b | c))) + K3) | 0;
      else f = ((b ^ c ^ d) + K4) | 0;
      const t = (rotl5(a) + f + e + (w[i] ?? 0)) | 0;
      e = d;
      d = c;
      c = rotl30(b);
      b = a;
      a = t;
    }
    h[0] = h0 = (h0 + a) | 0;
    h[1] = h1 = (h1 + b) | 0;
    h[2] = h2 = (h2 + c) | 0;
    h[3] = h3 = (h3 + d) | 0;
    h[4] = h4 = (h4 + e) | 0;
  }
}

/** SHA-1's initial state. */
function initial(): Int32Array {
  return Int32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0);
}

/** The last partial block of a message and its padding: one block or two. */
const TAIL = new Uint8Array(2 * BLOCK_BYTES);

/**
 * Pads and hashes the last `rest` (< 64) bytes of a message of `length`
 * bytes, `bytes` from `from`: a 1 bit, zeroes, then the length in bits as a
 * 64-bit big-endian integer. `length * 8` is exact well past any sequence a
 * browser can hold.
 */
function finish(
  h: Int32Array,
  bytes: Uint8Array,
  from: number,
  rest: number,
  length: number,
): void {
  const tail = TAIL;
  tail.fill(0);
  tail.set(bytes.subarray(from, from + rest));
  tail[rest] = 0x80;
  const tailLength = rest + 9 > BLOCK_BYTES ? 2 * BLOCK_BYTES : BLOCK_BYTES;
  const bits = length * 8;
  // Stryker disable next-line ArithmeticOperator: under 512 MB the high word is 0, and bits * 2^32 is a multiple of 2^32, which is also written as 0
  const high = Math.floor(bits / 0x100000000);
  const low = bits >>> 0;
  for (let i = 0; i < 4; i++) {
    tail[tailLength - 8 + i] = (high >>> (24 - 8 * i)) & 0xff;
    tail[tailLength - 4 + i] = (low >>> (24 - 8 * i)) & 0xff;
  }
  blocks(h, tail, 0, tailLength);
}

/** SHA-1 of `bytes`, as five 32-bit words. */
function digestBytes(bytes: Uint8Array): Int32Array {
  const h = initial();
  // The whole blocks are hashed where they lie; only the tail is copied.
  const whole = bytes.length - (bytes.length % BLOCK_BYTES);
  blocks(h, bytes, 0, whole);
  finish(h, bytes, whole, bytes.length - whole, bytes.length);
  return h;
}

/** Characters of the text encoded per step of `digestText`. */
const CHUNK_CHARS = 16384;

/**
 * Where `digestText` encodes each chunk, after the up to 63 bytes the last
 * one left over: UTF-8 takes at most three bytes per UTF-16 code unit.
 */
const CHUNK = new Uint8Array(BLOCK_BYTES + 3 * CHUNK_CHARS);

const ENCODER = new TextEncoder();

/**
 * SHA-1 of the UTF-8 of `text`, as five 32-bit words, encoded a chunk at a
 * time into one buffer kept for the module. `TextEncoder.encode` of the
 * whole text allocates a buffer as long as the message and writes all of it
 * before the first block is hashed; that was a quarter of the time once the
 * rounds were faster (#273), and encoding into a buffer that stays in cache
 * costs less than half as much. A chunk never ends between the two halves
 * of a surrogate pair, which `encodeInto` would write as two replacement
 * characters where `encode` writes the one character they make.
 */
function digestText(text: string): Int32Array {
  const h = initial();
  const buffer = CHUNK;
  let carry = 0;
  let length = 0;
  for (let pos = 0; pos < text.length;) {
    let end = Math.min(pos + CHUNK_CHARS, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    const { written } = ENCODER.encodeInto(text.slice(pos, end), buffer.subarray(carry));
    pos = end;
    length += written;
    const filled = carry + written;
    const whole = filled - (filled % BLOCK_BYTES);
    blocks(h, buffer, 0, whole);
    buffer.copyWithin(0, whole, filled);
    carry = filled - whole;
  }
  finish(h, buffer, 0, carry, length);
  return h;
}

/** The 20 bytes of the SHA-1 digest of `text`, encoded as UTF-8. */
export function sha1Bytes(text: string): Uint8Array {
  return wordsToBytes(digestText(text));
}

function sha1OfBytes(bytes: Uint8Array): Uint8Array {
  return wordsToBytes(digestBytes(bytes));
}

function wordsToBytes(words: Int32Array): Uint8Array {
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
    // Stryker disable next-line StringLiteral: the index is masked to 0-63, so the alphabet always has the character
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

/**
 * `sha1Base64Url`, by `crypto.subtle` where the context has it (#276): the
 * same 27 characters, some ten times faster over the 9 MB canonical string
 * of a genome. Outside a secure context, or if the digest fails, it is the
 * synchronous one.
 */
export async function sha1Base64UrlAsync(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle;
  if (subtle !== undefined) {
    try {
      return base64(new Uint8Array(await subtle.digest('SHA-1', bytes)), true);
    } catch {
      // Fall through to ours.
    }
  }
  return base64(sha1OfBytes(bytes), true);
}
