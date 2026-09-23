// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { type SequencingRead, SeqDocument, createFeature, rangeSegment } from '@/core';

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

  it('remembers the last open document id', () => {
    const repo = freshRepo();
    repo.setLastDocumentId('xyz');
    expect(repo.lastDocumentId()).toBe('xyz');
    repo.setLastDocumentId(null);
    expect(repo.lastDocumentId()).toBeNull();
  });
});

describe('DocumentRepository reads (#49)', () => {
  const read = {
    qualities: Uint8Array.from([30, 31, 32, 33]),
    trace: {
      channels: {
        A: Int16Array.from([0, 900, 0, 0, 0, 0]),
        C: Int16Array.from([0, 0, 800, 0, 0, 0]),
        G: Int16Array.from([0, 0, 0, 700, 0, 0]),
        T: Int16Array.from([0, 0, 0, 0, 600, 0]),
      },
      peaks: Int32Array.from([1, 2, 3, 4]),
    },
  };
  const opened = SeqDocument.create({ name: 'clone3', sequence: 'ACGT', read });

  it('keeps a document’s qualities and trace, which GenBank text cannot hold', async () => {
    const repo = freshRepo();
    await repo.save('r', opened, 'clone3.ab1', {
      origin: { fileName: 'clone3.ab1', doc: opened },
      derived: false,
    });
    const back = await repo.load('r');
    // As plain numbers: fake-indexeddb's clones are typed arrays of another realm.
    const plain = (r: SequencingRead | null | undefined) =>
      r === null || r === undefined
        ? null
        : {
            qualities: [...r.qualities],
            peaks: [...(r.trace?.peaks ?? [])],
            A: [...(r.trace?.channels.A ?? [])],
            T: [...(r.trace?.channels.T ?? [])],
          };
    expect(plain(back?.doc.read)).toEqual(plain(read));
    expect(plain(back?.origin?.doc.read)).toEqual(plain(read));
  });

  it('stores no read for a document without one', async () => {
    const repo = freshRepo();
    await repo.save('d', doc, null);
    expect((await repo.load('d'))?.doc.read).toBeNull();
  });
});
