import { type SeqDocument } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';

import { type PlasmidPopDb, type StoredDocument, getDb } from './db';

const LAST_DOCUMENT_KEY = 'plasmidpop.lastDocument';

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

  lastDocumentId(): string | null {
    try {
      return globalThis.localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      return null;
    }
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

let shared: DocumentRepository | null = null;

export function getRepository(): DocumentRepository {
  shared ??= new DocumentRepository();
  return shared;
}
