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
      await this.db.handles.put({ id: to, handle: stored.handle });
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

  async saveHandle(id: string, handle: FileSystemFileHandle): Promise<void> {
    await this.db.handles.put({ id, handle });
  }

  async loadHandle(id: string): Promise<FileSystemFileHandle | null> {
    return (await this.db.handles.get(id))?.handle ?? null;
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
