// @vitest-environment jsdom
import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';
import { PlasmidPopDb, DocumentRepository } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService, writeBackTarget } from './persistence';

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
    await service.save();
    expect(created[0]?.download).toBe('pKeep.gb');
    expect(editorStore.getState()).toMatchObject({ dirty: false, fileName: 'pKeep.gb' });
    clickSpy.mockRestore();
    urlSpy.mockRestore();
  });

  it('names the write-back target only for GenBank files with a handle', () => {
    const handle = { name: 'pKeep.gb' } as unknown as FileSystemFileHandle;
    expect(writeBackTarget(null, 'pKeep.gb')).toBeNull();
    expect(writeBackTarget(handle, 'pKeep.gb')).toBe('pKeep.gb');
    expect(writeBackTarget(handle, 'pKeep.ape')).toBe('pKeep.gb');
    expect(writeBackTarget(handle, null)).toBe('pKeep.gb');
    expect(writeBackTarget(handle, 'pKeep.fasta')).toBeNull();
    expect(writeBackTarget(handle, 'pKeep.dna')).toBeNull();
  });

  it('asks before the first write-back into an opened file, then writes silently', async () => {
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
    // Real handles are structured-clonable; this mock (with a function on it) is
    // not, so store a plain stand-in under the same id as the picker would.
    const id = editorStore.getState().documentId ?? '';
    await repo.saveHandle(id, {
      kind: 'file',
      name: 'pKeep.gb',
    } as unknown as FileSystemFileHandle);
    editorStore.apply({ type: 'rename', name: 'pKeep2' });
    // Opened, never agreed to: Save raises the prompt instead of writing.
    await service.save();
    expect(written).toBe('');
    expect(editorStore.getState()).toMatchObject({
      dirty: true,
      overwritePrompt: { fileName: 'pKeep.gb' },
    });
    editorStore.dismissOverwrite();
    await service.save();
    expect(written).toBe('');
    // Agreeing writes and is remembered for the document.
    await service.confirmOverwrite();
    expect(editorStore.getState().overwritePrompt).toBeNull();
    expect(parseGenBank(written).documents[0]?.name).toBe('pKeep2');
    expect(editorStore.getState().dirty).toBe(false);
    editorStore.apply({ type: 'rename', name: 'pKeep3' });
    await service.save();
    expect(parseGenBank(written).documents[0]?.name).toBe('pKeep3');
    expect(editorStore.getState().overwritePrompt).toBeNull();
    // Still remembered after reopening from local storage.
    await service.autosave();
    editorStore.closeDocument();
    await service.openStored(id);
    expect(editorStore.getState().fileHandle).toMatchObject({ name: 'pKeep.gb' });
    editorStore.setFileHandle(handle); // the writable mock again, in place of the stand-in
    editorStore.apply({ type: 'rename', name: 'pKeep4' });
    await service.save();
    expect(parseGenBank(written).documents[0]?.name).toBe('pKeep4');
    editorStore.closeDocument();
  });
});
