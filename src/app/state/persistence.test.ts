// @vitest-environment jsdom
import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';
import { PlasmidPopDb, DocumentRepository } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService } from './persistence';

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
    const handle = { kind: 'file', name: 'pKeep.gb' } as unknown as FileSystemFileHandle;
    editorStore.openDocument(doc, 'pKeep.gb', [], { handle });
    const second = editorStore.getState().documentId ?? '';
    expect(second).not.toBe(first);
    await repo.saveHandle(second, handle);
    await service.autosave();
    expect(editorStore.getState().documentId).toBe(first);
    expect((await service.listStored()).map((d) => d.id)).toEqual([first]);
    expect(await repo.loadHandle(first ?? '')).toMatchObject({ name: 'pKeep.gb' });
    expect(await repo.loadHandle(second)).toBeNull();

    // A different document (edited, or without a file name) gets its own entry.
    editorStore.openDocument(doc, null);
    await service.autosave();
    expect((await service.listStored()).length).toBe(2);
    await service.removeStored(editorStore.getState().documentId ?? '');
    // Leave the first entry open again for the next test.
    editorStore.openDocument(doc, 'pKeep.gb');
    await service.autosave();
    expect(editorStore.getState().documentId).toBe(first);
    expect((await service.listStored()).map((d) => d.id)).toEqual([first]);
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
    await service.save();
    expect(created[0]?.download).toBe('pKeep.gb');
    expect(editorStore.getState()).toMatchObject({ dirty: false, fileName: 'pKeep.gb' });
    clickSpy.mockRestore();
    urlSpy.mockRestore();
  });

  it('writes through a stored handle when the file is GenBank', async () => {
    let written = '';
    const handle = {
      name: 'pKeep.gb',
      createWritable: () =>
        Promise.resolve({
          write: (t: string) => {
            written = t;
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    } as unknown as FileSystemFileHandle;
    editorStore.openDocument(doc, 'pKeep.gb', [], { handle });
    editorStore.apply({ type: 'rename', name: 'pKeep2' });
    await service.save();
    expect(parseGenBank(written).documents[0]?.name).toBe('pKeep2');
    expect(editorStore.getState().dirty).toBe(false);
    editorStore.closeDocument();
  });
});
