// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument } from '@/core';
import { DocumentRepository, PlasmidPopDb, REMOVAL_HOLD_MS } from '@/storage';

import { editorStore, REMOVAL_NOTICE_LIMIT } from './editorStore';
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

/** Lets every timer-driven commit so far finish. */
async function settled(spy: { mock: { results: { value: unknown }[] } }) {
  for (const r of spy.mock.results) await r.value;
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
    expect(editorStore.getState().removalNotices.map((r) => r.message)).toEqual([
      'Removed "doc a".',
    ]);
    expect(await db.documents.get('a')).toBeDefined();
    expect(await db.histories.get('a')).toBeDefined();

    const spy = vi.spyOn(repo, 'commitRemoved');
    await committed(repo, spy);
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.histories.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(editorStore.getState().removalNotices).toEqual([]);
  });

  it('is taken back by Undo, whole: the row, its history, and no deletion later', async () => {
    const { db, repo, service } = await setup();
    await service.removeStoredWithUndo(['a', 'b'], 'Removed 2 documents.');
    const spy = vi.spyOn(repo, 'commitRemoved');
    expect(service.undoRemoval()).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(editorStore.getState().removalNotices).toEqual([]);
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

  it('holds a second removal beside the first: each has its own toast and Undo (#322)', async () => {
    const { db, service } = await setup(['a', 'b', 'c']);
    const first = await service.removeStoredWithUndo(['a'], 'Removed a.');
    const second = await service.removeStoredWithUndo(['b'], 'Removed b.');
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect(await db.documents.get('a')).toBeDefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(editorStore.getState().removalNotices.map((r) => r.message)).toEqual([
      'Removed a.',
      'Removed b.',
    ]);
    expect((await service.listStored()).map((d) => d.id)).toEqual(['c']);
  });

  it('undoes the first removal only: the second stays held and its timer still runs (#322)', async () => {
    const { db, repo, service } = await setup(['a', 'b', 'c']);
    const first = await service.removeStoredWithUndo(['a'], 'Removed a.');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await service.removeStoredWithUndo(['b'], 'Removed b.');
    const spy = vi.spyOn(repo, 'commitRemoved');
    expect(service.undoRemoval(first ?? -1)).toBe(true);
    expect(service.undoRemoval(first ?? -1)).toBe(false);
    expect(editorStore.getState().removalNotices.map((r) => r.message)).toEqual(['Removed b.']);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'c']);
    expect([...repo.pendingRemovals().keys()]).toEqual(['b']);
    // The first removal's time comes and goes: nothing of the second is touched yet.
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    expect(spy).not.toHaveBeenCalled();
    expect(await db.documents.get('b')).toBeDefined();
    // The second's own ten seconds end: it, and only it, goes.
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await spy.mock.results[0]?.value;
    expect(spy).toHaveBeenCalledWith(['b']);
    expect(await db.documents.get('b')).toBeUndefined();
    expect(await db.documents.get('a')).toBeDefined();
    expect(editorStore.getState().removalNotices).toEqual([]);
  });

  it('carries out each removal when its own time ends, the earlier first (#322)', async () => {
    const { db, repo, service } = await setup(['a', 'b', 'c']);
    await service.removeStoredWithUndo(['a'], 'Removed a.');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    const second = await service.removeStoredWithUndo(['b'], 'Removed b.');
    const spy = vi.spyOn(repo, 'commitRemoved');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await spy.mock.results[0]?.value;
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeDefined();
    expect(editorStore.getState().removalNotices.map((r) => r.key)).toEqual([second]);
    expect(service.undoRemoval(second ?? -1)).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['b', 'c']);
  });

  it('keeps a removal of several documents one Undo (#322)', async () => {
    const { service } = await setup(['a', 'b', 'c']);
    await service.removeStoredWithUndo(['a', 'b'], 'Removed 2 documents.');
    expect(editorStore.getState().removalNotices).toHaveLength(1);
    expect(service.undoRemoval()).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('shows only the newest few toasts; an older one still waits out its time (#322)', async () => {
    const ids = Array.from({ length: REMOVAL_NOTICE_LIMIT + 2 }, (_, i) => `d${i}`);
    const { db, repo, service } = await setup(ids);
    for (const id of ids) await service.removeStoredWithUndo([id], `Removed ${id}.`);
    expect(editorStore.getState().removalNotices.map((r) => r.message)).toEqual(
      ids.slice(-REMOVAL_NOTICE_LIMIT).map((id) => `Removed ${id}.`),
    );
    expect(repo.pendingRemovals().size).toBe(ids.length);
    expect(await db.documents.get('d0')).toBeDefined();
    const spy = vi.spyOn(repo, 'commitRemoved');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS);
    await settled(spy);
    expect(repo.pendingRemovals().size).toBe(0);
    expect(await db.documents.get('d0')).toBeUndefined();
  });

  it('a later removal of a document an earlier one holds takes it over (#322)', async () => {
    const { db, repo, service } = await setup(['a', 'b']);
    const first = await service.removeStoredWithUndo(['a'], 'Removed a.');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await service.openStored('a');
    await service.removeStoredWithUndo(['a', 'b'], 'Removed 2 documents.');
    const spy = vi.spyOn(repo, 'commitRemoved');
    // The first removal's time ends: it holds nothing now, so nothing is deleted.
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await settled(spy);
    expect(await db.documents.get('a')).toBeDefined();
    expect(service.undoRemoval(first ?? -1)).toBe(false);
    expect(service.undoRemoval()).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('does nothing for no documents', async () => {
    const { service } = await setup();
    await service.removeStoredWithUndo([], 'Removed none.');
    expect(editorStore.getState().removalNotices).toEqual([]);
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

  it('settles every removal a closed page left, each by its own due time (#322)', async () => {
    const { db, repo } = await setup(['a', 'b', 'c', 'd']);
    const now = Date.now();
    repo.hideForRemoval(['a'], now - 1);
    repo.hideForRemoval(['b'], now + REMOVAL_HOLD_MS / 2);
    repo.hideForRemoval(['c'], now + REMOVAL_HOLD_MS);
    const reloadedRepo = new DocumentRepository(db);
    const reloaded = new PersistenceService(reloadedRepo);
    await reloaded.settleRemovals(now);
    expect(await db.documents.get('a')).toBeUndefined();
    expect((await reloaded.listStored()).map((d) => d.id)).toEqual(['d']);
    const spy = vi.spyOn(reloadedRepo, 'commitRemoved');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await settled(spy);
    expect(await db.documents.get('b')).toBeUndefined();
    expect(await db.documents.get('c')).toBeDefined();
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await settled(spy);
    expect(await db.documents.get('c')).toBeUndefined();
    expect(await db.documents.get('d')).toBeDefined();
    expect(reloadedRepo.pendingRemovals().size).toBe(0);
    expect(editorStore.getState().removalNotices).toEqual([]);
  });

  it('reads the marks an older build wrote, several ids to their due times (#322)', async () => {
    const { db } = await setup(['a', 'b', 'c']);
    const now = Date.now();
    localStorage.setItem('plasmidpop.removing', JSON.stringify({ a: now - 1, b: now - 1 }));
    await new PersistenceService(new DocumentRepository(db)).settleRemovals(now);
    expect(await db.documents.get('a')).toBeUndefined();
    expect(await db.documents.get('b')).toBeUndefined();
    expect(await db.documents.get('c')).toBeDefined();
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
