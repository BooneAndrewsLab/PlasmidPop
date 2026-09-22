import { type AssemblyPart, type EnzymeSet, type SeqDocument, BUNDLED_ENZYME_SET } from '@/core';
import { type RebaseSkipped, parseRebaseWithRefM, writeGenBank } from '@/io';
import {
  type DocumentRepository,
  getRepository,
  pickOpenFile,
  pickSaveFile,
  supportsFileSystemAccess,
  writeTextToHandle,
} from '@/storage';

import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { downloadText, fileNameFor } from '../saveFile';
import { type DocumentState, editorStore } from './editorStore';
import { storageChoice } from './storageChoice';

/** What an import turned out to hold, for the Enzymes tab to report. */
export interface RebaseImportSummary {
  readonly label: string;
  readonly count: number;
  readonly released: string | null;
  readonly skipped: RebaseSkipped;
}

/**
 * What a download is called before the user says otherwise: the name it was
 * last written under, so writing it again offers the same file, and
 * otherwise a name made from the document's own.
 *
 * A working copy's `fileName` is still the file it was read from at this
 * point, and that name is the one thing never to offer: the original is what
 * the copy exists to leave alone.
 */
export function downloadNameFor(d: {
  readonly history: { readonly present: SeqDocument };
  readonly fileName: string | null;
  readonly origin: { readonly fileName: string } | null;
}): string {
  const own = d.fileName;
  if (own === null || own === d.origin?.fileName) return fileNameFor(d.history.present, 'genbank');
  return /\.(gb|gbk|genbank|gbff|ape)$/i.test(own)
    ? own
    : fileNameFor(d.history.present, 'genbank');
}

/** What the last autosave wrote for a document, so an unchanged tab is not written again. */
interface Autosaved {
  readonly doc: SeqDocument;
  readonly fileName: string | null;
}

/**
 * Whether asking to keep storage is a question for the user rather than
 * for the browser. `prompt` is the only state that says so; `granted` and
 * `denied` are already decided, and a browser without the query (Safari)
 * has no dialog to warn about.
 */
async function wouldAskTheUser(): Promise<boolean> {
  const permissions = navigator.permissions as Permissions | undefined;
  if (permissions === undefined) return false;
  try {
    return (await permissions.query({ name: 'persistent-storage' })).state === 'prompt';
  } catch {
    return false;
  }
}

/**
 * Everything that touches disk or IndexedDB, kept out of the store so the
 * store stays synchronous and testable.
 */
export class PersistenceService {
  private readonly autosaved = new Map<string, Autosaved>();
  /** The shelf as last written, so an unchanged one is not written again. */
  private savedShelf: readonly AssemblyPart[] | null = null;
  /** Whether the browser has been asked to keep this origin's storage. */
  private persistenceRequested = false;
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

  /**
   * Asks the browser to keep this origin's storage instead of evicting it
   * when space runs short. Done once, when the first document is actually
   * written: there is something to protect by then, and the user is working
   * rather than staring at a freshly loaded page.
   *
   * Where the browser would put the question to the user (Firefox does;
   * Chromium answers `prompt` too but decides silently), it is not asked
   * straight away: the banner says what the question means and asks from a
   * click, so the browser's dialog follows something the user did. The
   * banner is shown once; after a `keep` the request is made silently each
   * session until granted, after a `no` never. A browser without the
   * Permissions API is simply asked, as before, and a no is fine either
   * way: storage then stays evictable as it was.
   */
  private async requestPersistentStorage(): Promise<void> {
    if (this.persistenceRequested) return;
    this.persistenceRequested = true;
    const storage = navigator.storage as StorageManager | undefined;
    try {
      if (storage === undefined || (await storage.persisted())) return;
      const choice = storageChoice();
      if (choice === 'no') return;
      if (choice === null && (await wouldAskTheUser())) {
        editorStore.noteStoragePrompt();
        return;
      }
      await storage.persist();
    } catch {
      // Not available (or refused): nothing to do about it either way.
    }
  }

  /**
   * The banner's own request, made from its button. Resolves to whether the
   * browser agreed, which is the one thing the banner has to report: a
   * refusal here is silent in Chromium and a closed dialog in Firefox, and
   * both leave the documents evictable.
   */
  async keepStorage(): Promise<boolean> {
    try {
      const storage = navigator.storage as StorageManager | undefined;
      if (storage === undefined) return false;
      return (await storage.persisted()) || (await storage.persist());
    } catch {
      return false;
    }
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
        // Bail if the tab was closed while we were looking.
        if (editorStore.documentState(id) === null) return;
        editorStore.setDocumentId(id, existing);
        this.autosaved.delete(id);
        id = existing;
      }
    }
    await this.repo.save(id, doc, d.fileName, { origin: d.origin, derived: d.derived });
    this.autosaved.set(id, { doc, fileName: d.fileName });
    void this.requestPersistentStorage();
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

  /**
   * Installs an enzyme set everywhere it is needed: the core's active set and
   * the worker (through the client), and the store so the Enzymes tab
   * re-renders and every document's stale cut sites are dropped.
   */
  private applyEnzymeSet(set: (EnzymeSet & { fileName: string | null }) | null): void {
    analysisClient.useEnzymes(set);
    editorStore.setEnzymeSetInfo(
      set === null
        ? {
            label: 'Bundled table',
            count: BUNDLED_ENZYME_SET.enzymes.length,
            bundled: true,
            fileName: null,
            suppliers: [],
          }
        : {
            label: set.label,
            count: set.enzymes.length,
            bundled: false,
            fileName: set.fileName,
            suppliers: set.suppliers,
          },
    );
  }

  /** Reads back an enzyme set imported in an earlier session, if there is one. */
  async restoreEnzymeSet(): Promise<void> {
    const stored = await this.repo.loadEnzymeSet();
    if (stored !== null) this.applyEnzymeSet(stored);
  }

  /**
   * Reads a REBASE `withrefm` file the user downloaded and makes it the
   * active set. The file itself is not kept, only the parsed enzymes, and
   * only in this browser: we have no right to redistribute REBASE data and
   * no wish to hold it.
   */
  async importEnzymeFile(file: File): Promise<RebaseImportSummary> {
    const parsed = parseRebaseWithRefM(await file.text());
    const label = parsed.version === null ? 'Imported enzymes' : `REBASE ${parsed.version}`;
    const set = {
      id: 'rebase',
      label,
      enzymes: parsed.enzymes,
      suppliers: parsed.suppliers,
      fileName: file.name,
    };
    await this.repo.saveEnzymeSet(set);
    this.applyEnzymeSet(set);
    analytics.track('enzymes', 'import', parsed.version ?? 'unknown');
    return {
      label,
      count: parsed.enzymes.length,
      released: parsed.released,
      skipped: parsed.skipped,
    };
  }

  /** Goes back to the table that ships with the app and forgets the import. */
  async useBundledEnzymes(): Promise<void> {
    await this.repo.saveEnzymeSet(null);
    this.applyEnzymeSet(null);
    analytics.track('enzymes', 'import-clear');
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
        editorStore.openDocument(stored.doc, stored.fileName, [], {
          id,
          origin: stored.origin,
          derived: stored.derived,
        });
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
    editorStore.openDocument(stored.doc, stored.fileName, [], {
      id,
      origin: stored.origin,
      derived: stored.derived,
    });
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
   * Picks a file with the native picker when available — a better dialog
   * than an <input type="file">, and that is all it is for now that nothing
   * writes back — and hands it to `use`, which opens it or compares against
   * it. Returns false when the caller should fall back to the input, true
   * when the picker did its job (including when the user cancelled).
   */
  async openWithPicker(handle: (file: File) => Promise<unknown>): Promise<boolean> {
    if (!supportsFileSystemAccess()) return false;
    const file = await pickOpenFile();
    if (file === null) return true; // cancelled
    await handle(file);
    return true;
  }

  /**
   * Writes the document in front out as a GenBank file. Nothing PlasmidPop
   * holds is a file on disk — a document lives in this browser until the
   * user asks for a copy of it — so this is the one way sequence leaves the
   * app, and a working copy shows what it changed about the file it came
   * from before it goes: the dialog's own button then calls `write`, which
   * is also the user gesture the save dialog needs.
   */
  async download(): Promise<void> {
    const target = editorStore.documentState();
    if (target === null) return;
    const { documentId, origin, derived } = target;
    if (origin !== null && derived) {
      editorStore.requestSaveReview(documentId, origin.fileName);
      return;
    }
    await this.write(documentId);
  }

  /** The user has read the review of their changes and wants the file written. */
  async confirmSaveReview(): Promise<void> {
    const id = editorStore.getState().documentId;
    editorStore.dismissSaveReview();
    if (id !== null) await this.write(id);
  }

  /**
   * Writes a document out, through the browser's save dialog where there is
   * one and as an ordinary download where there is not. The handle the
   * dialog returns is used for this one write and then dropped: a document
   * is never bound to a file, so no later edit can reach back into one.
   *
   * The tab is named rather than taken from the front, because the user may
   * switch tabs while the dialog is up.
   */
  private async write(documentId: string): Promise<void> {
    const target = editorStore.documentState(documentId);
    if (target === null) return;
    const suggested = downloadNameFor(target);
    if (!supportsFileSystemAccess()) {
      downloadText(suggested, writeGenBank(target.history.present));
      editorStore.markDownloaded(documentId, suggested);
      // The browser owns the file from here: it decides where it lands and
      // numbers the next one rather than replacing this one. Say so.
      editorStore.noteDownload(suggested);
      return;
    }
    const handle = await pickSaveFile(suggested);
    if (handle === null) return; // cancelled
    // The document as it is now, not as it was when the dialog opened.
    const current = editorStore.documentState(documentId)?.history.present;
    if (current === undefined) return; // the tab was closed while the dialog was up
    await writeTextToHandle(handle, writeGenBank(current));
    editorStore.markDownloaded(documentId, handle.name);
  }
}

export const persistence = new PersistenceService();
