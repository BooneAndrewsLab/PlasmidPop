// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { parseGenBank } from '@/io';

import { openSharedPayload, sharePayloadIn, shareUrlFor, takeShareFragment } from './share';
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
