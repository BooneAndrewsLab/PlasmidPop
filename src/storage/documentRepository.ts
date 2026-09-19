import { type AssemblyPart, type OverhangKind, type SeqDocument } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';

import { type PlasmidPopDb, type StoredDocument, SHELF_ID, getDb } from './db';

const LAST_DOCUMENT_KEY = 'plasmidpop.lastDocument';
const OPEN_DOCUMENTS_KEY = 'plasmidpop.openDocuments';

export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly fileName: string | null;
  readonly length: number;
  readonly topology: StoredDocument['topology'];
  readonly featureCount: number;
  readonly updatedAt: number;
}

/**
 * Persistence for open documents. Every method takes the database as an
 * optional last argument so tests can use an isolated instance.
 */
export class DocumentRepository {
  constructor(private readonly db: PlasmidPopDb = getDb()) {}

  async save(id: string, doc: SeqDocument, fileName: string | null): Promise<void> {
    const now = Date.now();
    const existing = await this.db.documents.get(id);
    await this.db.documents.put({
      id,
      name: doc.name,
      fileName,
      text: writeGenBank(doc),
      length: doc.length,
      topology: doc.topology,
      featureCount: doc.features.size,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async has(id: string): Promise<boolean> {
    return (await this.db.documents.where('id').equals(id).count()) > 0;
  }

  /**
   * Id of a stored document identical to `doc` (same GenBank text and file
   * name), so opening the same file or example twice does not add a second
   * entry to the recent list.
   */
  async findIdentical(doc: SeqDocument, fileName: string | null): Promise<string | null> {
    const text = writeGenBank(doc);
    const match = await this.db.documents
      .where('name')
      .equals(doc.name)
      .filter((d) => d.fileName === fileName && d.text === text)
      .first();
    return match?.id ?? null;
  }

  /** Re-keys a stored file handle, dropping any handle already under `to`. */
  async moveHandle(from: string, to: string): Promise<void> {
    if (from === to) return;
    await this.db.transaction('rw', this.db.handles, async () => {
      const stored = await this.db.handles.get(from);
      if (stored === undefined) return;
      await this.db.handles.put({ ...stored, id: to });
      await this.db.handles.delete(from);
    });
  }

  async load(id: string): Promise<{ doc: SeqDocument; fileName: string | null } | null> {
    const stored = await this.db.documents.get(id);
    if (stored === undefined) return null;
    const doc = parseGenBank(stored.text).documents[0];
    if (doc === undefined) return null;
    return { doc: doc.rename(stored.name), fileName: stored.fileName };
  }

  /** Renames a stored document in place; false when there is no such document. */
  async rename(id: string, name: string): Promise<boolean> {
    const stored = await this.load(id);
    if (stored === null) return false;
    await this.save(id, stored.doc.rename(name), stored.fileName);
    return true;
  }

  async list(): Promise<DocumentSummary[]> {
    const all = await this.db.documents.orderBy('updatedAt').reverse().toArray();
    return all.map(({ id, name, fileName, length, topology, featureCount, updatedAt }) => ({
      id,
      name,
      fileName,
      length,
      topology,
      featureCount,
      updatedAt,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.handles, async () => {
      await this.db.documents.delete(id);
      await this.db.handles.delete(id);
    });
    if (this.lastDocumentId() === id) this.setLastDocumentId(null);
    this.setOpenDocumentIds(this.openDocumentIds().filter((open) => open !== id));
  }

  /** Stores the handle Save writes to; `writeConfirmed` when the user chose the file in a save dialog. */
  async saveHandle(
    id: string,
    handle: FileSystemFileHandle,
    writeConfirmed = false,
  ): Promise<void> {
    await this.db.handles.put({ id, handle, writeConfirmed });
  }

  async loadHandle(id: string): Promise<FileSystemFileHandle | null> {
    return (await this.db.handles.get(id))?.handle ?? null;
  }

  /** Whether the user has agreed that Save may overwrite the stored file. */
  async isWriteConfirmed(id: string): Promise<boolean> {
    return (await this.db.handles.get(id))?.writeConfirmed === true;
  }

  /** Records the user's agreement to overwrite the stored file; no-op without a stored handle. */
  async confirmWrite(id: string): Promise<void> {
    await this.db.handles.where('id').equals(id).modify({ writeConfirmed: true });
  }

  /** The document that was in front when the page was last left, or null for the file list. */
  lastDocumentId(): string | null {
    try {
      return globalThis.localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      return null;
    }
  }

  /** Ids of the documents that were open in tabs, in tab order, when the page was last left. */
  openDocumentIds(): readonly string[] {
    try {
      const raw = globalThis.localStorage.getItem(OPEN_DOCUMENTS_KEY);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  setOpenDocumentIds(ids: readonly string[]): void {
    try {
      if (ids.length === 0) globalThis.localStorage.removeItem(OPEN_DOCUMENTS_KEY);
      else globalThis.localStorage.setItem(OPEN_DOCUMENTS_KEY, JSON.stringify(ids));
    } catch {
      // Best effort, like `setLastDocumentId`.
    }
  }

  /**
   * The Cloning tab's assembly shelf. Stored parts are checked on the way in
   * rather than trusted: a row written by an older build, or one that has
   * gone bad, should cost the user a fragment, not the Cloning tab.
   */
  async loadShelf(): Promise<AssemblyPart[]> {
    const stored = await this.db.shelf.get(SHELF_ID);
    if (stored === undefined) return [];
    return stored.parts.filter((p): p is AssemblyPart => isAssemblyPart(p));
  }

  /** Writes the shelf, removing the row altogether when it is empty. */
  async saveShelf(parts: readonly AssemblyPart[]): Promise<void> {
    if (parts.length === 0) {
      await this.db.shelf.delete(SHELF_ID);
      return;
    }
    await this.db.shelf.put({ id: SHELF_ID, parts, updatedAt: Date.now() });
  }

  setLastDocumentId(id: string | null): void {
    try {
      if (id === null) globalThis.localStorage.removeItem(LAST_DOCUMENT_KEY);
      else globalThis.localStorage.setItem(LAST_DOCUMENT_KEY, id);
    } catch {
      // Storage may be unavailable (private mode, quota); persistence is best effort.
    }
  }
}

const OVERHANG_KINDS: ReadonlySet<string> = new Set<OverhangKind>(['blunt', "5'", "3'"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isString(v: unknown): boolean {
  return typeof v === 'string';
}

function isStrandEnd(v: unknown): boolean {
  if (!isObject(v)) return false;
  const kind: unknown = v['kind'];
  return (
    typeof kind === 'string' &&
    OVERHANG_KINDS.has(kind) &&
    isString(v['overhang']) &&
    (v['enzyme'] === null || isString(v['enzyme']))
  );
}

function isRange(v: unknown): boolean {
  return isObject(v) && typeof v['start'] === 'number' && typeof v['end'] === 'number';
}

/** Enough of a feature to place and to draw; the rest is the parser's business. */
function isFeature(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v['id']) &&
    isString(v['type']) &&
    isString(v['name']) &&
    (v['strand'] === 'forward' || v['strand'] === 'reverse') &&
    Array.isArray(v['segments']) &&
    v['segments'].length > 0 &&
    Array.isArray(v['qualifiers'])
  );
}

function isAssemblyPart(v: unknown): boolean {
  if (!isObject(v) || !isString(v['id']) || typeof v['flipped'] !== 'boolean') return false;
  const f: unknown = v['fragment'];
  return (
    isObject(f) &&
    isString(f['sequence']) &&
    isString(f['source']) &&
    isRange(f['range']) &&
    isStrandEnd(f['left']) &&
    isStrandEnd(f['right']) &&
    Array.isArray(f['features']) &&
    f['features'].every(isFeature)
  );
}

let shared: DocumentRepository | null = null;

export function getRepository(): DocumentRepository {
  shared ??= new DocumentRepository();
  return shared;
}
