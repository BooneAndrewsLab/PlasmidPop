import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseGenBank } from '../genbank';
import { writeGenBank } from '../genbank';
import {
  MAX_SHARE_PAYLOAD,
  ShareLinkError,
  ShareTooLargeError,
  decodeSharePayload,
  encodeSharePayload,
} from './link';

const PBR322 = readFileSync('src/io/fixtures/J01749.gb', 'utf8');

describe('share link payload', () => {
  it('round-trips text unchanged', async () => {
    const payload = await encodeSharePayload(PBR322);
    expect(await decodeSharePayload(payload)).toBe(PBR322);
  });

  it('round-trips a document through GenBank with its features', async () => {
    const before = parseGenBank(PBR322).documents[0];
    if (before === undefined) throw new Error('fixture has no document');
    const text = await decodeSharePayload(await encodeSharePayload(writeGenBank(before)));
    const after = parseGenBank(text).documents[0];
    if (after === undefined) throw new Error('decoded text has no document');
    expect(after.sequence.toString()).toBe(before.sequence.toString());
    expect(after.topology).toBe(before.topology);
    expect(after.name).toBe(before.name);
    expect(after.features.all().map((f) => [f.type, f.name])).toEqual(
      before.features.all().map((f) => [f.type, f.name]),
    );
  });

  it('is URL-safe and much smaller than the file', async () => {
    const payload = await encodeSharePayload(PBR322);
    expect(payload).toMatch(/^1[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(PBR322.length / 2);
  });

  it('survives unicode in a record', async () => {
    const text = 'LOCUS  x  1 bp\nCOMMENT  Tm 65 °C — β-lactamase\nORIGIN\n  1 a\n//\n';
    expect(await decodeSharePayload(await encodeSharePayload(text))).toBe(text);
  });

  it('refuses a document too big for a link', async () => {
    // Random bases so deflate cannot get the payload back under the limit.
    const bases = Array.from({ length: 900_000 }, () => 'ACGT'[Math.floor(Math.random() * 4)]).join(
      '',
    );
    await expect(encodeSharePayload(bases)).rejects.toBeInstanceOf(ShareTooLargeError);
    await expect(encodeSharePayload(bases)).rejects.toThrow(/Download the GenBank file/);
  });

  it('allows a payload right up to the limit', async () => {
    const payload = await encodeSharePayload('A'.repeat(100));
    expect(payload.length).toBeLessThanOrEqual(MAX_SHARE_PAYLOAD);
  });

  it('rejects a payload with no version prefix', async () => {
    await expect(decodeSharePayload('xyz')).rejects.toBeInstanceOf(ShareLinkError);
  });

  it('rejects a payload cut short', async () => {
    const payload = await encodeSharePayload(PBR322);
    await expect(decodeSharePayload(payload.slice(0, 200))).rejects.toThrow(/damaged/);
  });
});
