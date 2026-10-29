// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { writeGenBank } from '@/io';
import { DocumentRepository, PlasmidPopDb, decodeHistory } from '@/storage';
import { randomDna, seededRandom } from '@/test/random';
import { cloneSaveClient } from '@/test/saveWorker';

import { DocumentTabs } from '../components/DocumentTabs';
import { FileMenu } from '../components/FileMenu';
import { editorStore } from './editorStore';
import { PersistenceService, persistence } from './persistence';
import { useSaveOnClose } from './usePersistence';
import { useViewShortcuts } from './useViewShortcuts';

/**
 * Closing a tab writes its latest state (#280), whichever way it closes,
 * also while a save of an older state of it is waiting for quiet (#278) or
 * out at the worker or the put (#272), and no older state lands after it.
 */

let counter = 0;

function freshDb(): PlasmidPopDb {
  return new PlasmidPopDb(`save-on-close-${Date.now()}-${counter++}`);
}

function large(seed: number, name = 'pLarge'): SeqDocument {
  const length = 60_000;
  return SeqDocument.create({
    name,
    sequence: randomDna(seededRandom(seed), length),
    topology: 'circular',
    features: [
      createFeature({ id: 'cds', type: 'CDS', name: 'bla', segments: [rangeSegment(100, 961)] }),
    ],
  });
}

function small(name = 'pSmall'): SeqDocument {
  return SeqDocument.create({ name, sequence: 'ACGTACGTACGTACGTACGT', topology: 'linear' });
}

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

function storedText(db: PlasmidPopDb, id: string): Promise<string | undefined> {
  return db.documents.get(id).then((r) => r?.text);
}

async function storedPresent(db: PlasmidPopDb, id: string): Promise<string | undefined> {
  return decodeHistory(await db.histories.get(id), null)?.history.present.sequence.toString();
}

function activeId(): string {
  const id = editorStore.getState().documentId;
  if (id === null) throw new Error('no document in front');
  return id;
}

function present(): SeqDocument {
  const d = editorStore.document;
  if (d === null) throw new Error('no document in front');
  return d;
}

/** A service listening for closes, and a way to wait for every save a close started. */
function setUp(options: { auto?: boolean; settle?: () => Promise<void> } = {}): ReturnType<
  typeof cloneSaveClient
> & {
  db: PlasmidPopDb;
  repo: DocumentRepository;
  service: PersistenceService;
  closes: () => Promise<void>;
} {
  const db = freshDb();
  const repo = new DocumentRepository(db);
  const saver = cloneSaveClient({ auto: options.auto ?? true });
  const service = new PersistenceService(
    repo,
    saver.client,
    options.settle ?? (() => Promise.resolve()),
  );
  const saveClosed = vi.spyOn(service, 'saveClosed');
  stops.push(service.saveOnClose());
  const closes = async (): Promise<void> => {
    await Promise.all(saveClosed.mock.results.map((r) => r.value as Promise<void>));
  };
  pending.push(closes);
  return { ...saver, db, repo, service, closes };
}

/** Whether each `write` call wrote, in the order they were made. */
async function writes(write: { mock: { results: { value: unknown }[] } }): Promise<boolean[]> {
  return Promise.all(write.mock.results.map((r) => r.value as Promise<boolean>));
}

const stops: (() => void)[] = [];
const pending: (() => Promise<void>)[] = [];

afterEach(async () => {
  // Every close's save is finished before the next test, and nothing listens after it.
  for (const wait of pending.splice(0)) await wait();
  for (const stop of stops.splice(0)) stop();
  act(() => {
    editorStore.closeAllDocuments();
  });
  vi.restoreAllMocks();
});

describe('closing a tab saves it (#280)', () => {
  it('writes an edit no autosave has written yet', async () => {
    const { db, closes } = setUp();
    editorStore.openDocument(large(1), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 7, text: 'GATTACA' });
    const last = present();
    editorStore.closeDocument(id);
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(last));
    expect(await storedPresent(db, id)).toBe(last.sequence.toString());
  });

  it('writes nothing for a tab unchanged since it was stored, nor for an untouched new one', async () => {
    const { db, repo, service, closes } = setUp();
    editorStore.openDocument(small(), 'pSmall.gb');
    await service.autosave();
    const write = vi.spyOn(repo, 'write');
    editorStore.closeDocument();
    // A new document nobody typed into, closed, and one given up to an open.
    editorStore.openDocument(SeqDocument.create({ name: 'Untitled', sequence: '' }));
    editorStore.closeDocument();
    editorStore.openDocument(SeqDocument.create({ name: 'Untitled', sequence: '' }));
    editorStore.openDocument(small('pOther'), 'pOther.gb');
    await closes();
    expect(write).not.toHaveBeenCalled();
    expect((await db.documents.toArray()).map((r) => r.name)).toEqual(['pSmall']);
  });

  it('writes nothing for a document reopened from the recent list and closed unchanged', async () => {
    const { repo, service, closes } = setUp();
    editorStore.openDocument(small(), 'pSmall.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    await service.autosave();
    editorStore.closeDocument();
    await closes();
    await service.openStored(id);
    // Its undo history is rebuilt a task later, which changes nothing stored.
    await vi.waitFor(() => {
      expect(editorStore.getState().history?.canUndo).toBe(true);
    });
    const write = vi.spyOn(repo, 'write');
    await service.autosave();
    editorStore.closeDocument();
    await closes();
    expect(write).not.toHaveBeenCalled();
  });

  it('stores a new document typed into and closed before its first save', async () => {
    const { db, closes } = setUp();
    editorStore.openDocument(SeqDocument.create({ name: 'Untitled', sequence: '' }));
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'ACGT' });
    editorStore.closeDocument();
    await closes();
    expect(await storedPresent(db, id)).toBe('ACGT');
  });

  it('reuses an identical stored entry rather than add a second one', async () => {
    const { db, service, closes } = setUp();
    editorStore.openDocument(small(), 'pSmall.gb');
    const first = activeId();
    await service.autosave();
    editorStore.closeDocument();
    // The same file opened again and closed before its first autosave.
    editorStore.openDocument(small(), 'pSmall.gb');
    expect(activeId()).not.toBe(first);
    editorStore.closeDocument();
    await closes();
    expect((await db.documents.toArray()).map((r) => r.id)).toEqual([first]);
  });

  it('writes every tab closed at once', async () => {
    const { db, closes } = setUp();
    const a = editorStore.openDocument(small('pA'), 'pA.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    const b = editorStore.openDocument(small('pB'), 'pB.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    const states = editorStore.getState().documents.map((d) => d.history.present);
    editorStore.closeAllDocuments();
    await closes();
    expect(await storedText(db, a)).toBe(writeGenBank(states[0] ?? small()));
    expect(await storedText(db, b)).toBe(writeGenBank(states[1] ?? small()));
  });

  it('does not write a removed document back, closed by the removal or just before it', async () => {
    const { db, service, closes } = setUp();
    editorStore.openDocument(small('pA'), 'pA.gb');
    const a = activeId();
    await service.autosave();
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    await service.removeStored(a);
    editorStore.openDocument(large(2, 'pB'), 'pB.gb');
    const b = activeId();
    await service.autosave();
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    // Closed, its save on its way to the worker, and removed from the list.
    editorStore.closeDocument(b);
    await service.removeStored(b);
    await closes();
    expect(await db.documents.count()).toBe(0);
    expect(await db.histories.count()).toBe(0);
  });
});

describe('closing a tab while a save of an older state is out (#280, #272, #278)', () => {
  for (const heldAt of [1, 2] as const) {
    it(`writes the closed state over a save waiting for quiet ${heldAt === 1 ? 'before the worker' : 'before the put'}`, async () => {
      const quiet = heldSettle();
      const { db, repo, service, closes } = setUp({ settle: quiet.settle });
      const write = vi.spyOn(repo, 'write');
      editorStore.openDocument(large(10 + heldAt), 'pLarge.gb');
      const id = activeId();
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
      const older = service.autosave();
      for (let gate = 1; gate <= heldAt; gate++) {
        await vi.waitFor(() => {
          expect(quiet.waiting()).toBe(1);
        });
        if (gate < heldAt) quiet.open();
      }
      editorStore.apply({ type: 'insert', position: 0, text: 'T' });
      const latest = present();
      editorStore.closeDocument(id);
      // The close does not wait for quiet.
      await closes();
      expect(quiet.waiting()).toBe(1);
      expect(await storedText(db, id)).toBe(writeGenBank(latest));
      quiet.open();
      await older;
      expect(await storedText(db, id)).toBe(writeGenBank(latest));
      expect(await storedPresent(db, id)).toBe(latest.sequence.toString());
      expect(await writes(write)).toEqual([true]);
    });
  }

  it('writes the closed state over a save out at the worker, which then stands down', async () => {
    const { db, repo, service, workers, closes } = setUp({ auto: false });
    const write = vi.spyOn(repo, 'write');
    editorStore.openDocument(large(20), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const older = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    const latest = present();
    editorStore.closeDocument(id);
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(2);
    });
    // The older text comes back first, then the closed one.
    workers[0]?.release();
    await Promise.all([older, closes()]);
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    expect(await storedPresent(db, id)).toBe(latest.sequence.toString());
    expect((await writes(write)).filter(Boolean)).toHaveLength(1);
  });

  it('writes the closed state over a save held at the put, which then writes nothing', async () => {
    const { db, repo, service, closes } = setUp();
    const original = repo.write.bind(repo);
    let letGo: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    let calls = 0;
    const write = vi.spyOn(repo, 'write').mockImplementation(async (...args) => {
      // The older save's put is held just before its transaction.
      if (calls++ === 0) await gate;
      return original(...args);
    });
    editorStore.openDocument(large(21), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const older = service.autosave();
    await vi.waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    const latest = present();
    editorStore.closeDocument(id);
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    letGo();
    await older;
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    expect(await writes(write)).toEqual([false, true]);
  });

  it('writes the closed state once when a save of that same state is out', async () => {
    const { db, repo, service, workers, closes } = setUp({ auto: false });
    const write = vi.spyOn(repo, 'write');
    editorStore.openDocument(large(22), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const latest = present();
    const out = service.autosave();
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    editorStore.closeDocument(id);
    const pump = setInterval(() => workers[0]?.release(), 1);
    try {
      await Promise.all([out, closes()]);
    } finally {
      clearInterval(pump);
    }
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    expect((await writes(write)).filter(Boolean)).toHaveLength(1);
  });

  it('keeps the second of two quick edits, the first one’s save still waiting', async () => {
    const quiet = heldSettle();
    const { db, service, closes } = setUp({ settle: quiet.settle });
    editorStore.openDocument(large(23), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const first = service.autosave();
    await vi.waitFor(() => {
      expect(quiet.waiting()).toBe(1);
    });
    editorStore.apply({ type: 'delete', range: { start: 50, end: 90 } });
    // The debounced save of the second edit is queued behind the first.
    const second = service.autosave();
    const latest = present();
    editorStore.closeDocument(id);
    await closes();
    const pump = setInterval(quiet.open, 1);
    try {
      await Promise.all([first, second]);
    } finally {
      clearInterval(pump);
    }
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    expect(await storedPresent(db, id)).toBe(latest.sequence.toString());
  });

  it('is written by the flush on leaving when the page goes while the close is at the worker', async () => {
    const { db, service, workers, closes } = setUp({ auto: false });
    editorStore.openDocument(large(24), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    const latest = present();
    editorStore.closeDocument(id);
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    await service.autosave({ urgent: true });
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
    workers[0]?.release();
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
  });

  it('reopens the last edit from the recent list, even with the close’s save still out', async () => {
    const quiet = heldSettle();
    const { db, service, workers, closes } = setUp({ auto: false, settle: quiet.settle });
    editorStore.openDocument(large(25), 'pLarge.gb');
    const id = activeId();
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    const older = service.autosave();
    await vi.waitFor(() => {
      expect(quiet.waiting()).toBe(1);
    });
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    const latest = present();
    editorStore.closeDocument(id);
    await vi.waitFor(() => {
      expect(workers[0]?.held).toHaveLength(1);
    });
    const reopening = service.openStored(id);
    // It waits for the close's save, answered as the worker would.
    await Promise.resolve();
    expect(editorStore.getState().documents).toHaveLength(0);
    const answer = setInterval(() => workers[0]?.release(), 1);
    try {
      await reopening;
      await closes();
    } finally {
      clearInterval(answer);
    }
    expect(activeId()).toBe(id);
    expect(present().sequence.toString()).toBe(latest.sequence.toString());
    expect((await service.listStored()).map((d) => d.id)).toEqual([id]);
    quiet.open();
    const pump = setInterval(() => {
      quiet.open();
      workers[0]?.release();
    }, 1);
    try {
      await older;
    } finally {
      clearInterval(pump);
    }
    // The older save, let go at last, wrote nothing over it.
    expect(await storedPresent(db, id)).toBe(latest.sequence.toString());
    expect(await storedText(db, id)).toBe(writeGenBank(latest));
  });
});

describe('every way a tab closes saves it (#280)', () => {
  function edited(name: string): { id: string; last: SeqDocument } {
    act(() => {
      editorStore.openDocument(small(name), `${name}.gb`);
      editorStore.apply({ type: 'insert', position: 3, text: 'TTT' });
    });
    return { id: activeId(), last: present() };
  }

  it('the tab’s close button', async () => {
    const { db, closes } = setUp();
    const { id, last } = edited('pButton');
    render(<DocumentTabs />);
    fireEvent.click(screen.getByRole('button', { name: /^Close pButton/ }));
    expect(editorStore.getState().documents).toHaveLength(0);
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(last));
  });

  it('the shortcut (Alt+W)', async () => {
    const { db, closes } = setUp();
    const { id, last } = edited('pKey');
    renderHook(() => {
      useViewShortcuts();
    });
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyW', key: 'w', altKey: true });
    });
    expect(editorStore.getState().documents).toHaveLength(0);
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(last));
  });

  it('File → Close, with another tab left open', async () => {
    const { db, closes } = setUp();
    const stays = edited('pStays').id;
    const { id, last } = edited('pMenu');
    render(<FileMenu doc={last} onOpenFile={() => undefined} onCompare={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close' }));
    expect(editorStore.getState().documents.map((d) => d.documentId)).toEqual([stays]);
    await closes();
    expect(await storedText(db, id)).toBe(writeGenBank(last));
  });

  it('useSaveOnClose saves the app’s closes while mounted, and stops when unmounted', () => {
    const saveClosed = vi.spyOn(persistence, 'saveClosed').mockResolvedValue(undefined);
    const { unmount } = renderHook(() => {
      useSaveOnClose();
    });
    editorStore.openDocument(small('pHook'), 'pHook.gb');
    const tab = editorStore.documentState();
    editorStore.closeDocument();
    expect(saveClosed).toHaveBeenCalledWith([tab]);
    unmount();
    editorStore.openDocument(small('pAfter'), 'pAfter.gb');
    editorStore.closeDocument();
    expect(saveClosed).toHaveBeenCalledTimes(1);
  });
});
