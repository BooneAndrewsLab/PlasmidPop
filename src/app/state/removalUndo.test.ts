// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument } from '@/core';
import { DocumentRepository, PlasmidPopDb, REMOVAL_HOLD_MS } from '@/storage';

import { editorStore, foldRemovalNotices, REMOVAL_NOTICE_LIMIT } from './editorStore';
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

  it('folds the older removals into one row past the limit; none loses its Undo (#322)', async () => {
    for (const count of [REMOVAL_NOTICE_LIMIT + 1, REMOVAL_NOTICE_LIMIT + 3]) {
      editorStore.dismissRemovalNotice();
      const ids = Array.from({ length: count }, (_, i) => `d${count}-${i}`);
      const { repo, service } = await setup(ids);
      const keys: (number | null)[] = [];
      for (const id of ids) keys.push(await service.removeStoredWithUndo([id], `Removed ${id}.`));
      const notices = editorStore.getState().removalNotices;
      expect(notices.map((r) => r.key)).toEqual(keys);
      const { shown, folded } = foldRemovalNotices(notices);
      expect(shown.map((r) => r.key)).toEqual(keys.slice(-REMOVAL_NOTICE_LIMIT));
      expect(folded.map((r) => r.key)).toEqual(keys.slice(0, count - REMOVAL_NOTICE_LIMIT));
      expect(repo.pendingRemovals().size).toBe(count);
      const spy = vi.spyOn(repo, 'commitRemoved');
      await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS);
      await settled(spy);
    }
  });

  it('Undo all restores exactly the folded removals; the shown ones stay held (#322)', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { db, repo, service } = await setup(ids);
    for (const id of ids) await service.removeStoredWithUndo([id], `Removed ${id}.`);
    const { folded } = foldRemovalNotices(editorStore.getState().removalNotices);
    for (const { key } of folded) expect(service.undoRemoval(key)).toBe(true);
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual(['a', 'b', 'c']);
    expect([...repo.pendingRemovals().keys()].sort()).toEqual(['d', 'e', 'f']);
    const after = foldRemovalNotices(editorStore.getState().removalNotices);
    expect(after.folded).toEqual([]);
    expect(after.shown.map((r) => r.message)).toEqual(['Removed d.', 'Removed e.', 'Removed f.']);
    const spy = vi.spyOn(repo, 'commitRemoved');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS);
    await settled(spy);
    expect(await db.documents.get('a')).toBeDefined();
    expect(await db.documents.get('f')).toBeUndefined();
  });

  it('a folded removal whose time ends is final and leaves the count (#322)', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { db, repo, service } = await setup(ids);
    await service.removeStoredWithUndo(['a'], 'Removed a.');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    for (const id of ids.slice(1)) await service.removeStoredWithUndo([id], `Removed ${id}.`);
    expect(foldRemovalNotices(editorStore.getState().removalNotices).folded).toHaveLength(2);
    const spy = vi.spyOn(repo, 'commitRemoved');
    await vi.advanceTimersByTimeAsync(REMOVAL_HOLD_MS / 2);
    await settled(spy);
    expect(spy).toHaveBeenCalledWith(['a']);
    expect(await db.documents.get('a')).toBeUndefined();
    const { shown, folded } = foldRemovalNotices(editorStore.getState().removalNotices);
    expect(folded.map((r) => r.message)).toEqual(['Removed b.']);
    expect(shown.map((r) => r.message)).toEqual(['Removed c.', 'Removed d.', 'Removed e.']);
    expect(service.undoRemoval(folded[0]?.key)).toBe(true);
    expect(await db.documents.get('b')).toBeDefined();
  });

  it('promotes a folded removal back to a toast when a shown one goes, newest first (#322)', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const { service } = await setup(ids);
    const keys: (number | null)[] = [];
    for (const id of ids) keys.push(await service.removeStoredWithUndo([id], `Removed ${id}.`));
    expect(service.undoRemoval(keys[3] ?? -1)).toBe(true);
    let fold = foldRemovalNotices(editorStore.getState().removalNotices);
    expect(fold.shown.map((r) => r.message)).toEqual(['Removed b.', 'Removed c.', 'Removed e.']);
    expect(fold.folded.map((r) => r.message)).toEqual(['Removed a.']);
    // A user dismissal takes the toast down (its removal still held) and is
    // never counted in the row; the folded one moves up.
    editorStore.dismissRemovalNotice(keys[4] ?? -1);
    fold = foldRemovalNotices(editorStore.getState().removalNotices);
    expect(fold.shown.map((r) => r.message)).toEqual(['Removed a.', 'Removed b.', 'Removed c.']);
    expect(fold.folded).toEqual([]);
  });

  it('never takes the Undo of a pending removal the user did not dismiss (#322)', async () => {
    // A seeded walk of removes, undos, dismissals and ticks, checked after every step.
    let seed = 322;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const ids = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const { repo, service } = await setup(ids);
    const spy = vi.spyOn(repo, 'commitRemoved');
    // The model: each removal's key, the time it ends, and whether it is over.
    const model = new Map<number, { ends: number; over: boolean; dismissed: boolean }>();
    let now = 0;
    let next = 0;
    for (let step = 0; step < 200; step++) {
      const r = random();
      const live = [...model].filter(([, m]) => !m.over);
      if (r < 0.4 && next < ids.length) {
        const key = await service.removeStoredWithUndo([ids[next++] ?? ''], `Removed ${next}.`);
        if (key !== null)
          model.set(key, { ends: now + REMOVAL_HOLD_MS, over: false, dismissed: false });
      } else if (r < 0.55 && live.length > 0) {
        const [key, m] = live[Math.floor(random() * live.length)] ?? [];
        if (key !== undefined && m !== undefined) {
          expect(service.undoRemoval(key)).toBe(true);
          m.over = true;
        }
      } else if (r < 0.65 && live.length > 0) {
        const [key, m] = live[Math.floor(random() * live.length)] ?? [];
        if (key !== undefined && m !== undefined) {
          editorStore.dismissRemovalNotice(key);
          m.dismissed = true;
        }
      } else {
        const by = Math.floor(random() * 4000);
        now += by;
        await vi.advanceTimersByTimeAsync(by);
        await settled(spy);
        for (const m of model.values()) if (m.ends <= now) m.over = true;
      }
      const { shown, folded } = foldRemovalNotices(editorStore.getState().removalNotices);
      expect(shown.length).toBeLessThanOrEqual(REMOVAL_NOTICE_LIMIT);
      if (folded.length > 0) expect(shown).toHaveLength(REMOVAL_NOTICE_LIMIT);
      const offered = [...folded, ...shown].map((n) => n.key);
      const owed = [...model].filter(([, m]) => !m.over && !m.dismissed).map(([key]) => key);
      expect(offered).toEqual(owed);
    }
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
