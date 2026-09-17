import { type SeqDocument } from '@/core';
import { writeGenBank } from '@/io';
import {
  type DocumentRepository,
  ensureWritePermission,
  getRepository,
  pickOpenFile,
  pickSaveFile,
  supportsFileSystemAccess,
  writeTextToHandle,
} from '@/storage';

import { downloadText, fileNameFor } from '../saveFile';
import { editorStore } from './editorStore';

/**
 * Everything that touches disk or IndexedDB, kept out of the store so the
 * store stays synchronous and testable.
 */
export class PersistenceService {
  constructor(private readonly repo: DocumentRepository = getRepository()) {}

  /** Writes the present document to IndexedDB (called debounced by useAutosave). */
  async autosave(): Promise<void> {
    const { history, documentId, fileName } = editorStore.getState();
    if (history === null || documentId === null) return;
    await this.repo.save(documentId, history.present, fileName);
    this.repo.setLastDocumentId(documentId);
  }

  /** Reopens the document that was open when the page was last closed. */
  async restoreLastSession(): Promise<boolean> {
    const id = this.repo.lastDocumentId();
    if (id === null) return false;
    const stored = await this.repo.load(id);
    if (stored === null) return false;
    const handle = await this.repo.loadHandle(id);
    editorStore.openDocument(stored.doc, stored.fileName, [], { id, handle });
    return true;
  }

  async openStored(id: string): Promise<void> {
    const stored = await this.repo.load(id);
    if (stored === null) {
      editorStore.fail('That document is no longer in local storage.');
      return;
    }
    const handle = await this.repo.loadHandle(id);
    editorStore.openDocument(stored.doc, stored.fileName, [], { id, handle });
    this.repo.setLastDocumentId(id);
  }

  async removeStored(id: string): Promise<void> {
    await this.repo.remove(id);
    if (editorStore.getState().documentId === id) editorStore.closeDocument();
  }

  listStored() {
    return this.repo.list();
  }

  /**
   * Opens a file with the native picker when available (so Save can write
   * back to it), returning false when the caller should fall back to an
   * <input type="file">.
   */
  async openWithPicker(parse: (file: File) => Promise<void>): Promise<boolean> {
    if (!supportsFileSystemAccess()) return false;
    const picked = await pickOpenFile();
    if (picked === null) return true; // cancelled
    await parse(picked.file);
    const { documentId } = editorStore.getState();
    if (documentId !== null) {
      editorStore.setFileHandle(picked.handle);
      await this.repo.saveHandle(documentId, picked.handle);
    }
    return true;
  }

  /**
   * Saves as GenBank: to the file the document came from when we hold a
   * handle to it (and it is a GenBank file), otherwise like Save as.
   */
  async save(): Promise<void> {
    const { history, fileHandle, fileName } = editorStore.getState();
    if (history === null) return;
    const isGenBank = fileName === null || /\.(gb|gbk|genbank|gbff|ape)$/i.test(fileName);
    if (fileHandle !== null && isGenBank) {
      if (!(await ensureWritePermission(fileHandle))) {
        editorStore.fail('Permission to write the file was not granted.');
        return;
      }
      await writeTextToHandle(fileHandle, writeGenBank(history.present));
      editorStore.markSaved();
      return;
    }
    await this.saveAs();
  }

  async saveAs(): Promise<void> {
    const { history, documentId } = editorStore.getState();
    if (history === null) return;
    const doc: SeqDocument = history.present;
    const suggested = fileNameFor(doc, 'genbank');
    if (!supportsFileSystemAccess()) {
      downloadText(suggested, writeGenBank(doc));
      editorStore.markSaved(suggested);
      return;
    }
    const handle = await pickSaveFile(suggested);
    if (handle === null) return;
    await writeTextToHandle(handle, writeGenBank(doc));
    editorStore.setFileHandle(handle);
    editorStore.markSaved(handle.name);
    if (documentId !== null) await this.repo.saveHandle(documentId, handle);
  }
}

export const persistence = new PersistenceService();
