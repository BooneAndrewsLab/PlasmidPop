import { createHash } from 'node:crypto';

import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha1Base64, sha1Base64Url, sha1Base64UrlAsync, sha1Bytes, sha1Hex } from './sha1';

/**
 * `sha1.ts` against Node's OpenSSL SHA-1 on random messages (#273). The
 * known-answer tests in `sha1.test.ts` pin the standard's vectors; these
 * cover what a faster loop is most likely to get wrong: a length whose
 * padding lands somewhere new, a tail at an odd offset, a character whose
 * UTF-8 is longer than one byte, and the chunks the text is encoded in.
 */
function nodeSha1(data: string | Uint8Array): Buffer {
  return createHash('sha1').update(data).digest();
}

/** DNA text of any length up to a few chunks, with now and then a character that is not ASCII. */
const longText = fc
  .tuple(
    fc.string({ unit: fc.constantFrom('A', 'C', 'G', 'T'), maxLength: 50_000 }),
    fc.array(fc.tuple(fc.nat(), fc.constantFrom('é', '€', '😀', '\ud83d', '\ude00', ';', '-')), {
      maxLength: 6,
    }),
  )
  .map(([dna, inserts]) => {
    let text = dna;
    for (const [at, ch] of inserts) {
      const i = text.length === 0 ? 0 : at % text.length;
      text = text.slice(0, i) + ch + text.slice(i);
    }
    return text;
  });

describe('sha1 against node:crypto', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('agrees on any short string, ASCII or not', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (text) => {
        const want = nodeSha1(text);
        expect(Buffer.from(sha1Bytes(text)).equals(want)).toBe(true);
        expect(sha1Hex(text)).toBe(want.toString('hex'));
        expect(sha1Base64(text)).toBe(want.toString('base64').replace(/=$/, ''));
        expect(sha1Base64Url(text)).toBe(want.toString('base64url'));
      }),
      { numRuns: 500 },
    );
  });

  it('agrees on long text, across the chunks it is encoded in', () => {
    fc.assert(
      fc.property(longText, (text) => {
        expect(sha1Hex(text)).toBe(nodeSha1(text).toString('hex'));
      }),
      { numRuns: 60 },
    );
  });

  it('agrees through its own digest of the bytes, the async fallback', async () => {
    // Without crypto.subtle, `sha1Base64UrlAsync` hashes the encoded bytes
    // rather than the text: the other way into the compression function.
    vi.stubGlobal('crypto', {});
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.string({ unit: 'binary', maxLength: 300 }), longText),
        async (text) => {
          expect(await sha1Base64UrlAsync(text)).toBe(nodeSha1(text).toString('base64url'));
        },
      ),
      { numRuns: 100 },
    );
  });
});
