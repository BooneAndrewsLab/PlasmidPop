// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { editorStore } from '@/app/state/editorStore';
import { History } from '@/core';
import { PersistenceService } from '@/app/state/persistence';
import U49845 from '@/io/fixtures/U49845.gb?raw';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

/** The one shape every raw IndexedDB call here takes. */
async function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * The database as a build before working copies left it: schema version 1,
 * with the `handles` table this one drops, a document row without `origin`
 * or `derived`, and a handle to a file on the user's disk.
 *
 * Someone who used the deployed site has exactly this, so it is the state
 * every update has to come up from.
 */
async function seedVersion1(name: string): Promise<void> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => {
    const created = open.result;
    const docs = created.createObjectStore('documents', { keyPath: 'id' });
    docs.createIndex('updatedAt', 'updatedAt');
    docs.createIndex('name', 'name');
    created.createObjectStore('handles', { keyPath: 'id' });
  };
  const db = await request(open);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['documents', 'handles'], 'readwrite');
    tx.objectStore('documents').put({
      id: 'old-doc',
      name: 'SCU49845',
      fileName: 'U49845.gb',
      text: U49845,
      length: 5028,
      topology: 'linear',
      featureCount: 9,
      createdAt: 1,
      updatedAt: 2,
    });
    tx.objectStore('handles').put({ id: 'old-doc', handle: { name: 'U49845.gb' } });
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Could not seed the database'));
    };
  });
  db.close();
}

async function storeNames(name: string): Promise<string[]> {
  const db = await request(indexedDB.open(name));
  const names = [...db.objectStoreNames];
  db.close();
  return names;
}

describe('coming up from a database an older build wrote', () => {
  it('keeps the documents and drops the handles table', async () => {
    const name = `migration-${Date.now()}`;
    await seedVersion1(name);
    const repo = new DocumentRepository(new PlasmidPopDb(name));

    expect((await repo.list()).map((d) => d.id)).toEqual(['old-doc']);
    const loaded = await repo.load('old-doc');
    expect(loaded?.doc.name).toBe('SCU49845');
    expect(loaded?.doc.length).toBe(5028);
    expect(loaded?.fileName).toBe('U49845.gb');
    // Stored before working copies existed, so it is not one of those, and
    // there is no file to write back to whatever the dropped table held.
    expect(loaded?.origin).toBeNull();
    expect(loaded?.derived).toBe(false);

    const stores = await storeNames(name);
    expect(stores).toContain('documents');
    expect(stores).not.toContain('handles');
    // Version 5's histories table came with the same open, and is empty.
    expect(stores).toContain('histories');
    expect(loaded?.history()).toBeNull();
    expect(loaded?.historyStatus()).toBe('none');
  });

  it('adds the histories table under the documents a version 4 build left', async () => {
    const name = `migration-v4-${Date.now()}`;
    // Dexie's version 4 is IndexedDB's 40: Dexie counts in tenths.
    const open = indexedDB.open(name, 40);
    open.onupgradeneeded = () => {
      const created = open.result;
      const docs = created.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('updatedAt', 'updatedAt');
      docs.createIndex('name', 'name');
      created.createObjectStore('shelf', { keyPath: 'id' });
      created.createObjectStore('enzymeSets', { keyPath: 'id' });
    };
    const db = await request(open);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['documents'], 'readwrite');
      tx.objectStore('documents').put({
        id: 'v4-doc',
        name: 'SCU49845',
        fileName: 'U49845.gb',
        text: U49845,
        length: 5028,
        topology: 'linear',
        featureCount: 9,
        createdAt: 1,
        updatedAt: 2,
      });
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Could not seed the database'));
      };
    });
    db.close();

    const repo = new DocumentRepository(new PlasmidPopDb(name));
    const loaded = await repo.load('v4-doc');
    expect(loaded?.doc.length).toBe(5028);
    expect(loaded?.historyStatus()).toBe('none');
    expect(await storeNames(name)).toEqual(
      expect.arrayContaining(['documents', 'shelf', 'enzymeSets', 'histories']),
    );
    // And the first save after the upgrade keeps a history for it.
    if (loaded === null) throw new Error('not loaded');
    const edited = loaded.doc.insert(0, 'ACGT');
    await repo.save('v4-doc', edited, loaded.fileName, undefined, {
      history: History.create(loaded.doc).push(edited, 'Insert 4 bases'),
      opened: loaded.doc,
      saved: loaded.doc,
      origin: null,
    });
    const again = await repo.load('v4-doc');
    expect(again?.historyStatus()).toBe('restored');
    expect(again?.history()?.history.undo().present.length).toBe(5028);
  });

  it('reopens the document the older build remembered', async () => {
    const name = `session-${Date.now()}`;
    await seedVersion1(name);
    // That build only ever wrote `lastDocument`; `openDocuments` came later.
    localStorage.setItem('plasmidpop.lastDocument', 'old-doc');
    localStorage.removeItem('plasmidpop.openDocuments');

    const service = new PersistenceService(new DocumentRepository(new PlasmidPopDb(name)));
    expect(await service.restoreLastSession()).toBe(true);
    expect(editorStore.document?.name).toBe('SCU49845');
    expect(editorStore.document?.length).toBe(5028);
  });
});
