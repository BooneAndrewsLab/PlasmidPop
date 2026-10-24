// @vitest-environment jsdom
import { SeqDocument } from '@/core';
import { writeGenBank } from '@/io';
import { DocumentRepository, PlasmidPopDb } from '@/storage';

import { editorStore } from './editorStore';
import { PersistenceService } from './persistence';

/**
 * The flush on leaving (#290): an IndexedDB write begun as the page goes
 * may never commit, so what the flush writes must also be somewhere a reload
 * reads without waiting: the document opened a moment before, or edited a
 * moment before, must come back.
 */

let counter = 0;

const doc = SeqDocument.create({ name: 'pLeave', sequence: 'ACGTACGTACGT', topology: 'circular' });

/** A repository whose writes never commit: the page is gone before they do. */
function leavingRepo(db: PlasmidPopDb): DocumentRepository {
  const repo = new DocumentRepository(db);
  vi.spyOn(repo, 'write').mockImplementation(() => new Promise<boolean>(() => undefined));
  return repo;
}

/** A reload: the same storage, a new service, no tabs. */
async function reload(db: PlasmidPopDb): Promise<PersistenceService> {
  editorStore.closeAllDocuments();
  const service = new PersistenceService(new DocumentRepository(db));
  expect(await service.restoreLastSession()).toBe(true);
  return service;
}

describe('the flush on leaving keeps what the IndexedDB write may not', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    editorStore.closeAllDocuments();
  });

  it('restores a document opened just before the page was left', async () => {
    const db = new PlasmidPopDb(`leave-open-${Date.now()}-${counter++}`);
    const service = new PersistenceService(leavingRepo(db));
    editorStore.openDocument(doc, 'pLeave.gb');
    const id = editorStore.getState().documentId;
    void service.autosave({ urgent: true });
    expect(await db.documents.count()).toBe(0);
    await reload(db);
    expect(editorStore.getState()).toMatchObject({ documentId: id, fileName: 'pLeave.gb' });
    expect(editorStore.document?.sequence.toString()).toBe('ACGTACGTACGT');
  });

  it('restores an edit made just before the page was left over the stored one', async () => {
    const db = new PlasmidPopDb(`leave-edit-${Date.now()}-${counter++}`);
    const first = new PersistenceService(new DocumentRepository(db));
    editorStore.openDocument(doc, 'pLeave.gb');
    await first.autosave();
    const service = new PersistenceService(leavingRepo(db));
    editorStore.apply({ type: 'insert', position: 0, text: 'GG' });
    const edited = editorStore.document;
    void service.autosave({ urgent: true });
    await reload(db);
    expect(editorStore.document?.sequence.toString()).toBe('GGACGTACGTACGT');
    expect(editorStore.document && writeGenBank(editorStore.document)).toBe(
      edited && writeGenBank(edited),
    );
  });

  it('forgets the stash once the write has committed, and when it is stale', async () => {
    const db = new PlasmidPopDb(`leave-done-${Date.now()}-${counter++}`);
    const repo = new DocumentRepository(db);
    const service = new PersistenceService(repo);
    editorStore.openDocument(doc, 'pLeave.gb');
    const id = editorStore.getState().documentId ?? '';
    await service.autosave({ urgent: true });
    expect(repo.stashed(id)).toBeNull();
    // A later edit saved normally is not overridden by an older stash.
    editorStore.apply({ type: 'insert', position: 0, text: 'GG' });
    await service.autosave();
    await reload(db);
    expect(editorStore.document?.sequence.toString()).toBe('GGACGTACGTACGT');
  });

  it('stashes nothing too large for localStorage, and prunes the stashes of tabs that are gone', () => {
    const repo = new DocumentRepository(new PlasmidPopDb(`leave-size-${Date.now()}-${counter++}`));
    repo.stash('big', null, doc, 'A'.repeat(1_500_001), 1);
    expect(repo.stashed('big')).toBeNull();
    repo.stash('kept', null, doc, 'LOCUS', 1);
    repo.stash('gone', null, doc, 'LOCUS', 1);
    repo.pruneStashes(new Set(['kept']));
    expect(repo.stashed('kept')).not.toBeNull();
    expect(repo.stashed('gone')).toBeNull();
  });
});
