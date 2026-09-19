// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;

function freshRepo(): DocumentRepository {
  return new DocumentRepository(new PlasmidPopDb(`test-${Date.now()}-${counter++}`));
}

const doc = SeqDocument.create({
  name: 'pTest',
  sequence: 'ACGTACGTACGTACGTACGT',
  topology: 'circular',
  features: [createFeature({ id: 'f', type: 'gene', name: 'g', segments: [rangeSegment(2, 8)] })],
  metadata: { description: 'A test' },
});

const shelfPart = (source: string) => ({
  id: `part-${source}`,
  flipped: false,
  fragment: {
    sequence: 'AATTCGGG',
    features: [createFeature({ id: 'g', type: 'gene', name: 'g', segments: [rangeSegment(0, 4)] })],
    range: { start: 0, end: 8 },
    left: { kind: "5'" as const, overhang: 'AATT', enzyme: 'EcoRI' },
    right: { kind: 'blunt' as const, overhang: '', enzyme: null },
    source,
  },
});

describe('DocumentRepository shelf', () => {
  it('stores the assembly shelf and reads it back whole', async () => {
    const repo = freshRepo();
    expect(await repo.loadShelf()).toEqual([]);
    const parts = [shelfPart('vector'), shelfPart('insert')];
    await repo.saveShelf(parts);
    const back = await repo.loadShelf();
    expect(back).toEqual(parts);
    expect(back[0]?.fragment.left).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
    expect(back[0]?.fragment.features[0]?.name).toBe('g');
  });

  it('clears the shelf when it is emptied', async () => {
    const repo = freshRepo();
    await repo.saveShelf([shelfPart('vector')]);
    await repo.saveShelf([]);
    expect(await repo.loadShelf()).toEqual([]);
  });

  it('drops parts it cannot make sense of rather than the whole shelf', async () => {
    const repo = freshRepo();
    const good = shelfPart('vector');
    // A row written by some other build: keep what still parses.
    const bad = [
      { ...good, id: 7 },
      {
        ...good,
        fragment: { ...good.fragment, left: { kind: 'sticky', overhang: '', enzyme: null } },
      },
      { ...good, fragment: { ...good.fragment, sequence: null } },
      { ...good, fragment: { ...good.fragment, features: [{ id: 'x' }] } },
    ];
    await repo.saveShelf([...bad, good] as unknown as Parameters<typeof repo.saveShelf>[0]);
    expect(await repo.loadShelf()).toEqual([good]);
  });
});

describe('DocumentRepository', () => {
  it('saves, lists, loads and removes documents', async () => {
    const repo = freshRepo();
    await repo.save('a', doc, 'pTest.gb');
    await repo.save('b', doc.rename('other').insert(0, 'GG'), null);
    const list = await repo.list();
    expect(list.map((d) => d.name)).toEqual(['other', 'pTest']);
    expect(list[1]).toMatchObject({
      fileName: 'pTest.gb',
      length: 20,
      topology: 'circular',
      featureCount: 1,
    });

    const loaded = await repo.load('a');
    expect(loaded?.fileName).toBe('pTest.gb');
    expect(loaded?.doc.name).toBe('pTest');
    expect(loaded?.doc.sequence.toString()).toBe(doc.sequence.toString());
    expect(loaded?.doc.features.all()[0]).toMatchObject({ name: 'g', type: 'gene' });
    expect(loaded?.doc.metadata.description).toBe('A test');

    await repo.remove('a');
    expect(await repo.load('a')).toBeNull();
    expect((await repo.list()).map((d) => d.id)).toEqual(['b']);
  });

  it('keeps createdAt across updates and orders by last update', async () => {
    const repo = freshRepo();
    await repo.save('a', doc, null);
    const first = (await repo.list())[0];
    await new Promise((r) => setTimeout(r, 5));
    await repo.save('a', doc.rename('renamed'), null);
    const second = (await repo.list())[0];
    expect(second?.name).toBe('renamed');
    expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? Infinity);
  });

  it('finds an identical stored document by content and file name', async () => {
    const repo = freshRepo();
    await repo.save('a', doc, 'pTest.gb');
    expect(await repo.has('a')).toBe(true);
    expect(await repo.has('zzz')).toBe(false);
    expect(await repo.findIdentical(doc, 'pTest.gb')).toBe('a');
    expect(await repo.findIdentical(doc, null)).toBeNull();
    expect(await repo.findIdentical(doc.insert(0, 'A'), 'pTest.gb')).toBeNull();
    expect(await repo.findIdentical(doc.rename('other'), 'pTest.gb')).toBeNull();
  });

  it('renames a stored document, keeping its file name', async () => {
    const repo = freshRepo();
    await repo.save('a', doc, 'pTest.gb');
    expect(await repo.rename('a', 'pTest edited')).toBe(true);
    expect(await repo.rename('missing', 'x')).toBe(false);
    const list = await repo.list();
    expect(list.map((d) => [d.name, d.fileName])).toEqual([['pTest edited', 'pTest.gb']]);
    expect((await repo.load('a'))?.doc.name).toBe('pTest edited');
  });

  it('moves file handles between ids', async () => {
    const repo = freshRepo();
    const handle = { kind: 'file', name: 'x.gb' } as unknown as FileSystemFileHandle;
    await repo.saveHandle('fresh', handle);
    await repo.moveHandle('fresh', 'old');
    expect(await repo.loadHandle('fresh')).toBeNull();
    expect(await repo.loadHandle('old')).toMatchObject({ name: 'x.gb' });
    await repo.moveHandle('missing', 'old'); // no handle to move: keeps the existing one
    expect(await repo.loadHandle('old')).toMatchObject({ name: 'x.gb' });
    // The overwrite agreement travels with the handle.
    await repo.confirmWrite('old');
    await repo.moveHandle('old', 'newer');
    expect(await repo.isWriteConfirmed('newer')).toBe(true);
  });

  it('remembers the last open document id', () => {
    const repo = freshRepo();
    repo.setLastDocumentId('xyz');
    expect(repo.lastDocumentId()).toBe('xyz');
    repo.setLastDocumentId(null);
    expect(repo.lastDocumentId()).toBeNull();
  });

  it('stores and retrieves file handles', async () => {
    const repo = freshRepo();
    const handle = { kind: 'file', name: 'x.gb' } as unknown as FileSystemFileHandle;
    await repo.saveHandle('a', handle);
    expect(await repo.loadHandle('a')).toMatchObject({ name: 'x.gb' });
    expect(await repo.loadHandle('missing')).toBeNull();
    // Opened files are not confirmed for overwriting until the user agrees.
    expect(await repo.isWriteConfirmed('a')).toBe(false);
    await repo.confirmWrite('a');
    expect(await repo.isWriteConfirmed('a')).toBe(true);
    await repo.confirmWrite('missing'); // nothing stored: nothing to confirm
    expect(await repo.isWriteConfirmed('missing')).toBe(false);
    await repo.saveHandle('b', handle, true); // picked in a save dialog
    expect(await repo.isWriteConfirmed('b')).toBe(true);
  });
});
