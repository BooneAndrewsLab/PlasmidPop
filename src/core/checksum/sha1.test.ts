import { describe, expect, it } from 'vitest';

import { sha1Base64, sha1Base64Url, sha1Hex } from './sha1';

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
