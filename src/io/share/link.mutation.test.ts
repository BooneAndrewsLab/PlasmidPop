import { beforeAll, describe, expect, it } from 'vitest';

import {
  MAX_SHARE_PAYLOAD,
  ShareLinkError,
  ShareTooLargeError,
  decodeSharePayload,
  encodeSharePayload,
} from './link';

// Tests written against the survivors of a mutation run (item 50).

/** Deterministic bases that deflate cannot squeeze much. */
function bases(length: number): string {
  let x = 11;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    out += 'ACGT'.charAt((x >> 16) % 4);
  }
  return out;
}

/** The length of the payload `text` makes, whether or not a link may carry it. */
async function payloadLength(text: string): Promise<number> {
  try {
    return (await encodeSharePayload(text)).length;
  } catch (error) {
    if (error instanceof ShareTooLargeError) return error.chars;
    throw error;
  }
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
  // Texts whose payloads are exactly at the limit and one past it, found by
  // growing random bases a base at a time: deflate makes that exact
  // arithmetic impossible to do ahead.
  let atLimit = '';
  let pastLimit = '';

  beforeAll(async () => {
    const all = bases(200_000);
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((await payloadLength(all.slice(0, mid))) < MAX_SHARE_PAYLOAD) lo = mid + 1;
      else hi = mid;
    }
    for (let n = lo - 20; n < lo + 40 && (atLimit === '' || pastLimit === ''); n++) {
      const length = await payloadLength(all.slice(0, n));
      if (length === MAX_SHARE_PAYLOAD) atLimit = all.slice(0, n);
      if (length === MAX_SHARE_PAYLOAD + 1 && pastLimit === '') pastLimit = all.slice(0, n);
    }
  }, 30_000);

  it('allows a payload of exactly the limit', async () => {
    expect(atLimit).not.toBe('');
    const payload = await encodeSharePayload(atLimit);
    expect(payload.length).toBe(MAX_SHARE_PAYLOAD);
    expect(await decodeSharePayload(payload)).toBe(atLimit);
  });

  it('refuses a payload one character past it, saying how long it is', async () => {
    expect(pastLimit).not.toBe('');
    await expect(encodeSharePayload(pastLimit)).rejects.toMatchObject({
      name: 'ShareTooLargeError',
      chars: MAX_SHARE_PAYLOAD + 1,
    });
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
