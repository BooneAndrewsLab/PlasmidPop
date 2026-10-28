// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument, lineageOf, withLineage } from '@/core';
import { writeGenBank } from '@/io';

import { createBackup, restoreBackup } from './backup';
import { PlasmidPopDb } from './db';
import { DocumentRepository, REMOVAL_HOLD_MS } from './documentRepository';

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`browser-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const template = SeqDocument.create({
  name: 'AF025746',
  sequence: 'ACGTACGTACGTACGTACGTACGTAAGG',
  topology: 'linear',
});

/** A PCR product of the template, as the Cloning tools leave one. */
function product(name: string): SeqDocument {
  return withLineage(SeqDocument.create({ name, sequence: 'ACGTACGTACGTAC', topology: 'linear' }), {
    op: 'pcr',
    parents: [lineageOf(template)],
    forward: { name: 'f', sequence: 'ACGTACGT' },
    reverse: { name: 'r', sequence: 'GTACGTAC' },
    polymerase: 'taq',
  });
}

const SCRATCH = { origin: null, derived: false, kind: 'scratch' as const };

beforeEach(() => {
  localStorage.clear();
});

describe('listing from the summaries (item 111)', () => {
  it('reads no document text', async () => {
    const { repo, db } = fresh();
    await repo.save('a', product('p1'), null, SCRATCH);
    await repo.save('b', template, 'AF025746.gb');
    const spy = vi.spyOn(db.documents, 'toArray');
    const listed = await repo.list();
    expect(spy).not.toHaveBeenCalled();
    expect(listed.map((d) => d.id)).toEqual(['b', 'a']);
    // The summary row is the small fields, with no text in it.
    expect(Object.keys((await db.summaries.get('a')) ?? {})).not.toContain('text');
  });

  it('carries the parent of a product from its lineage, and none for a document with none', async () => {
    const { repo } = fresh();
    await repo.save('a', product('p1'), null, SCRATCH);
    await repo.save('b', template, 'AF025746.gb');
    const [b, a] = await repo.list();
    expect(a).toMatchObject({ id: 'a', parentName: 'AF025746' });
    expect(a?.parentChecksum).toMatch(/^cdseguid=|^ldseguid=/);
    expect(b?.parentChecksum).toBeUndefined();
  });

  it('follows every write: a new write, Keep and Remove', async () => {
    const { repo, db } = fresh();
    await repo.save('a', product('p1'), null, SCRATCH);
    await repo.save('a', product('renamed'), null, SCRATCH);
    expect((await repo.list()).map((d) => d.name)).toEqual(['renamed']);
    await repo.keep(['a']);
    expect((await repo.list())[0]?.kind).toBe('file');
    await repo.remove('a');
    expect(await repo.list()).toEqual([]);
    expect(await db.summaries.count()).toBe(0);
  });
});

/** The database as version 13 left it: rows with texts, and no summaries table. */
async function seedVersion13(name: string, rows: Record<string, unknown>[]): Promise<void> {
  const open = indexedDB.open(name, 130);
  open.onupgradeneeded = () => {
    const docs = open.result.createObjectStore('documents', { keyPath: 'id' });
    for (const index of ['updatedAt', 'name', 'checksum', 'kind']) docs.createIndex(index, index);
  };
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(open.error ?? new Error('Could not seed the database'));
    };
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents'], 'readwrite');
    for (const row of rows) tx.objectStore('documents').put(row);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Could not seed the database'));
    };
  });
  db.close();
}

const v13Row = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  fileName: null,
  text,
  length: 14,
  topology: 'linear',
  featureCount: 0,
  kind: 'scratch',
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe('coming up from version 13 (item 111)', () => {
  it('fills the summaries and the parent of every row, and leaves a text that will not parse listed', async () => {
    const name = `migration-v13-${Date.now()}`;
    await seedVersion13(name, [
      v13Row('made', writeGenBank(product('made'))),
      v13Row('plain', writeGenBank(template), { kind: 'file', updatedAt: 3 }),
      v13Row('garbled', 'this is not GenBank', { updatedAt: 1 }),
    ]);
    const db = new PlasmidPopDb(name);
    const listed = await new DocumentRepository(db).list();
    expect(listed.map((d) => [d.id, d.kind, d.parentName])).toEqual([
      ['plain', 'file', undefined],
      ['made', 'scratch', 'AF025746'],
      ['garbled', 'scratch', undefined],
    ]);
    // The row itself says it too, which a backup carries.
    expect((await db.documents.get('made'))?.parentName).toBe('AF025746');
    expect((await db.documents.get('made'))?.parentChecksum).toBe(listed[1]?.parentChecksum);
    expect((await db.documents.get('garbled'))?.parentChecksum).toBeUndefined();
  });
});

describe('backup and restore carry the parent (item 111)', () => {
  it('restores the fields a backup holds', async () => {
    const a = fresh();
    await a.repo.save('p', product('p1'), null, SCRATCH);
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect(await b.repo.list()).toEqual(await a.repo.list());
    expect((await b.db.documents.get('p'))?.parentName).toBe('AF025746');
  });

  it('derives them for a backup from before, whose rows have none', async () => {
    const a = fresh();
    await a.repo.save('p', product('p1'), null, SCRATCH);
    const row = await a.db.documents.get('p');
    const { parentChecksum: _c, parentName: _n, ...old } = row ?? { id: 'x' };
    await a.db.documents.put(old as never);
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect((await b.repo.list())[0]).toMatchObject({ id: 'p', parentName: 'AF025746' });
  });

  it('lists a restored document that has no lineage as it was, ungrouped', async () => {
    const a = fresh();
    await a.repo.save('t', template, 'AF025746.gb');
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect((await b.repo.list())[0]?.parentChecksum).toBeUndefined();
  });
});

describe('a removal held for Undo (item 111)', () => {
  it('hides the document from the listing and from a new open, and deletes nothing', async () => {
    const { repo, db } = fresh();
    await repo.save('a', template, 'AF025746.gb');
    await repo.save('b', product('p'), null, SCRATCH);
    repo.hideForRemoval(['a'], Date.now() + REMOVAL_HOLD_MS);
    expect((await repo.list()).map((d) => d.id)).toEqual(['b']);
    expect(await repo.findIdentical(template, 'AF025746.gb')).toBeNull();
    expect(await db.documents.count()).toBe(2);
  });

  it('is undone by forgetting the mark: the row is listed again as it was', async () => {
    const { repo } = fresh();
    await repo.save('a', template, 'AF025746.gb');
    repo.hideForRemoval(['a'], Date.now() + REMOVAL_HOLD_MS);
    repo.restoreRemoved(['a']);
    expect((await repo.list()).map((d) => d.id)).toEqual(['a']);
    expect(repo.pendingRemovals().size).toBe(0);
  });

  it('is carried out with the history row, and the mark goes after the delete', async () => {
    const { repo, db } = fresh();
    await repo.save('a', template, 'AF025746.gb');
    await db.histories.put({ id: 'a' } as never);
    repo.hideForRemoval(['a'], Date.now());
    await repo.commitRemoved(['a']);
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.summaries.get('a')).toBeUndefined();
    expect(await db.histories.get('a')).toBeUndefined();
    expect(repo.pendingRemovals().size).toBe(0);
  });

  it('survives a reload: a second repository over the same storage sees the mark', async () => {
    const { repo, db } = fresh();
    await repo.save('a', template, 'AF025746.gb');
    const until = Date.now() + REMOVAL_HOLD_MS;
    repo.hideForRemoval(['a'], until);
    const reloaded = new DocumentRepository(db);
    expect(await reloaded.list()).toEqual([]);
    expect([...reloaded.pendingRemovals()]).toEqual([['a', until]]);
  });
});
