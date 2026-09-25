import { describe, expect, it } from 'vitest';

import {
  MAX_SHARE_PAYLOAD,
  ShareLinkError,
  ShareTooLargeError,
  checkSharePayload,
  decodeSharePayload,
  encodeSharePayload,
} from './link';

// Tests written against the survivors of a mutation run (item 50).

/**
 * Deterministic bases that deflate cannot squeeze below about two bits each.
 * xorshift32 in 32-bit integer arithmetic: an LCG done in doubles loses
 * precision past 2^53 and falls into a short cycle, which some zlib builds
 * then compress to almost nothing.
 */
function bases(length: number): string {
  let x = 0x9e3779b9 | 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out += 'ACGT'.charAt((x >>> 30) & 3);
  }
  return out;
}

describe('share link errors', () => {
  it('say what they are', () => {
    expect(new ShareLinkError('x').name).toBe('ShareLinkError');
    expect(new ShareTooLargeError(40_000).name).toBe('ShareTooLargeError');
    expect(new ShareTooLargeError(40_000)).toBeInstanceOf(ShareLinkError);
  });

  it('say how long the link would be and what to do instead', () => {
    const chars = (40_000).toLocaleString();
    const limit = MAX_SHARE_PAYLOAD.toLocaleString();
    expect(new ShareTooLargeError(40_000).message).toBe(
      `This document makes a link of ${chars} characters, past the ${limit} a link can carry ` +
        'without being mangled in mail and chat. Download the GenBank file and send that instead.',
    );
    expect(new ShareTooLargeError(40_000, true).message).toBe(
      `This document makes a link of ${chars} characters even without its references and ` +
        `comments, past the ${limit} a link can carry without being mangled in mail and chat. ` +
        'Copy a link to a selection of it, or download the GenBank file and send that instead.',
    );
    expect(new ShareTooLargeError(40_000).chars).toBe(40_000);
  });
});

describe('the payload limit', () => {
  // Tested where it is decided. What length a text deflates to depends on the
  // zlib build (CI's and a laptop's differ), so a text found to land exactly
  // on the limit on one machine misses it on another.
  it('allows a payload of exactly the limit', () => {
    const payload = '1' + 'A'.repeat(MAX_SHARE_PAYLOAD - 1);
    expect(checkSharePayload(payload)).toBe(payload);
  });

  it('refuses a payload one character past it, saying how long it is', () => {
    const payload = '1' + 'A'.repeat(MAX_SHARE_PAYLOAD);
    expect(() => checkSharePayload(payload)).toThrow(
      expect.objectContaining({ name: 'ShareTooLargeError', chars: MAX_SHARE_PAYLOAD + 1 }),
    );
  });

  it('applies it to what a text encodes to, either side of it', async () => {
    // Random bases deflate to about two bits each: 200,000 of them encode to
    // about twice the limit, 3,000 to a tenth of it, whatever the zlib build.
    const big = bases(200_000);
    await expect(encodeSharePayload(big)).rejects.toMatchObject({ name: 'ShareTooLargeError' });
    const small = bases(3_000);
    const payload = await encodeSharePayload(small);
    expect(payload.length).toBeLessThan(MAX_SHARE_PAYLOAD);
    expect(await decodeSharePayload(payload)).toBe(small);
  });
});

describe('decodeSharePayload', () => {
  it('reads a payload with white space around it, as pasted', async () => {
    const payload = await encodeSharePayload('ACGT');
    expect(await decodeSharePayload(`  ${payload}\n`)).toBe('ACGT');
  });

  it('says a payload without the version prefix is not one of ours', async () => {
    // The rest is a valid payload, so it is the prefix alone that fails it.
    const payload = await encodeSharePayload('ACGT');
    await expect(decodeSharePayload(`2${payload.slice(1)}`)).rejects.toThrow(
      new ShareLinkError('This link was not made by PlasmidPop, or comes from a later version.'),
    );
  });

  it('opens a payload that unpacks to exactly as much as the app will open', async () => {
    const text = 'A'.repeat(8_000_000);
    expect((await decodeSharePayload(await encodeSharePayload(text))).length).toBe(8_000_000);
  });

  it('refuses a payload that unpacks to more than that', async () => {
    const payload = await encodeSharePayload('A'.repeat(8_000_001));
    await expect(decodeSharePayload(payload)).rejects.toThrow(
      new ShareLinkError('This share link unpacks to more sequence than the app will open.'),
    );
  });
});
