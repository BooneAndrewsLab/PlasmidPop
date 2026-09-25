// @vitest-environment jsdom
import { SeqDocument, createFeature, rangeSegment, typingRun } from '@/core';
import { DocumentRepository, PlasmidPopDb } from '@/storage';
import { stateView } from '@/test/historyViews';

import { editorStore, editsBaselineDocument } from './editorStore';
import { PersistenceService } from './persistence';

/**
 * The undo history across a reload (item 51): edit in the store, let the
 * autosave write, forget every tab as a reload does, and bring the session
 * back from storage.
 */

let counter = 0;

function freshService(): { repo: DocumentRepository; service: PersistenceService } {
  const repo = new DocumentRepository(new PlasmidPopDb(`hist-svc-${Date.now()}-${counter++}`));
  return { repo, service: new PersistenceService(repo) };
}

const plasmid = SeqDocument.create({
  name: 'pUndo',
  sequence: 'ACGTACGTACGTACGTACGTACGTACGTACGTACGTACGT',
  topology: 'circular',
  features: [createFeature({ id: 'g', type: 'gene', name: 'g', segments: [rangeSegment(36, 44)] })],
});

/** What a reload does to the store, and what the page does after it. */
async function reload(service: PersistenceService): Promise<void> {
  await service.autosave();
  editorStore.closeAllDocuments();
  expect(await service.restoreLastSession()).toBe(true);
}

function active() {
  const state = editorStore.documentState();
  if (state === null) throw new Error('no document in front');
  return state;
}

describe('the undo history across a reload', () => {
  afterEach(() => {
    editorStore.closeAllDocuments();
  });

  it('comes back, so undo and redo give the states they gave before', async () => {
    const { service } = freshService();
    editorStore.openDocument(plasmid);
    editorStore.apply({ type: 'insert', position: 4, text: 'GGG' });
    editorStore.apply({ type: 'delete', range: { start: 0, end: 2 } });
    editorStore.apply({ type: 'updateFeature', id: 'g', patch: { name: 'renamed' } });
    editorStore.undo();
    const before = active().history;
    const states = Array.from({ length: before.size + 1 }, (_, i) => before.stateAt(i));

    await reload(service);
    const after = active().history;
    expect(after.labels).toEqual(before.labels);
    expect(after.position).toBe(2);
    expect(after.steps.map((s) => s.at)).toEqual(before.steps.map((s) => s.at));
    expect(stateView(after.present)).toEqual(stateView(before.present));

    editorStore.undo();
    expect(stateView(active().history.present)).toEqual(stateView(states[1] ?? plasmid));
    editorStore.undo();
    expect(stateView(active().history.present)).toEqual(stateView(plasmid));
    editorStore.redo();
    editorStore.redo();
    editorStore.redo();
    // The step undone before the reload is still there to redo.
    expect(editorStore.document?.features.get('g')?.name).toBe('renamed');
    expect(stateView(active().history.present)).toEqual(stateView(states[3] ?? plasmid));
  });

  it('comes back with a run of typing sealed: the next keystroke is a step of its own', async () => {
    const { service } = freshService();
    editorStore.openDocument(plasmid);
    const type = (at: number): void => {
      editorStore.apply({ type: 'insert', position: at, text: 'A' }, undefined, undefined, {
        ...typingRun(at, at + 1),
      });
    };
    type(10);
    type(11);
    expect(active().history.size).toBe(1);
    await reload(service);
    type(12);
    expect(active().history.size).toBe(2);
    editorStore.undo();
    expect(editorStore.document?.length).toBe(plasmid.length + 2);
  });

  it('keeps "Since opened" at what was opened, and the dot at the download', async () => {
    const { service } = freshService();
    editorStore.openDocument(plasmid);
    editorStore.setEditsBaseline('opened');
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    const id = active().documentId;
    editorStore.markDownloaded(id, 'pUndo.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'C' });
    expect(editorStore.getState().dirty).toBe(true);

    await reload(service);
    const state = editorStore.getState();
    // Opened: the history's first state, which is what was opened.
    expect(active().openedDoc).toBe(active().history.stateAt(0));
    expect(stateView(editsBaselineDocument(state) ?? plasmid.rename('x'))).toEqual(
      stateView(plasmid),
    );
    // The download is step 1, and is still the state the dot is measured by.
    expect(state.dirty).toBe(true);
    expect(active().savedDoc).toBe(active().history.stateAt(1));
    editorStore.undo();
    expect(editorStore.getState().dirty).toBe(false);
    editorStore.setEditsBaseline('saved');
    expect(editsBaselineDocument(editorStore.getState())).toBe(active().history.present);
  });

  it('brings a working copy back measured against the file it came from', async () => {
    const { service } = freshService();
    editorStore.openDocument(plasmid, 'pUndo.gb');
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    editorStore.apply({ type: 'insert', position: 0, text: 'G' });
    expect(active().derived).toBe(true);

    await reload(service);
    const d = active();
    expect(d.derived).toBe(true);
    expect(d.history.size).toBe(2);
    // The copy's history starts at the file's contents under the copy's name…
    expect(d.history.stateAt(0)?.name).toBe('pUndo copy');
    // …and "Since opened" is the file itself, as it was before the reload.
    expect(d.openedDoc).toBe(d.origin?.doc);
    expect(d.savedDoc).toBeNull();
    expect(editorStore.getState().dirty).toBe(true);
    editorStore.jumpHistory(0);
    expect(editorStore.document?.sequence.toString()).toBe(plasmid.sequence.toString());
  });

  it('stays with a closed tab and goes with a removed document', async () => {
    const { repo, service } = freshService();
    editorStore.openDocument(plasmid);
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    const id = active().documentId;
    await service.autosave();
    editorStore.closeDocument(id);
    expect(await repo.hasHistory(id)).toBe(true);

    await service.openStored(id);
    expect(active().history.size).toBe(1);
    editorStore.undo();
    expect(editorStore.document?.length).toBe(plasmid.length);

    await service.removeStored(id);
    expect(await repo.hasHistory(id)).toBe(false);
  });

  it('is written again when only the history moved, as an undo does', async () => {
    const { service } = freshService();
    editorStore.openDocument(plasmid);
    editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    await service.autosave();
    editorStore.undo();
    await reload(service);
    expect(active().history.position).toBe(0);
    expect(active().history.canRedo).toBe(true);
  });
});
