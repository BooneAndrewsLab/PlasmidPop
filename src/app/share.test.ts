// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { SeqDocument, createReference } from '@/core';
import { MAX_SHARE_PAYLOAD, ShareTooLargeError, decodeSharePayload, parseGenBank } from '@/io';

import { serialize } from './saveFile';
import {
  copyShareLink,
  openSharedPayload,
  selectionForShare,
  shareLinkFor,
  LONG_LINK_CHARS,
  longLinkWarning,
  shareNoticeText,
  sharePayloadIn,
  shareUrlFor,
  takeShareFragment,
  withoutReferences,
} from './share';
import { editorStore } from './state/editorStore';

const PBR322 = readFileSync('src/io/fixtures/J01749.gb', 'utf8');

function pbr322() {
  const doc = parseGenBank(PBR322).documents[0];
  if (doc === undefined) throw new Error('fixture has no document');
  return doc;
}

afterEach(() => {
  for (const d of editorStore.getState().documents) editorStore.closeDocument(d.documentId);
  globalThis.location.hash = '';
});

describe('sharePayloadIn', () => {
  it('finds the payload with or without the leading hash', () => {
    expect(sharePayloadIn('#d=1abc')).toBe('1abc');
    expect(sharePayloadIn('d=1abc')).toBe('1abc');
  });

  it('is null when there is no payload', () => {
    expect(sharePayloadIn('')).toBeNull();
    expect(sharePayloadIn('#')).toBeNull();
    expect(sharePayloadIn('#d=')).toBeNull();
    expect(sharePayloadIn('#section-heading')).toBeNull();
  });
});

describe('shareUrlFor', () => {
  it('builds a link whose payload opens the same document', async () => {
    const doc = pbr322();
    const url = await shareUrlFor(doc, 'https://example.org/PlasmidPop/');
    expect(url.startsWith('https://example.org/PlasmidPop/#d=')).toBe(true);

    const payload = sharePayloadIn(new URL(url).hash);
    if (payload === null) throw new Error('the link carries no payload');
    const id = await openSharedPayload(payload);
    expect(id).not.toBeNull();
    const opened = editorStore.document;
    expect(opened?.sequence.toString()).toBe(doc.sequence.toString());
    expect(opened?.name).toBe(doc.name);
    expect(opened?.topology).toBe(doc.topology);
    expect(opened?.features.all()).toHaveLength(doc.features.all().length);
  });

  it('puts no file name and no origin on the opened document, so it is the reader own copy', async () => {
    const url = await shareUrlFor(pbr322(), 'https://example.org/p/');
    const payload = sharePayloadIn(new URL(url).hash);
    if (payload === null) throw new Error('the link carries no payload');
    await openSharedPayload(payload);
    const state = editorStore.documentState();
    expect(state?.fileName).toBeNull();
    expect(state?.origin).toBeNull();
    expect(state?.derived).toBe(false);
  });
});

describe('takeShareFragment', () => {
  it('returns the payload and takes it off the address bar', () => {
    globalThis.location.hash = '#d=1abc';
    expect(takeShareFragment()).toBe('1abc');
    expect(globalThis.location.hash).toBe('');
    // A second read — React runs effects twice in development — finds nothing.
    expect(takeShareFragment()).toBeNull();
  });

  it('leaves an ordinary page alone', () => {
    expect(takeShareFragment()).toBeNull();
  });
});

describe('a damaged link', () => {
  it('is reported rather than thrown', async () => {
    expect(await openSharedPayload('1not-base64!!')).toBeNull();
    expect(editorStore.getState().error).toMatch(/damaged|not made by PlasmidPop/);
    expect(editorStore.getState().documents).toHaveLength(0);
  });
});

/** The document a link carries, read back. */
async function carried(url: string): Promise<SeqDocument> {
  const payload = sharePayloadIn(new URL(url).hash);
  if (payload === null) throw new Error('the link carries no payload');
  const doc = parseGenBank(await decodeSharePayload(payload)).documents[0];
  if (doc === undefined) throw new Error('the link carries no document');
  return doc;
}

/** Text that deflate cannot shrink much: a reference's worth of it takes its room in a link. */
function noise(n: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'abcdefghijklmnopqrstuvwxyz '.charAt((x >> 16) % 27);
  }
  return out;
}

describe('a link without references (#39)', () => {
  it('leaves out the references and comments and nothing else', async () => {
    const doc = pbr322();
    expect(doc.metadata.references.length).toBeGreaterThan(0);
    const bare = withoutReferences(doc);
    const back = await carried(await shareUrlFor(bare, 'https://example.org/'));
    expect(back.metadata.references).toEqual([]);
    expect(back.metadata.comments).toEqual([]);
    // Everything else as the whole document has it.
    const { references: _r, comments: _c, ...rest } = doc.metadata;
    const { references: _r2, comments: _c2, ...backRest } = back.metadata;
    expect(backRest).toEqual(rest);
    expect(back.sequence.toString()).toBe(doc.sequence.toString());
    expect(back.topology).toBe(doc.topology);
    expect(serialize(back, 'genbank')).toBe(serialize(bare, 'genbank'));
    const features = (d: SeqDocument) => d.features.all().map(({ id: _id, ...f }) => f);
    expect(features(back)).toEqual(features(doc));
  });

  it('keeps the sticky ends and where the document came from, which are not comments', async () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: 'AATTCGGATCCAAGCTTG',
      topology: 'linear',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: 'blunt', overhang: '', enzyme: null },
      },
      metadata: {
        references: [createReference({ number: 1, title: 'A paper' })],
        comments: ['A long note about the record'],
        derivedFrom: { checksum: `ldseguid=${'A'.repeat(27)}`, fileName: 'frag.gb' },
      },
    });
    const back = await carried(await shareUrlFor(withoutReferences(doc), 'https://example.org/'));
    expect(back.ends).toEqual(doc.ends);
    expect(back.metadata.derivedFrom).toEqual(doc.metadata.derivedFrom);
    expect(back.metadata.references).toEqual([]);
    expect(back.metadata.comments).toEqual([]);
  });

  it('is the fallback only: a link that fits carries the references', async () => {
    const doc = pbr322();
    const link = await shareLinkFor(doc, 'https://example.org/');
    expect(link.fullChars).toBeNull();
    expect((await carried(link.url)).metadata.references).toHaveLength(
      doc.metadata.references.length,
    );
  });

  it('leaves them out when the link would be too long with them, saying how long', async () => {
    const doc = pbr322();
    const references = Array.from({ length: 40 }, (_, i) =>
      createReference({ number: i + 1, title: noise(1200, i + 1) }),
    );
    const heavy = doc.setMetadata({ references });
    await expect(shareUrlFor(heavy, 'https://example.org/')).rejects.toBeInstanceOf(
      ShareTooLargeError,
    );
    const link = await shareLinkFor(heavy, 'https://example.org/');
    expect(link.fullChars).toBeGreaterThan(MAX_SHARE_PAYLOAD);
    expect(link.url.length).toBeLessThan(MAX_SHARE_PAYLOAD);
    const back = await carried(link.url);
    expect(back.metadata.references).toEqual([]);
    expect(back.features.all()).toHaveLength(doc.features.all().length);
  });

  it('says when even that is too long', async () => {
    let x = 7;
    const bases = Array.from({ length: 200_000 }, () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return 'ACGT'.charAt((x >> 16) & 3);
    }).join('');
    const big = SeqDocument.create({
      name: 'big',
      sequence: bases,
      metadata: { references: [createReference({ number: 1, title: 'A paper' })] },
    });
    await expect(shareLinkFor(big, 'https://example.org/')).rejects.toThrow(
      /even without its references and comments.*link to a selection/,
    );
  });
});

describe('a link to the selection (#39)', () => {
  it('carries the selection as a linear document with its features', async () => {
    const doc = pbr322();
    const sub = selectionForShare(doc, { start: 4000, end: 4361 + 500 });
    const link = await shareLinkFor(sub, 'https://example.org/');
    const back = await carried(link.url);
    expect(back.topology).toBe('linear');
    expect(back.sequence.toString()).toBe(doc.subsequence({ start: 4000, end: 4861 }));
    expect(back.features.all()).toHaveLength(sub.features.all().length);
    expect(back.features.all().length).toBeGreaterThan(0);
    expect(link.url.length).toBeLessThan((await shareUrlFor(doc, 'https://example.org/')).length);
  });

  it('keeps the sticky end the selection reaches', async () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: 'AATTCGGATCCAAGCTTG',
      topology: 'linear',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: "3'", overhang: 'TG', enzyme: null },
      },
    });
    const back = await carried(
      (await shareLinkFor(selectionForShare(doc, { start: 0, end: 10 }), 'https://example.org/'))
        .url,
    );
    expect(back.ends?.left).toEqual(doc.ends?.left);
    expect(back.ends?.right.kind).toBe('blunt');
  });

  it('is said to be one in the notice', async () => {
    const doc = pbr322();
    editorStore.openDocument(doc);
    await copyShareLink(doc, { start: 0, end: 1000 });
    const notice = editorStore.getState().shareNotice;
    expect(notice).toMatchObject({ of: 'selection', fullChars: null });
    if (notice === null) throw new Error('no notice');
    expect(shareNoticeText(notice)).toMatch(
      /^Link to the selection copied — [\d,]+ characters\. The selection, with its features,/,
    );
  });
});

describe('longLinkWarning (#41)', () => {
  it('says nothing up to 2,000 characters', () => {
    expect(longLinkWarning({ chars: 1_343, of: 'document', fullChars: null })).toBeNull();
    expect(longLinkWarning({ chars: LONG_LINK_CHARS, of: 'document', fullChars: null })).toBeNull();
  });

  it('warns past it, naming Slack and Teams and what to do instead', () => {
    const text = longLinkWarning({ chars: LONG_LINK_CHARS + 1, of: 'document', fullChars: null });
    expect(text).toMatch(/Slack refuses to send one, and Teams makes it hard to click/);
    expect(text).toMatch(/download the file and attach it/);
    expect(text).toMatch(/File ▸ Copy link to selection/);
  });

  it('suggests a smaller selection for a link that already is one', () => {
    const text = longLinkWarning({ chars: 7_256, of: 'selection', fullChars: null });
    expect(text).toMatch(/a smaller selection/);
    expect(text).not.toMatch(/Copy link to selection/);
  });
});

describe('shareNoticeText', () => {
  it('says which link was copied, its length, and what was left out', () => {
    expect(shareNoticeText({ chars: 5623, of: 'document', fullChars: null })).toMatch(
      /^Share link copied — 5,623 characters\. The document travels/,
    );
    expect(shareNoticeText({ chars: 21_004, of: 'document', fullChars: 40_210 })).toMatch(
      /^Too long with its references and comments \(40,210 characters\); share link copied without them — 21,004 characters\./,
    );
    expect(shareNoticeText({ chars: 900, of: 'selection', fullChars: 33_000 })).toMatch(
      /link to the selection copied without them — 900 characters/,
    );
  });
});
