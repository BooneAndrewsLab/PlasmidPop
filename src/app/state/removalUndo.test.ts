// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument } from '@/core';
import { DocumentRepository, PlasmidPopDb, REMOVAL_HOLD_MS } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService } from './persistence';

const doc = (name: string) => SeqDocument.create({ name, sequence: 'ACGTACGTACGT' });

let n = 0;
async function setup(ids: string[] = ['a', 'b']) {
  const db = new PlasmidPopDb(`undo-${Date.now()}-${n++}`);
  const repo = new DocumentRepository(db);
  const service = new PersistenceService(repo);
  for (const id of ids) {
    await repo.save(id, doc(`doc ${id}`), null);
    await db.histories.put({ id } as never);
  }
  return { db, repo, service };
}

/** Lets a timer-driven commit finish: the one `commitRemoved` call it makes. */
async function committed(
  repo: DocumentRepository,
  spy: { mock: { results: { value: unknown }[] } },
) {
  await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS);
  await spy.mock.results[0]?.value;
  expect(repo.pendingRemovals().size).toBe(0);
}

beforeEach(() => {
  for (const d of editorStore.getState().documents) editorStore.closeDocument(d.documentId);
  editorStore.dismissRemovalNotice();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Remove with Undo (item 111)', () => {
  it('hides the documents and puts up the toast, deleting nothing until the hold runs out', async () => {
    const { db, repo, service } = await setup();
    await service.removeStoredWithUndo(['a'], 'Removed "doc a".');
    expect((await service.listStored()).map((d) => d.id)).toEqual(['b']);
    expect(editorStore.getState().removalNotice).toBe('Removed "doc a".');
    expect(await db.documents.get('a')).toBeDefined();
    expect(await db.histories.get('a')).toBeDefined();

    const spy = vi.spyOn(repo, 'commitRemoved');
    await committed(repo, spy);
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.histories.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(editorStore.getState().removalNotice).toBeNull();
  });

  it('is taken back by Undo, whole: the row, its history, and no deletion later', async () => {
    const { db, repo, service } = await setup();
    await service.removeStoredWithUndo(['a', 'b'], 'Removed 2 documents.');
    const spy = vi.spyOn(repo, 'commitRemoved');
    expect(service.undoRemoval()).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(editorStore.getState().removalNotice).toBeNull();
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS * 2);
    expect(spy).not.toHaveBeenCalled();
    expect(await db.histories.get('a')).toBeDefined();
    expect(service.undoRemoval()).toBe(false);
  });

  it('closes the document own tab at once, and it is not written back', async () => {
    const { service } = await setup();
    await service.openStored('a');
    expect(editorStore.getState().documents.map((d) => d.documentId)).toContain('a');
    await service.removeStoredWithUndo(['a'], 'Removed.');
    expect(editorStore.getState().documents.map((d) => d.documentId)).not.toContain('a');
  });

  it('carries out the removal before it that is still held when another is made', async () => {
    const { db, service } = await setup(['a', 'b', 'c']);
    await service.removeStoredWithUndo(['a'], 'Removed a.');
    await service.removeStoredWithUndo(['b'], 'Removed b.');
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(service.undoRemoval()).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['b', 'c']);
  });

  it('does nothing for no documents', async () => {
    const { service } = await setup();
    await service.removeStoredWithUndo([], 'Removed none.');
    expect(editorStore.getState().removalNotice).toBeNull();
  });

  it('spares a document that was opened again while it waited, and only takes its mark off', async () => {
    const { db, repo, service } = await setup();
    await service.removeStoredWithUndo(['a'], 'Removed.');
    await service.openStored('a');
    const spy = vi.spyOn(repo, 'commitRemoved');
    await committed(repo, spy);
    expect(spy).toHaveBeenCalledWith([]);
    expect(await db.documents.get('a')).toBeDefined();
    expect(editorStore.getState().documents.map((d) => d.documentId)).toContain('a');
  });
});

describe('a page closed or reloaded while a removal waits (item 111)', () => {
  it('never loses a row that was not marked, and deletes a marked one whose time ran out', async () => {
    const { db, repo } = await setup(['a', 'b']);
    repo.hideForRemoval(['a'], Date.now() - 1);
    const reloaded = new PersistenceService(new DocumentRepository(db));
    await reloaded.settleRemovals();
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.histories.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(await db.histories.get('b')).toBeDefined();
    expect(repo.pendingRemovals().size).toBe(0);
  });

  it('keeps a marked row hidden while its hold lasts, and deletes it when it is due', async () => {
    const { db, repo } = await setup(['a', 'b']);
    repo.hideForRemoval(['a'], Date.now() + REMOVAL_HOLD_MS);
    const reloadedRepo = new DocumentRepository(db);
    const reloaded = new PersistenceService(reloadedRepo);
    await reloaded.settleRemovals();
    expect((await reloaded.listStored()).map((d) => d.id)).toEqual(['b']);
    expect(await db.documents.get('a')).toBeDefined();
    const spy = vi.spyOn(reloadedRepo, 'commitRemoved');
    await committed(reloadedRepo, spy);
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
  });

  it('does not delete a row whose removal was undone before the reload', async () => {
    const { db, repo, service } = await setup(['a']);
    await service.removeStoredWithUndo(['a'], 'Removed.');
    service.undoRemoval();
    expect(repo.pendingRemovals().size).toBe(0);
    await new PersistenceService(new DocumentRepository(db)).settleRemovals(Date.now() + 1e9);
    expect(await db.documents.get('a')).toBeDefined();
  });
});
