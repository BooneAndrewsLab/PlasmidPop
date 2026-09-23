// @vitest-environment jsdom
import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';
import { PlasmidPopDb, DocumentRepository } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService, downloadNameFor } from './persistence';

const doc = SeqDocument.create({ name: 'pKeep', sequence: 'ACGTACGTAC', topology: 'circular' });

describe('PersistenceService', () => {
  const repo = new DocumentRepository(new PlasmidPopDb(`svc-${Date.now()}`));
  const service = new PersistenceService(repo);

  it('autosaves the open document, lists it, and restores it after close', async () => {
    editorStore.openDocument(doc, 'pKeep.gb');
    const id = editorStore.getState().documentId;
    await service.autosave();
    expect((await service.listStored()).map((d) => d.name)).toEqual(['pKeep']);
    editorStore.closeDocument();
    expect(await service.restoreLastSession()).toBe(true);
    expect(editorStore.document?.name).toBe('pKeep');
    expect(editorStore.getState()).toMatchObject({
      documentId: id,
      fileName: 'pKeep.gb',
      dirty: false,
    });
  });

  it('reuses the stored entry when an identical document is opened again', async () => {
    const first = editorStore.getState().documentId;
    // Open in a tab already: the same file goes to that tab.
    expect(editorStore.openDocument(doc, 'pKeep.gb')).toBe(first);
    editorStore.closeDocument();
    editorStore.openDocument(doc, 'pKeep.gb');
    const second = editorStore.getState().documentId ?? '';
    expect(second).not.toBe(first);
    await service.autosave();
    expect(editorStore.getState().documentId).toBe(first);
    expect((await service.listStored()).map((d) => d.id)).toEqual([first]);

    // A different document (edited, or without a file name) gets its own entry.
    editorStore.openDocument(doc, null);
    expect(editorStore.getState().documents).toHaveLength(2);
    await service.autosave();
    expect((await service.listStored()).length).toBe(2);
    await service.removeStored(editorStore.getState().documentId ?? '');
    // Removing closed its tab; the first entry is in front again for the next test.
    expect(editorStore.getState().documentId).toBe(first);
    await service.autosave();
    expect((await service.listStored()).map((d) => d.id)).toEqual([first]);
  });

  it('restores every tab in order, with the one that was in front, or the file list', async () => {
    const first = editorStore.getState().documentId ?? '';
    const second = editorStore.openDocument(
      SeqDocument.create({ name: 'pSecond', sequence: 'GGCC' }),
      'pSecond.gb',
    );
    const third = editorStore.openDocument(
      SeqDocument.create({ name: 'pThird', sequence: 'TTAA' }),
      'pThird.gb',
    );
    editorStore.activateDocument(second);
    await service.autosave();
    editorStore.closeAllDocuments();
    expect(await service.restoreLastSession()).toBe(true);
    expect(editorStore.getState().documents.map((d) => d.documentId)).toEqual([
      first,
      second,
      third,
    ]);
    expect(editorStore.getState().documentId).toBe(second);
    // A missing document is skipped; the file list comes back as the file list.
    editorStore.showFiles();
    await service.autosave();
    await repo.remove(third);
    editorStore.closeAllDocuments();
    expect(await service.restoreLastSession()).toBe(true);
    expect(editorStore.getState().documents.map((d) => d.documentId)).toEqual([first, second]);
    expect(editorStore.document).toBeNull();
    editorStore.closeDocument(second);
    await repo.remove(second);
    editorStore.activateDocument(first);
    await service.autosave();
  });

  it('renames an open background tab through its history', async () => {
    const first = editorStore.getState().documentId ?? '';
    const other = editorStore.openDocument(
      SeqDocument.create({ name: 'pOther', sequence: 'GG' }),
      'pOther.gb',
    );
    await service.renameStored(first, 'pKeep renamed');
    expect(editorStore.document?.name).toBe('pOther');
    expect(editorStore.documentState(first)?.history.present.name).toBe('pKeep renamed');
    editorStore.undo(); // the front tab has nothing to undo
    editorStore.activateDocument(first);
    editorStore.undo();
    // That rename made the tab a working copy under the name it was given,
    // which is the copy's first state: there is nothing behind it.
    expect(editorStore.document?.name).toBe('pKeep renamed');
    await service.autosave();
    expect((await service.listStored()).map((d) => d.id).sort()).toEqual([first, other].sort());
    editorStore.closeDocument(other);
    await service.removeStored(other);
  });

  it('renames stored documents, through the store when they are open', async () => {
    const id = editorStore.getState().documentId ?? '';
    await service.renameStored(id, 'pKeep open');
    expect(editorStore.document?.name).toBe('pKeep open');
    expect(editorStore.getState().history?.undoLabel).toBe('Rename');
    editorStore.undo();
    await service.autosave();

    editorStore.closeDocument();
    await service.renameStored(id, 'pKeep stored');
    expect((await service.listStored()).map((d) => d.name)).toEqual(['pKeep stored']);
    await service.renameStored('missing', 'x');
    expect(editorStore.getState().error).toMatch(/no longer/);
    editorStore.dismissError();
    await service.openStored(id);
    expect(editorStore.document?.name).toBe('pKeep stored');
  });

  it('removes stored documents and closes them if open', async () => {
    const id = editorStore.getState().documentId ?? '';
    await service.removeStored(id);
    expect(editorStore.document).toBeNull();
    expect(await service.listStored()).toEqual([]);
    expect(await service.restoreLastSession()).toBe(false);
  });

  it('does not store a new document until something is typed into it', async () => {
    editorStore.newDocument();
    await service.autosave();
    expect(await service.listStored()).toEqual([]);
    editorStore.apply({ type: 'insert', position: 0, text: 'ACGT' });
    await service.autosave();
    expect((await service.listStored()).map((d) => [d.name, d.length])).toEqual([['Untitled', 4]]);
    // Emptying a stored document keeps its entry.
    editorStore.apply({ type: 'delete', range: { start: 0, end: 4 } });
    await service.autosave();
    expect((await service.listStored()).map((d) => d.length)).toEqual([0]);
    await service.removeStored(editorStore.getState().documentId ?? '');
    expect(await service.listStored()).toEqual([]);
  });

  it('falls back to a download when the picker API is missing', async () => {
    editorStore.openDocument(doc.insert(0, 'GG'), null);
    expect(editorStore.getState().dirty).toBe(true);
    const created: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this);
    });
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await service.download();
    expect(created[0]?.download).toBe('pKeep.gb');
    expect(editorStore.getState()).toMatchObject({ dirty: false, fileName: 'pKeep.gb' });
    // The browser owns the file now, which the notice under the toolbar says.
    expect(editorStore.getState().downloadNotice).toEqual({ fileName: 'pKeep.gb' });
    clickSpy.mockRestore();
    urlSpy.mockRestore();
  });

  it('offers the name a document was last written under, but never the original', () => {
    const state = (fileName: string | null, originName: string | null = null) => ({
      history: { present: doc },
      fileName,
      origin: originName === null ? null : { fileName: originName },
    });
    // Nothing written yet: a name made from the document's own.
    expect(downloadNameFor(state(null))).toBe('pKeep.gb');
    // The file it came from is the one name never to offer back.
    expect(downloadNameFor(state('pOther.gb', 'pOther.gb'))).toBe('pKeep.gb');
    // Written before: the same file, so replacing it is one click.
    expect(downloadNameFor(state('my construct.gbk'))).toBe('my construct.gbk');
    // Read from something we cannot write: GenBank under the document's name.
    expect(downloadNameFor(state('pKeep.dna'))).toBe('pKeep.gb');
    expect(downloadNameFor(state('pKeep.fasta'))).toBe('pKeep.gb');
  });

  it('writes an unedited document straight out and reviews a working copy first', async () => {
    editorStore.closeAllDocuments();
    const created: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      created.push(this);
    });
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    editorStore.openDocument(doc, 'pKeep.gb');
    // Nothing has been changed, so there is nothing to review: it goes out.
    await service.download();
    expect(created.map((a) => a.download)).toEqual(['pKeep.gb']);

    // An edit makes it a working copy, and the review comes first.
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    await service.download();
    expect(created).toHaveLength(1);
    expect(editorStore.getState().saveReview).toEqual({ fileName: 'pKeep.gb' });
    // Dismissing writes nothing.
    editorStore.dismissSaveReview();
    expect(created).toHaveLength(1);
    // Accepting writes it under a name of its own, not the original's.
    await service.download();
    await service.confirmSaveReview();
    expect(created.map((a) => a.download)).toEqual(['pKeep.gb', 'pKeep_copy.gb']);
    expect(editorStore.getState()).toMatchObject({ dirty: false, fileName: 'pKeep_copy.gb' });
    // Every download is reviewed: the copy is still a copy of that file.
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    await service.download();
    expect(editorStore.getState().saveReview).toEqual({ fileName: 'pKeep.gb' });
    await service.confirmSaveReview();
    // ...and it offers the name it was written under before, so the same
    // file can be replaced rather than another one made beside it.
    expect(created.map((a) => a.download)).toEqual(['pKeep.gb', 'pKeep_copy.gb', 'pKeep_copy.gb']);

    clickSpy.mockRestore();
    urlSpy.mockRestore();
    editorStore.closeDocument();
  });

  it('writes through the save dialog where there is one, keeping no handle', async () => {
    editorStore.closeAllDocuments();
    const writes: string[] = [];
    const suggested: (string | undefined)[] = [];
    const handle = {
      kind: 'file',
      name: 'pOwn_copy.gb',
      createWritable: () =>
        Promise.resolve({
          write: (t: string) => {
            writes.push(t);
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    } as unknown as FileSystemFileHandle;
    const w = window as unknown as Record<string, unknown>;
    w['showOpenFilePicker'] = () => Promise.resolve([]);
    w['showSaveFilePicker'] = (o?: { suggestedName?: string }) => {
      suggested.push(o?.suggestedName);
      return Promise.resolve(handle);
    };

    editorStore.openDocument(
      SeqDocument.create({ name: 'pOwn', sequence: 'ACGTACGTAC' }),
      'pOwn.gb',
    );
    const id = editorStore.getState().documentId ?? '';
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    await service.download();
    await service.confirmSaveReview();
    expect(suggested).toEqual(['pOwn_copy.gb']);
    // A LOCUS name holds no spaces, so the copy's comes back underscored.
    expect(parseGenBank(writes[0] ?? '').documents[0]?.name).toBe('pOwn_copy');
    expect(editorStore.getState().fileName).toBe('pOwn_copy.gb');

    // The handle is not kept anywhere: a reload cannot write through it, and
    // the next download asks again — with that file's name filled in.
    await service.autosave();
    editorStore.closeAllDocuments();
    await service.openStored(id);
    expect(editorStore.getState()).toMatchObject({ derived: true, fileName: 'pOwn_copy.gb' });
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    await service.download();
    await service.confirmSaveReview();
    expect(suggested).toEqual(['pOwn_copy.gb', 'pOwn_copy.gb']);
    expect(writes).toHaveLength(2);
    expect(parseGenBank(writes[1] ?? '').documents[0]?.sequence.toString()).toBe('CAACGTACGTAC');

    delete w['showOpenFilePicker'];
    delete w['showSaveFilePicker'];
    editorStore.closeDocument();
  });

  it('brings a working copy back as a working copy after a reload', async () => {
    editorStore.closeAllDocuments();
    const forked = SeqDocument.create({ name: 'pFork', sequence: 'ACGTACGTAC' });
    editorStore.openDocument(forked, 'pFork.gb');
    const id = editorStore.getState().documentId ?? '';
    editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    await service.autosave();
    editorStore.closeDocument();
    await service.openStored(id);
    expect(editorStore.getState()).toMatchObject({ derived: true });
    expect(editorStore.document?.name).toBe('pFork copy');
    const origin = editorStore.getState().origin;
    expect(origin?.fileName).toBe('pFork.gb');
    // The original itself comes back, not just its name, so the copy can
    // still be compared against it.
    expect(origin?.doc.sequence.toString()).toBe(forked.sequence.toString());
    expect(origin?.doc.name).toBe('pFork');
    editorStore.closeDocument();
  });
});

describe('PersistenceService fragment shelf', () => {
  const blunt = { kind: 'blunt' as const, overhang: '', enzyme: null };
  const frag = (source: string) => ({
    sequence: 'ACGTACGT',
    features: [],
    range: { start: 0, end: 8 },
    left: blunt,
    right: blunt,
    source,
  });

  it('keeps the shelf across a reload, with every tab closed', async () => {
    const repo = new DocumentRepository(new PlasmidPopDb(`shelf-${Date.now()}`));
    const service = new PersistenceService(repo);
    editorStore.clearShelf();
    editorStore.addToShelf(frag('vector'));
    editorStore.addToShelf(frag('insert'));
    await service.saveShelf();

    // A fresh page: nothing open, nothing on the shelf.
    editorStore.clearShelf();
    editorStore.closeDocument();
    const next = new PersistenceService(repo);
    await next.restoreLastSession();
    expect(editorStore.getState().shelf.map((p) => p.fragment.source)).toEqual([
      'vector',
      'insert',
    ]);

    // Assembling or clearing empties the stored shelf too.
    editorStore.clearShelf();
    await next.saveShelf();
    expect(await repo.loadShelf()).toEqual([]);
  });
});

describe('PersistenceService persistent storage', () => {
  /** A browser with a storage manager and a permission state of the test's choosing. */
  function browser(state: PermissionState | null, persisted = false) {
    const persist = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: () => Promise.resolve(persisted), persist },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value:
        state === null
          ? undefined
          : { query: () => Promise.resolve({ state } as PermissionStatus) },
    });
    return persist;
  }

  async function firstWrite(): Promise<void> {
    const repo = new DocumentRepository(new PlasmidPopDb(`persist-${Date.now()}-${Math.random()}`));
    const service = new PersistenceService(repo);
    editorStore.openDocument(
      SeqDocument.create({ name: 'pStore', sequence: 'ACGTACGT' }),
      'pStore.gb',
    );
    await service.autosave();
    await new Promise((r) => setTimeout(r, 0));
    editorStore.closeDocument();
  }

  beforeEach(() => {
    globalThis.localStorage.clear();
    editorStore.dismissStorageNotice();
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage');
    Reflect.deleteProperty(navigator, 'permissions');
  });

  it('puts up the banner instead of asking when the browser would ask the user', async () => {
    const persist = browser('prompt');
    await firstWrite();
    expect(editorStore.getState().storageNotice).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks silently where the browser decides for itself or cannot say', async () => {
    for (const state of ['granted', 'denied', null] as const) {
      const persist = browser(state);
      await firstWrite();
      expect(editorStore.getState().storageNotice).toBe(false);
      expect(persist).toHaveBeenCalledTimes(1);
    }
  });

  it('never asks again after a no, and asks silently each session after a keep', async () => {
    globalThis.localStorage.setItem('plasmidpop.storageChoice', 'no');
    let persist = browser('prompt');
    await firstWrite();
    expect(editorStore.getState().storageNotice).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    globalThis.localStorage.setItem('plasmidpop.storageChoice', 'keep');
    persist = browser('prompt');
    await firstWrite();
    expect(editorStore.getState().storageNotice).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all once the storage is already kept', async () => {
    const persist = browser('prompt', true);
    await firstWrite();
    expect(editorStore.getState().storageNotice).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('keepStorage reports the answer the browser gives', async () => {
    browser('prompt');
    expect(await new PersistenceService().keepStorage()).toBe(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) },
    });
    expect(await new PersistenceService().keepStorage()).toBe(false);
  });
});
