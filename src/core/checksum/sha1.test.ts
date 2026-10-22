import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha1Base64, sha1Base64Url, sha1Base64UrlAsync, sha1Hex } from './sha1';

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
