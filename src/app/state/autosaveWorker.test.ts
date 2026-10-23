// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment, typingRun } from '@/core';
import { writeGenBank } from '@/io';
import { DocumentRepository, PlasmidPopDb, decodeHistory } from '@/storage';
import { randomDna, seededRandom } from '@/test/random';
import { cloneSaveClient } from '@/test/saveWorker';

import { editorStore } from './editorStore';
import { PersistenceService, persistence } from './persistence';
import { useFlushOnLeave } from './usePersistence';

/**
 * The autosave with its GenBank text written in the save worker (#272):
 * what it stores must be what the main-thread save stored, row for row and
 * byte for byte, and a save still waiting on the worker must never put an
 * older state over a newer one, nor lose the last edit to a close, a
 * switch or the page being left.
 */

let counter = 0;

function freshDb(): PlasmidPopDb {
  return new PlasmidPopDb(`autosave-worker-${Date.now()}-${counter++}`);
}

const NOW = 1_790_000_000_000;

function large(seed: number, name = 'pLarge'): SeqDocument {
  const length = 60_000;
  return SeqDocument.create({
    name,
    sequence: randomDna(seededRandom(seed), length),
    topology: 'circular',
    features: [
      createFeature({
        id: 'ori',
        type: 'rep_origin',
        name: 'across the origin',
        segments: [rangeSegment(length - 100, length), rangeSegment(0, 100)],
      }),
      createFeature({
        id: 'cds',
        type: 'CDS',
        name: 'bla',
        strand: 'reverse',
        segments: [rangeSegment(1000, 1300), rangeSegment(1400, 1861)],
        qualifiers: [
          { name: 'gene', value: 'bla' },
          { name: 'note', value: 'a "quoted"\nnote' },
          { name: 'pseudo', value: null },
        ],
      }),
    ],
    metadata: { description: 'a test plasmid', comments: ['kept'] },
  });
}

const small = SeqDocument.create({
  name: 'pSmall',
  sequence: 'ACGTACGTACGTACGTACGTACGTACGTACGT',
  topology: 'linear',
  features: [createFeature({ id: 'g', type: 'gene', name: 'g', segments: [rangeSegment(4, 20)] })],
});

/** Every row of both tables, by id, as stored. */
async function rows(db: PlasmidPopDb): Promise<{ documents: unknown[]; histories: unknown[] }> {
  const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);
  return {
    documents: (await db.documents.toArray()).sort(byId),
    histories: (await db.histories.toArray()).sort(byId),
  };
}

/** What the autosave stored before #272, for the tabs as they stand: `save`, text written here. */
async function mainThreadRows(): Promise<{ documents: unknown[]; histories: unknown[] }> {
  const db = freshDb();
  const repo = new DocumentRepository(db);
  for (const d of editorStore.getState().documents) {
    await repo.save(
      d.documentId,
      d.history.present,
      d.fileName,
      { origin: d.origin, derived: d.derived },
      { history: d.history, opened: d.openedDoc, saved: d.savedDoc, origin: d.origin?.doc ?? null },
    );
  }
  return rows(db);
}

function storedText(db: PlasmidPopDb, id: string): Promise<string | undefined> {
  return db.documents.get(id).then((r) => r?.text);
}

function activeId(): string {
  const id = editorStore.getState().documentId;
  if (id === null) throw new Error('no document in front');
  return id;
}

describe('the autosave through the save worker (#272)', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    editorStore.closeAllDocuments();
  });

  it('stores exactly what the main-thread save stored, for tabs of every kind', async () => {
    // A file just opened; a working copy of one, edited, undone, downloaded,
    // edited again; a large circular one typed into; a new one renamed.
    editorStore.openDocument(small, 'pSmall.gb');
    editorStore.openDocument(large(1, 'pFile'), 'pFile.gb');
    editorStore.apply({ type: 'insert', position: 5, text: 'GGG' });
    editorStore.apply({ type: 'updateFeature', id: 'cds', patch: { name: 'renamed' } });
    editorStore.apply({ type: 'delete', range: { start: 100, end: 140 } });
    editorStore.undo();
    editorStore.markDownloaded(activeId(), 'pFile copy.gb');
    editorStore.apply({ type: 'reverseComplement' });
    editorStore.openDocument(large(2, 'pTyped'), null);
    for (let at = 10; at < 16; at++) {
      editorStore.apply({ type: 'insert', position: at, text: 'a' }, undefined, undefined, {
        ...typingRun(at, at + 1),
      });
    }
    editorStore.apply({ type: 'setOrigin', position: 30_000 });
    editorStore.openDocument(SeqDocument.create({ name: 'Untitled', sequence: '' }), null);
    editorStore.apply({ type: 'insert', position: 0, text: 'ACGTTT' });
    editorStore.apply({ type: 'setTopology', topology: 'circular' });

    const db = freshDb();
    const { client, workers } = cloneSaveClient();
    const service = new PersistenceService(new DocumentRepository(db), client);
    await service.autosave();

    // The text really did come from the worker, with the file beside a tab opened from one.
    expect(workers[0]?.received.map((r) => r.docs.length)).toEqual([2, 2, 1, 1]);
    const expected = await mainThreadRows();
    expect(expected.documents).toHaveLength(4);
    expect(expected.histories).toHaveLength(4);
    expect(await rows(db)).toEqual(expected);
  });

  it('never writes an older state after a newer one when two saves follow each other', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient({ auto: false });
    const repo = new DocumentRepository(db);
    const service = new PersistenceService(repo, client);
    const write = vi.spyOn(repo, 'write');
    editorStore.openDocument(large(3), 'pLarge.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const older = editorStore.document;
    const first = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    const latest = editorStore.document;
    const second = service.autosave();
    const pump = setInterval(() => workers[0]?.release(), 1);
    try {
      await Promise.all([first, second]);
    } finally {
      clearInterval(pump);
    }
    // What was written, in the order the writes were made.
    const written: unknown[] = [];
    for (const [i, call] of write.mock.calls.entries()) {
      if (await (write.mock.results[i]?.value as Promise<boolean>)) written.push(call[1]);
    }
    expect(written.at(-1)).toBe(latest);
    expect(written.indexOf(older)).toBeLessThanOrEqual(0);
    expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
  });

  it('lets the flush on leaving overtake a save waiting on the worker, which then writes nothing', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient({ auto: false });
    const repo = new DocumentRepository(db);
    const service = new PersistenceService(repo, client);
    const write = vi.spyOn(repo, 'write');
    editorStore.openDocument(large(4), 'pLarge.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const older = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    const latest = editorStore.document;
    // Urgent: written here and at once, without the worker.
    await service.autosave({ urgent: true });
    expect(workers[0]?.held).toHaveLength(1);
    expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
    // The older save's text arrives after it; it must stand down.
    workers[0]?.release();
    await older;
    expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
    // It finds out before the put (#278), or inside the put's transaction.
    const results = await Promise.all(write.mock.results.map((r) => r.value as Promise<boolean>));
    expect(results[0]).toBe(true);
    expect(results.slice(1).every((written) => !written)).toBe(true);
    const row = await db.histories.get(activeId());
    expect(decodeHistory(row, null)?.history.present.sequence.toString()).toBe(
      latest?.sequence.toString(),
    );
    // And nothing is left to write.
    const calls = write.mock.calls.length;
    await service.autosave();
    expect(write).toHaveBeenCalledTimes(calls);
  });

  it('writes a newly opened document on leaving without a lookup first, and notes the tabs at once (#290)', async () => {
    const db = freshDb();
    const { client } = cloneSaveClient({ auto: false });
    const repo = new DocumentRepository(db);
    const service = new PersistenceService(repo, client);
    const has = vi.spyOn(repo, 'has');
    const identical = vi.spyOn(repo, 'findIdentical');
    const remember = vi.spyOn(service, 'rememberSession');
    editorStore.openDocument(large(5), 'pLarge.gb');
    const flush = service.autosave({ urgent: true });
    // Before anything has been awaited: a reload now must still find the tab.
    expect(remember).toHaveBeenCalled();
    await flush;
    expect(has).not.toHaveBeenCalled();
    expect(identical).not.toHaveBeenCalled();
    expect(await storedText(db, activeId())).toBe(writeGenBank(editorStore.document ?? small));
  });

  it('keeps the last edit of a tab closed while its save waits on the worker', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient({ auto: false });
    const service = new PersistenceService(new DocumentRepository(db), client);
    editorStore.openDocument(large(5), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'delete', range: { start: 10, end: 20 } });
    const last = editorStore.document;
    const saving = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.closeDocument(id);
    workers[0]?.release();
    await saving;
    expect(await storedText(db, id)).toBe(writeGenBank(last ?? small));
    // The next autosave, with the tab gone, leaves it as it is.
    await service.autosave();
    expect(await storedText(db, id)).toBe(writeGenBank(last ?? small));
  });

  it('writes both tabs’ latest states when the user switches tabs and edits while a save is out', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient({ auto: false });
    const service = new PersistenceService(new DocumentRepository(db), client);
    const a = editorStore.openDocument(large(6, 'pA'), 'pA.gb');
    const b = editorStore.openDocument(large(7, 'pB'), 'pB.gb');
    editorStore.activateDocument(a);
    editorStore.apply({ type: 'insert', position: 3, text: 'G' });
    const saving = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.activateDocument(b);
    editorStore.apply({ type: 'insert', position: 3, text: 'T' });
    editorStore.activateDocument(a);
    editorStore.apply({ type: 'insert', position: 3, text: 'C' });
    const next = service.autosave();
    // Answer every request as it comes, in order, until both saves are done.
    const pump = setInterval(() => workers[0]?.release(), 1);
    try {
      await saving;
      await next;
    } finally {
      clearInterval(pump);
    }
    const docs = editorStore.getState().documents;
    for (const d of docs) {
      expect(await storedText(db, d.documentId)).toBe(writeGenBank(d.history.present));
    }
  });

  it('still saves when the worker dies with the save out', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient({ auto: false });
    const service = new PersistenceService(new DocumentRepository(db), client);
    editorStore.openDocument(large(8), 'pLarge.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const saving = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    workers[0]?.fail();
    await saving;
    expect(await storedText(db, activeId())).toBe(writeGenBank(editorStore.document ?? small));
  });
});

/** A `settle` the test opens by hand: each call waits until `open()`. */
function heldSettle(): { settle: () => Promise<void>; waiting: () => number; open: () => void } {
  const gates: (() => void)[] = [];
  return {
    settle: () =>
      new Promise<void>((resolve) => {
        gates.push(resolve);
      }),
    waiting: () => gates.length,
    open: () => {
      for (const resolve of gates.splice(0)) resolve();
    },
  };
}

describe('the autosave waits for the input to be quiet (#278)', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    editorStore.closeAllDocuments();
  });

  it('before it asks the worker for the text, and again before the put', async () => {
    const db = freshDb();
    const { client, workers } = cloneSaveClient();
    const quiet = heldSettle();
    const service = new PersistenceService(new DocumentRepository(db), client, quiet.settle);
    editorStore.openDocument(large(9), 'pLarge.gb');
    const saving = service.autosave();
    await vi.waitFor(() => {
      expect(quiet.waiting()).toBe(1);
    });
    expect(workers[0]?.received ?? []).toHaveLength(0);
    quiet.open();
    await vi.waitFor(() => {
      expect(quiet.waiting()).toBe(1);
    });
    expect(workers[0]?.received).toHaveLength(1);
    expect(await db.documents.count()).toBe(0);
    quiet.open();
    await saving;
    expect(await storedText(db, activeId())).toBe(writeGenBank(editorStore.document ?? small));
  });

  it('is not waited for by the flush on leaving, and a save still waiting then writes nothing', async () => {
    for (const heldAt of [1, 2]) {
      const db = freshDb();
      const { client } = cloneSaveClient();
      const quiet = heldSettle();
      const repo = new DocumentRepository(db);
      const service = new PersistenceService(repo, client, quiet.settle);
      const write = vi.spyOn(repo, 'write');
      editorStore.openDocument(large(10 + heldAt), 'pLarge.gb');
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
      const older = service.autosave();
      // Held before the request to the worker, or before the put.
      for (let gate = 1; gate <= heldAt; gate++) {
        await vi.waitFor(() => {
          expect(quiet.waiting()).toBe(1);
        });
        if (gate < heldAt) quiet.open();
      }
      editorStore.apply({ type: 'insert', position: 0, text: 'T' });
      const latest = editorStore.document;
      await service.autosave({ urgent: true });
      expect(quiet.waiting()).toBe(1);
      expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
      quiet.open();
      await older;
      expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
      const results = await Promise.all(write.mock.results.map((r) => r.value as Promise<boolean>));
      expect(results).toEqual([true]);
      const row = await db.histories.get(activeId());
      expect(decodeHistory(row, null)?.history.present.sequence.toString()).toBe(
        latest?.sequence.toString(),
      );
      editorStore.closeAllDocuments();
    }
  });

  it('loses no edit made while a save waits: the next save writes it', async () => {
    const db = freshDb();
    const { client } = cloneSaveClient();
    const quiet = heldSettle();
    const service = new PersistenceService(new DocumentRepository(db), client, quiet.settle);
    editorStore.openDocument(large(13), 'pLarge.gb');
    const first = service.autosave();
    await vi.waitFor(() => {
      expect(quiet.waiting()).toBe(1);
    });
    editorStore.apply({ type: 'delete', range: { start: 5, end: 50 } });
    const latest = editorStore.document;
    const second = service.autosave();
    const pump = setInterval(quiet.open, 1);
    try {
      await Promise.all([first, second]);
    } finally {
      clearInterval(pump);
    }
    expect(await storedText(db, activeId())).toBe(writeGenBank(latest ?? small));
  });
});

describe('useFlushOnLeave (#272)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flushes urgently when the page is hidden or left', () => {
    const autosave = vi.spyOn(persistence, 'autosave').mockResolvedValue(undefined);
    vi.spyOn(persistence, 'saveShelf').mockResolvedValue(undefined);
    const restored = persistence.restoreAttempted;
    persistence.restoreAttempted = true;
    const { unmount } = renderHook(() => {
      useFlushOnLeave();
    });
    try {
      window.dispatchEvent(new Event('pagehide'));
      expect(autosave).toHaveBeenLastCalledWith({ urgent: true });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(autosave).toHaveBeenCalledTimes(2);
      expect(autosave).toHaveBeenLastCalledWith({ urgent: true });
    } finally {
      unmount();
      persistence.restoreAttempted = restored;
    }
  });
});
