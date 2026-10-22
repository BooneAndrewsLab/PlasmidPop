import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha1Base64, sha1Base64Url, sha1Base64UrlAsync, sha1Hex } from './sha1';

function nodeSha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/**
 * The vectors are FIPS 180-1's own, which is the point of writing the hash
 * rather than calling `crypto.subtle`: an implementation nobody has checked
 * against the standard is worse than no implementation at all.
 */
describe('sha1', () => {
  it('hashes the FIPS 180-1 test vectors', () => {
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
    expect(sha1Hex('a'.repeat(1_000_000))).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  });

  it('hashes the 896-bit message of FIPS 180-2 and the NIST examples', () => {
    expect(
      sha1Hex(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      ),
    ).toBe('a49b2446a02c645bf419f995b67091253a04a259');
    expect(sha1Hex('The quick brown fox jumps over the lazy dog')).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    );
  });

  it('hashes the empty string', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('hashes either side of a block boundary', () => {
    // 55 bytes is the longest message whose padding fits in its own block,
    // 56 the shortest that needs another one.
    expect(sha1Hex('a'.repeat(55))).toBe('c1c8bbdc22796e28c0e15163d20899b65621d65a');
    expect(sha1Hex('a'.repeat(56))).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699');
    expect(sha1Hex('a'.repeat(64))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d');
  });

  it('pads every message length around one and two blocks as node:crypto does', () => {
    // 55/56 bytes: the length still fits in the last block or needs another;
    // 63/64/65: a whole block or one byte either side of it; and the same a
    // block on, where the tail starts at an offset.
    const lengths = [
      1, 54, 55, 56, 57, 62, 63, 64, 65, 118, 119, 120, 121, 127, 128, 129, 191, 192,
    ];
    for (const n of lengths) {
      const text = 'ACGT'.repeat(50).slice(0, n);
      expect(sha1Hex(text), `${n} bytes`).toBe(nodeSha1(text));
    }
  });

  it('pads by the length of the UTF-8, not of the string', () => {
    // 28 two-byte characters are 56 bytes: the padding needs a second block
    // although the string is only 28 long; 18 of three bytes plus one are 55.
    expect(sha1Hex('é'.repeat(28))).toBe(nodeSha1('é'.repeat(28)));
    expect(sha1Hex(`a${'€'.repeat(18)}`)).toBe(nodeSha1(`a${'€'.repeat(18)}`));
    expect(sha1Hex('😀'.repeat(16))).toBe(nodeSha1('😀'.repeat(16)));
  });

  it('keeps a surrogate pair whole across the chunks it encodes the text in (#273)', () => {
    // `sha1.ts` encodes 16,384 characters at a time; a pair split between
    // two chunks would be hashed as two replacement characters.
    for (const boundary of [16_384, 32_768]) {
      for (let at = boundary - 3; at <= boundary + 2; at++) {
        const text = `${'A'.repeat(at)}😀${'C'.repeat(40)}`;
        expect(sha1Hex(text), `pair at ${at}`).toBe(nodeSha1(text));
      }
    }
    // A lone half is one replacement character, as TextEncoder writes it.
    const lone = `${'A'.repeat(16_383)}\ud83dC`;
    expect(sha1Hex(lone)).toBe(nodeSha1(lone));
    expect(sha1Hex(`${'A'.repeat(16_383)}\ud83d`)).toBe(nodeSha1(`${'A'.repeat(16_383)}\ud83d`));
  });

  it('encodes the message as UTF-8, not as code units', () => {
    expect(sha1Hex('é')).toBe('bf15be717ac1b080b4f1c456692825891ff5073d');
  });

  it('writes base64 without its padding character', () => {
    // SEGUID v1 is standard base64, v2 base64url; both drop the "=".
    expect(sha1Base64('ACGT')).toBe('IQiZThf2zKn/I1KtqStlEdsHYDQ');
    expect(sha1Base64Url('ACGT')).toBe('IQiZThf2zKn_I1KtqStlEdsHYDQ');
    expect(sha1Base64Url('ACGT')).toHaveLength(27);
  });
});

describe('sha1Base64UrlAsync (#276)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives sha1Base64Url's value by crypto.subtle", async () => {
    // The test environment has one, so this is not the fallback.
    expect(globalThis.crypto.subtle).toBeDefined();
    for (const text of ['', 'ACGT', 'a'.repeat(56), 'é'])
      expect(await sha1Base64UrlAsync(text)).toBe(sha1Base64Url(text));
  });

  it("asks crypto.subtle for SHA-1 of the text's UTF-8 and encodes what it answers", async () => {
    const digest = vi.fn((_algorithm: string, _data: Uint8Array) =>
      Promise.resolve(new Uint8Array(20).fill(0xff).buffer),
    );
    vi.stubGlobal('crypto', { subtle: { digest } });
    // Twenty 0xff bytes: 26 of base64url's last character, then 111100 (60).
    expect(await sha1Base64UrlAsync('é')).toBe(`${'_'.repeat(26)}8`);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(digest.mock.calls[0]?.[0]).toBe('SHA-1');
    expect([...(digest.mock.calls[0]?.[1] ?? [])]).toEqual([0xc3, 0xa9]);
  });

  it('falls back to its own digest when crypto.subtle fails', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: () => Promise.reject(new Error('no')) } });
    expect(await sha1Base64UrlAsync('ACGT')).toBe('IQiZThf2zKn_I1KtqStlEdsHYDQ');
  });

  it('falls back to its own digest without crypto.subtle, or without crypto', async () => {
    vi.stubGlobal('crypto', {});
    expect(await sha1Base64UrlAsync('ACGT')).toBe('IQiZThf2zKn_I1KtqStlEdsHYDQ');
    vi.stubGlobal('crypto', undefined);
    expect(await sha1Base64UrlAsync('ACGT')).toBe('IQiZThf2zKn_I1KtqStlEdsHYDQ');
  });
});
