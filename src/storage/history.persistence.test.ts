// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { History, SeqDocument, createFeature, rangeSegment } from '@/core';
import { historyView, stateView } from '@/test/historyViews';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;

function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`history-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const doc = SeqDocument.create({
  name: 'pHist',
  sequence: 'ACGTACGTACGTACGTACGTGGCCAATT',
  topology: 'circular',
  features: [
    createFeature({ id: 'wrap', type: 'gene', name: 'w', segments: [rangeSegment(24, 32)] }),
  ],
});

function session() {
  const a = doc.insert(4, 'TTT');
  const b = a.delete({ start: 0, end: 2 });
  const c = b.rename('pHist 2');
  const history = History.create(doc, { at: 100 })
    .push(a, 'Insert 3 bases', 200)
    .push(b, 'Delete', 300)
    .push(c, 'Rename', 400)
    .undo();
  return { history, a, b, c };
}

describe('DocumentRepository histories (item 51)', () => {
  it('writes a history with its document and reads both back', async () => {
    const { repo } = fresh();
    const { history, a } = session();
    await repo.save('d', history.present, 'pHist.gb', undefined, {
      history,
      opened: doc,
      saved: a,
      origin: null,
    });
    expect(await repo.hasHistory('d')).toBe(true);
    const loaded = await repo.load('d');
    expect(loaded?.historyStatus()).toBe('restored');
    const back = loaded?.history();
    if (back === null || back === undefined) throw new Error('no history');
    expect(historyView(back.history)).toEqual(historyView(history));
    // The document is the history's present, though not the same object:
    // the document comes from its own row and the states are rebuilt later
    // (#83), so what is checked is that they are the same document.
    expect(loaded?.doc.sequence.toString()).toBe(back.history.present.sequence.toString());
    expect(loaded?.doc.name).toBe(back.history.present.name);
    expect(back.opened).toBe(back.history.stateAt(0));
    expect(back.saved).toBe(back.history.stateAt(1));
    // Undo and redo go on from where they were.
    expect(stateView(back.history.undo().present)).toEqual(stateView(a));
    expect(back.history.redo().present.name).toBe('pHist 2');
  });

  it('leaves the history alone without one, deletes it with null, and with the document', async () => {
    const { repo } = fresh();
    const { history } = session();
    const input = { history, opened: doc, saved: null, origin: null };
    await repo.save('d', history.present, null, undefined, input);
    await repo.save('d', history.present, null);
    expect(await repo.hasHistory('d')).toBe(true);
    await repo.save('d', history.present, null, undefined, null);
    expect(await repo.hasHistory('d')).toBe(false);
    expect((await repo.load('d'))?.historyStatus()).toBe('none');

    await repo.save('d', history.present, null, undefined, input);
    await repo.remove('d');
    expect(await repo.hasHistory('d')).toBe(false);
    expect(await repo.load('d')).toBeNull();
  });

  it('does not store a history that ends somewhere else than the document', async () => {
    const { repo } = fresh();
    const { history } = session();
    await repo.save('d', doc, null, undefined, { history, opened: doc, saved: null, origin: null });
    expect(await repo.hasHistory('d')).toBe(false);
  });

  it('drops a history it cannot read, or one out of step, and keeps the document', async () => {
    const { db, repo } = fresh();
    const { history } = session();
    const input = { history, opened: doc, saved: null, origin: null };
    await repo.save('d', history.present, null, undefined, input);
    const row = await db.histories.get('d');
    if (row === undefined) throw new Error('no row');
    await db.histories.put({ ...row, base: { ...row.base, sequence: 'not DNA' } });
    let loaded = await repo.load('d');
    expect(loaded?.historyStatus()).toBe('dropped');
    expect(loaded?.history()).toBeNull();
    // The document itself is read from its GenBank text, as before histories were kept.
    expect(loaded?.doc.sequence.toString()).toBe(history.present.sequence.toString());
    expect(loaded?.doc.name).toBe(history.present.name);

    // A document written without its history: the old row ends elsewhere.
    await repo.save('d', history.present, null, undefined, input);
    await repo.save('d', history.present.insert(0, 'G'), null);
    loaded = await repo.load('d');
    expect(loaded?.historyStatus()).toBe('dropped');
    expect(loaded?.doc.length).toBe(history.present.length + 1);
  });

  it('makes renaming a stored document a step of its history', async () => {
    const { repo } = fresh();
    const { history } = session();
    await repo.save('d', history.present, null, undefined, {
      history,
      opened: doc,
      saved: null,
      origin: null,
    });
    expect(await repo.rename('d', 'pNew')).toBe(true);
    const back = (await repo.load('d'))?.history();
    expect(back?.history.present.name).toBe('pNew');
    expect(back?.history.undoLabel).toBe('Rename');
    // The rename replaced the undone step, as a rename in a tab would.
    expect(back?.history.canRedo).toBe(false);
    expect(stateView(back?.history.undo().present ?? doc)).toEqual(stateView(history.present));
  });

  it('points a working copy’s opened baseline at the original stored beside it', async () => {
    const { repo } = fresh();
    const copy = doc.rename('pHist copy');
    const history = History.create(copy, { at: 0 }).push(copy.insert(0, 'A'), 'Insert 1 base', 1);
    await repo.save(
      'd',
      history.present,
      'pHist.gb',
      { origin: { fileName: 'pHist.gb', doc }, derived: true },
      { history, opened: doc, saved: null, origin: doc },
    );
    const loaded = await repo.load('d');
    expect(loaded?.history()?.opened).toBe(loaded?.origin?.doc);
    expect(loaded?.history()?.saved).toBeNull();
  });
});
