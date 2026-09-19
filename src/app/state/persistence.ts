import { type AssemblyPart, type SeqDocument } from '@/core';
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
import { type DocumentState, editorStore } from './editorStore';

/**
 * Name of the file Save would overwrite in place, or null when Save will ask
 * where to write: we need a handle, and we only write GenBank back into a
 * file that was GenBank to begin with.
 */
export function writeBackTarget(
  fileHandle: FileSystemFileHandle | null,
  fileName: string | null,
): string | null {
  if (fileHandle === null) return null;
  const isGenBank = fileName === null || /\.(gb|gbk|genbank|gbff|ape)$/i.test(fileName);
  return isGenBank ? fileHandle.name : null;
}

/** What the last autosave wrote for a document, so an unchanged tab is not written again. */
interface Autosaved {
  readonly doc: SeqDocument;
  readonly fileName: string | null;
}

/**
 * Everything that touches disk or IndexedDB, kept out of the store so the
 * store stays synchronous and testable.
 */
export class PersistenceService {
  private readonly autosaved = new Map<string, Autosaved>();
  /** The shelf as last written, so an unchanged one is not written again. */
  private savedShelf: readonly AssemblyPart[] | null = null;
  /**
   * Whether `restoreLastSession` has run. Until it has, an empty tab strip
   * is the page still loading, not the user having closed everything, and
   * must not be written down as the session to come back to.
   */
  restoreAttempted = false;

  constructor(private readonly repo: DocumentRepository = getRepository()) {}

  /**
   * Writes every open document that changed since it was last written to
   * IndexedDB, and records which tabs are open (called debounced by
   * useAutosave). Going over all the tabs, not just the one in front, means
   * an edit followed at once by a switch to another tab is not lost. The
   * first save of a newly opened document reuses the entry of an identical
   * stored one, so reopening a file or the example does not pile up
   * duplicates in the recent list.
   */
  async autosave(): Promise<void> {
    const openIds = new Set(editorStore.getState().documents.map((d) => d.documentId));
    for (const id of this.autosaved.keys()) if (!openIds.has(id)) this.autosaved.delete(id);
    for (const d of editorStore.getState().documents) await this.autosaveDocument(d);
    this.rememberSession();
  }

  private async autosaveDocument(d: DocumentState): Promise<void> {
    const doc = d.history.present;
    const last = this.autosaved.get(d.documentId);
    if (last?.doc === doc && last.fileName === d.fileName) return;
    let id = d.documentId;
    if (!(await this.repo.has(id))) {
      // A new document nobody has typed into yet is not worth a recent-files entry.
      if (doc.length === 0 && doc.features.size === 0) return;
      const existing = await this.repo.findIdentical(doc, d.fileName);
      // Only merge into an entry that is not itself open in another tab.
      if (existing !== null && editorStore.documentState(existing) === null) {
        await this.repo.moveHandle(id, existing);
        // Bail if the tab was closed while we were looking.
        if (editorStore.documentState(id) === null) return;
        editorStore.setDocumentId(id, existing);
        this.autosaved.delete(id);
        id = existing;
      }
    }
    await this.repo.save(id, doc, d.fileName);
    this.autosaved.set(id, { doc, fileName: d.fileName });
  }

  /**
   * Writes the Cloning tab's assembly shelf, so fragments gathered for a
   * ligation are still there after a reload. It is kept apart from the
   * documents: the shelf outlives every tab being closed, which is the
   * point of it.
   */
  async saveShelf(): Promise<void> {
    const { assembly } = editorStore.getState();
    if (assembly === this.savedShelf) return;
    await this.repo.saveShelf(assembly);
    this.savedShelf = assembly;
  }

  /** Records which documents are open and which is in front, for `restoreLastSession`. */
  rememberSession(): void {
    const { documents, documentId } = editorStore.getState();
    this.repo.setOpenDocumentIds(documents.map((d) => d.documentId));
    this.repo.setLastDocumentId(documentId);
  }

  /**
   * Reopens the tabs that were open when the page was last closed, in the
   * same order and with the same one in front (or the file list, if that was
   * showing). Documents no longer in storage are skipped.
   */
  async restoreLastSession(): Promise<boolean> {
    try {
      const shelf = await this.repo.loadShelf();
      editorStore.restoreAssembly(shelf);
      this.savedShelf = editorStore.getState().assembly;
      const last = this.repo.lastDocumentId();
      const ids = [...this.repo.openDocumentIds()];
      if (last !== null && !ids.includes(last)) ids.push(last);
      const opened: string[] = [];
      for (const id of ids) {
        const stored = await this.repo.load(id);
        if (stored === null) continue;
        const handle = await this.repo.loadHandle(id);
        editorStore.openDocument(stored.doc, stored.fileName, [], { id, handle });
        this.autosaved.set(id, { doc: stored.doc, fileName: stored.fileName });
        opened.push(id);
      }
      if (opened.length === 0) return false;
      editorStore.activateDocument(last !== null && opened.includes(last) ? last : null);
      return true;
    } finally {
      this.restoreAttempted = true;
    }
  }

  /** Brings a stored document to the front, opening it in a new tab unless it already has one. */
  async openStored(id: string): Promise<void> {
    if (editorStore.documentState(id) !== null) {
      editorStore.activateDocument(id);
      return;
    }
    const stored = await this.repo.load(id);
    if (stored === null) {
      editorStore.fail('That document is no longer in local storage.');
      return;
    }
    const handle = await this.repo.loadHandle(id);
    editorStore.openDocument(stored.doc, stored.fileName, [], { id, handle });
    this.autosaved.set(id, { doc: stored.doc, fileName: stored.fileName });
    this.rememberSession();
  }

  async removeStored(id: string): Promise<void> {
    await this.repo.remove(id);
    this.autosaved.delete(id);
    editorStore.closeDocument(id);
  }

  /** Renames a stored document; an open one goes through the store so the change is undoable. */
  async renameStored(id: string, name: string): Promise<void> {
    if (editorStore.documentState(id) !== null) {
      editorStore.apply({ type: 'rename', name }, undefined, id);
      return;
    }
    if (!(await this.repo.rename(id, name))) {
      editorStore.fail('That document is no longer in local storage.');
    }
  }

  listStored() {
    return this.repo.list();
  }

  /**
   * Opens a file with the native picker when available (so Save can write
   * back to it), returning false when the caller should fall back to an
   * <input type="file">. `parse` returns the id of the document it opened,
   * or null when the file could not be read.
   */
  async openWithPicker(parse: (file: File) => Promise<string | null>): Promise<boolean> {
    if (!supportsFileSystemAccess()) return false;
    const picked = await pickOpenFile();
    if (picked === null) return true; // cancelled
    const documentId = await parse(picked.file);
    if (documentId !== null) {
      editorStore.setFileHandle(documentId, picked.handle);
      await this.repo.saveHandle(documentId, picked.handle);
    }
    return true;
  }

  /**
   * Saves the document in front as GenBank: to the file it came from when we
   * hold a handle to it (and it is a GenBank file), otherwise like Save as.
   * The first write-back into a file the user merely opened is not silent: a
   * browser overwriting a file on disk is unexpected, so the store raises a
   * prompt and the write waits for `confirmOverwrite`.
   */
  async save(): Promise<void> {
    const target = editorStore.documentState();
    if (target === null) return;
    const { documentId, fileHandle, fileName } = target;
    const name = writeBackTarget(fileHandle, fileName);
    if (fileHandle === null || name === null) {
      await this.saveAs();
      return;
    }
    if (!(await this.repo.isWriteConfirmed(documentId))) {
      editorStore.requestOverwrite(documentId, name);
      return;
    }
    await this.writeBack(documentId, fileHandle);
  }

  /** The user accepted the overwrite prompt: remember that for this file and write. */
  async confirmOverwrite(): Promise<void> {
    const target = editorStore.documentState();
    editorStore.dismissOverwrite();
    const fileHandle = target?.fileHandle ?? null;
    if (target === null || fileHandle === null) return;
    const { documentId } = target;
    if (await this.repo.loadHandle(documentId)) await this.repo.confirmWrite(documentId);
    else await this.repo.saveHandle(documentId, fileHandle, true);
    await this.writeBack(documentId, fileHandle);
  }

  /**
   * Writes a document to its file. The tab is named rather than taken from
   * the front, because the user may switch tabs while a permission prompt
   * or a picker is up.
   */
  private async writeBack(documentId: string, handle: FileSystemFileHandle): Promise<void> {
    const doc = editorStore.documentState(documentId)?.history.present;
    if (doc === undefined) return;
    if (!(await ensureWritePermission(handle))) {
      editorStore.fail('Permission to write the file was not granted.');
      return;
    }
    await writeTextToHandle(handle, writeGenBank(doc));
    editorStore.markSaved(documentId);
  }

  async saveAs(): Promise<void> {
    const target = editorStore.documentState();
    if (target === null) return;
    const { documentId } = target;
    const doc: SeqDocument = target.history.present;
    const suggested = fileNameFor(doc, 'genbank');
    if (!supportsFileSystemAccess()) {
      downloadText(suggested, writeGenBank(doc));
      editorStore.markSaved(documentId, suggested);
      return;
    }
    const handle = await pickSaveFile(suggested);
    if (handle === null) return;
    // The document as it is now, not as it was when the dialog opened.
    const current = editorStore.documentState(documentId)?.history.present;
    if (current === undefined) return; // the tab was closed while the dialog was up
    await writeTextToHandle(handle, writeGenBank(current));
    editorStore.setFileHandle(documentId, handle);
    editorStore.markSaved(documentId, handle.name);
    // Chosen in a save dialog, so overwriting it later needs no further prompt.
    await this.repo.saveHandle(documentId, handle, true);
  }
}

export const persistence = new PersistenceService();
