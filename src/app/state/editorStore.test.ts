import { SeqDocument, createFeature, documentChecksum, rangeSegment } from '@/core';

import { deleteBackward, deleteForward, typeText } from '../editing';
import { parseGenBank } from '@/io';

import { ERROR_FADE_MS, EditorStore, MAX_DEFAULT_ENZYMES } from './editorStore';

const doc = SeqDocument.create({
  sequence: 'ACGTACGTACGTACGTACGT',
  topology: 'circular',
  features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(17, 23)] })],
});

describe('EditorStore', () => {
  it('starts empty and opens documents', () => {
    const store = new EditorStore();
    expect(store.document).toBeNull();
    const listener = vi.fn();
    store.subscribe(listener);
    store.openDocument(doc, 'x.gb');
    expect(store.document).toBe(doc);
    expect(store.getState().fileName).toBe('x.gb');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('starts a new empty document that is clean until edited', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    store.newDocument();
    expect(store.document?.length).toBe(0);
    expect(store.document?.name).toBe('Untitled');
    expect(store.document?.topology).toBe('linear');
    expect(store.getState()).toMatchObject({
      fileName: null,
      dirty: false,
      selection: { start: 0, end: 0 },
    });
    store.apply({ type: 'insert', position: 0, text: 'ACGT' });
    expect(store.document?.sequence.toString()).toBe('ACGT');
    expect(store.getState().dirty).toBe(true);
    expect(store.getState().selection).toEqual({ start: 4, end: 4 });
    store.newDocument('circular');
    expect(store.document?.isCircular).toBe(true);
  });

  it('opens parse results and reports empty ones', () => {
    const store = new EditorStore();
    store.openParsed(
      parseGenBank('LOCUS       X 4 bp DNA linear\nORIGIN\n        1 acgt\n//\n'),
      'x.gb',
    );
    expect(store.document?.length).toBe(4);
    store.openParsed({ format: 'fasta', documents: [], warnings: [] }, 'e.fa');
    expect(store.getState().error).toMatch(/no sequences/);
    store.dismissError();
    expect(store.getState().error).toBeNull();
  });

  it('applies ops with undo/redo and keeps a caret in place', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.setSelection({ start: 5, end: 5 });
    store.apply({ type: 'insert', position: 2, text: 'NN' });
    expect(store.document?.length).toBe(22);
    expect(store.getState().selection).toEqual({ start: 7, end: 7 });
    expect(store.getState().history?.undoLabel).toBe('Insert 2 bases');
    store.undo();
    expect(store.document).toBe(doc);
    store.redo();
    expect(store.document?.length).toBe(22);
    store.apply({ type: 'rename', text: 'x', name: doc.name } as never); // no-op op does not push
    expect(store.getState().history?.undoDepth).toBe(1);
  });

  it('selects features, including wrapped ones, and requests a reveal', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const nonce = store.getState().reveal?.nonce ?? 0;
    store.selectFeature('f');
    expect(store.getState().selection).toEqual({ start: 17, end: 23 });
    expect(store.getState().reveal).toEqual({ position: 17, nonce: nonce + 1 });
    store.selectFeature('missing');
    expect(store.getState().selection).toEqual({ start: 17, end: 23 });
  });

  it('ignores redundant selection updates', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSelection({ start: 1, end: 3 });
    store.setSelection({ start: 1, end: 3 });
    store.setSelection(null);
    store.setSelection(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('follows the selection through reverse complement and set origin', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.setSelection({ start: 2, end: 5 });
    store.apply({ type: 'reverseComplement' });
    expect(store.getState().selection).toEqual({ start: 15, end: 18 });
    store.apply({ type: 'setOrigin', position: 15 });
    expect(store.getState().selection).toEqual({ start: 0, end: 3 });
    expect(store.document?.subsequence({ start: 0, end: 3 })).toBe(
      doc
        .subsequence({ start: 2, end: 5 })
        .split('')
        .reverse()
        .map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c] ?? c)
        .join(''),
    );
  });

  it('annotates the selection and asks for a name', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.addFeatureFromSelection();
    expect(store.document?.features.size).toBe(1);
    store.setSelection({ start: 3, end: 9 });
    store.addFeatureFromSelection();
    expect(store.document?.features.size).toBe(2);
    const added = store.document?.features.all()[1];
    expect(added).toMatchObject({ type: 'misc_feature', name: 'New feature' });
    expect(store.getState().renameRequest?.id).toBe(added?.id);
    expect(store.getState().selection).toEqual({ start: 3, end: 9 });
    store.finishRename();
    expect(store.getState().renameRequest).toBeNull();
    store.applyPlan(null);
    expect(store.getState().history?.undoDepth).toBe(1);
  });
});

describe('EditorStore errors', () => {
  it('auto-dismisses a timed notice, restarting the clock on each repeat', () => {
    vi.useFakeTimers();
    try {
      const store = new EditorStore();
      store.openDocument(doc);
      store.fail('bad character', { autoDismissMs: 5000 });
      expect(store.getState().errorCountdown).toEqual({
        durationMs: 5000,
        fadeMs: ERROR_FADE_MS,
        nonce: 1,
      });
      vi.advanceTimersByTime(4000);
      // A good keystroke in between does not hide it.
      store.apply({ type: 'insert', position: 0, text: 'A' });
      expect(store.getState().error).toBe('bad character');
      // Another rejected keystroke restarts the five seconds (and the indicator).
      store.fail('bad character', { autoDismissMs: 5000 });
      expect(store.getState().errorCountdown?.nonce).toBe(2);
      vi.advanceTimersByTime(4000);
      expect(store.getState().error).toBe('bad character');
      // Still there while fading, gone after.
      vi.advanceTimersByTime(1000);
      expect(store.getState().error).toBe('bad character');
      vi.advanceTimersByTime(ERROR_FADE_MS);
      expect(store.getState().error).toBeNull();
      expect(store.getState().errorCountdown).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an untimed error until dismissed, and dismissing cancels a pending timer', () => {
    vi.useFakeTimers();
    try {
      const store = new EditorStore();
      store.fail('timed', { autoDismissMs: 5000 });
      store.dismissError();
      store.fail('permanent');
      expect(store.getState().errorCountdown).toBeNull();
      vi.advanceTimersByTime(10000);
      expect(store.getState().error).toBe('permanent');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EditorStore analysis', () => {
  it('stores results for the current document only and defaults to single cutters', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    store.setAnalysis(doc, [site('EcoRI', 3), site('AluI', 5), site('AluI', 9)], []);
    expect([...store.getState().shownEnzymes]).toEqual(['EcoRI']);
    expect(store.visibleCutSites()).toHaveLength(1);
    store.setEnzymeShown('AluI', true);
    expect(store.visibleCutSites()).toHaveLength(3);
    store.setEnzymeShown('AluI', true);
    // Later results keep the user's choice.
    store.setAnalysis(doc, [site('EcoRI', 3)], []);
    expect(store.getState().shownEnzymes.has('AluI')).toBe(true);
    // Results for another document are ignored.
    store.setAnalysis(SeqDocument.create({ sequence: 'ACGT' }), [site('NotI', 1)], []);
    expect(store.getState().analysis?.cutSites.map((s) => s.enzyme)).toEqual(['EcoRI']);
    // Editing keeps the sites, shifted, as a provisional result until fresh ones arrive.
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.getState().analysis?.provisional).toBe(true);
    expect(store.visibleCutSites().map((s) => s.cut)).toEqual([4]);
    store.setOrfMinCodons(30);
    expect(store.getState().analysis).toBeNull();
    store.setShownEnzymes(['NotI']);
    expect([...store.getState().shownEnzymes]).toEqual(['NotI']);
  });

  it('ticks nothing when a big table gives too many single cutters', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    const many = Array.from({ length: MAX_DEFAULT_ENZYMES + 1 }, (_, i) => site(`Enz${i}`, i));
    store.setAnalysis(doc, many, []);
    expect(store.getState().shownEnzymes.size).toBe(0);
    // The default is not applied again once the user has chosen.
    store.setEnzymeShown('Enz0', true);
    store.setAnalysis(doc, many, []);
    expect([...store.getState().shownEnzymes]).toEqual(['Enz0']);
  });

  it('hides drawn cut sites without touching the ticks', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    store.setAnalysis(doc, [site('EcoRI', 3), site('AluI', 5), site('AluI', 9)], []);
    expect(store.getState().showCutSites).toBe(true);
    expect(store.visibleCutSites()).toHaveLength(1);
    store.setShowCutSites(false);
    expect(store.visibleCutSites()).toHaveLength(0);
    // The chosen set survives, so showing them again needs no re-ticking.
    expect([...store.getState().shownEnzymes]).toEqual(['EcoRI']);
    store.setShowCutSites(true);
    expect(store.visibleCutSites().map((s) => s.enzyme)).toEqual(['EcoRI']);
  });

  describe('carrying results through edits', () => {
    const site = (enzyme: string, siteStart: number, cut: number, cutBottom = cut) => ({
      enzyme,
      cut,
      cutBottom,
      siteStart,
      strand: 'forward' as const,
    });
    const orf = (start: number, end: number) => ({
      range: { start, end },
      strand: 'forward' as const,
      frame: 0,
      codons: (end - start) / 3 - 1,
    });
    const linear = SeqDocument.create({ sequence: 'ACGTACGTACGTACGTACGT' });

    function withResults() {
      const store = new EditorStore();
      store.openDocument(linear);
      store.setAnalysis(
        linear,
        [site('EcoRI', 2, 3), site('BsaI', 10, 14, 18), site('AluI', 15, 16)],
        [orf(0, 6), orf(6, 18)],
      );
      return store;
    }

    it('keeps results exact through annotation-only ops', () => {
      const store = withResults();
      store.apply({ type: 'rename', name: 'renamed' });
      const a = store.getState().analysis;
      expect(a?.doc).toBe(store.document);
      expect(a?.provisional).toBe(false);
      expect(a?.cutSites).toHaveLength(3);
      expect(a?.orfs).toHaveLength(2);
    });

    it('shifts sites and ORFs after an insert and drops the ones the edit hit', () => {
      const store = withResults();
      store.apply({ type: 'insert', position: 8, text: 'GG' });
      const a = store.getState().analysis;
      expect(a?.doc).toBe(store.document);
      expect(a?.provisional).toBe(true);
      expect(a?.cutSites.map((s) => [s.enzyme, s.siteStart, s.cut, s.cutBottom])).toEqual([
        ['EcoRI', 2, 3, 3],
        ['BsaI', 12, 16, 20],
        ['AluI', 17, 18, 18],
      ]);
      // The first ORF is before the insert; the second spans it and is gone.
      expect(a?.orfs.map((o) => [o.range.start, o.range.end])).toEqual([[0, 6]]);
    });

    it('drops a site whose cut is separated from its recognition site by the edit', () => {
      const store = withResults();
      store.apply({ type: 'insert', position: 12, text: 'T' });
      const names = store.getState().analysis?.cutSites.map((s) => s.enzyme);
      expect(names).toEqual(['EcoRI', 'AluI']);
    });

    it('shifts positions back after a delete', () => {
      const store = withResults();
      store.apply({ type: 'delete', range: { start: 4, end: 8 } });
      const a = store.getState().analysis;
      expect(a?.cutSites.map((s) => [s.enzyme, s.cut])).toEqual([
        ['EcoRI', 3],
        ['BsaI', 10],
        ['AluI', 12],
      ]);
      expect(a?.orfs).toEqual([]);
    });

    it('does not follow whole-document ops', () => {
      const store = withResults();
      store.apply({ type: 'reverseComplement' });
      expect(store.getState().analysis).toBeNull();
    });

    it('is replaced by fresh results and ignores stale ones', () => {
      const store = withResults();
      store.apply({ type: 'insert', position: 0, text: 'A' });
      store.setAnalysis(linear, [site('NotI', 0, 1)], []);
      expect(store.getState().analysis?.provisional).toBe(true);
      const present = store.document;
      if (present === null) throw new Error('no document');
      store.setAnalysis(present, [site('NotI', 0, 1)], []);
      expect(store.getState().analysis).toEqual({
        doc: present,
        cutSites: [site('NotI', 0, 1)],
        orfs: [],
        provisional: false,
      });
    });
  });
});

describe('EditorStore persistence state', () => {
  it('tracks dirtiness against the saved version', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documentId).toMatch(/[0-9a-f-]{36}/);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.getState().dirty).toBe(true);
    // Undo goes back to what the file holds, but this tab is a working copy
    // now and no file holds it, so there is still something to download.
    store.undo();
    expect(store.getState().dirty).toBe(true);
    store.markDownloaded(store.getState().documentId ?? '', 'y.gb');
    expect(store.getState()).toMatchObject({ dirty: false, fileName: 'y.gb' });
    store.closeDocument();
    expect(store.document).toBeNull();
    expect(store.getState()).toMatchObject({ documentId: null, dirty: false });
  });

  it('treats a document without a file as unsaved and keeps a given id', () => {
    const store = new EditorStore();
    store.openDocument(doc, null, [], { id: 'fixed' });
    expect(store.getState()).toMatchObject({ dirty: true, documentId: 'fixed' });
  });
});

describe('fragment shelf', () => {
  const frag = (name: string) => ({
    sequence: 'ACGT',
    features: [],
    range: { start: 0, end: 4 },
    left: { kind: 'blunt' as const, overhang: '', enzyme: null },
    right: { kind: 'blunt' as const, overhang: '', enzyme: null },
    source: name,
  });

  it('collects, reorders, flips, removes and survives opening another document', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const a = store.addToShelf(frag('a'));
    const b = store.addToShelf(frag('b'));
    const c = store.addToShelf(frag('c'));
    expect(store.getState().shelf.map((p) => p.fragment.source)).toEqual(['a', 'b', 'c']);
    store.moveShelfPart(c, -1);
    expect(store.getState().shelf.map((p) => p.fragment.source)).toEqual(['a', 'c', 'b']);
    store.moveShelfPart(a, -1); // already first: no-op
    expect(store.getState().shelf.map((p) => p.fragment.source)).toEqual(['a', 'c', 'b']);
    store.flipShelfPart(b, { ...frag('b'), sequence: 'TTTT' });
    expect(store.getState().shelf[2]).toMatchObject({ flipped: true });
    expect(store.getState().shelf[2]?.fragment.sequence).toBe('TTTT');
    store.removeFromShelf(c);
    store.openDocument(SeqDocument.create({ sequence: 'AAAA' }));
    expect(store.getState().shelf.map((p) => p.fragment.source)).toEqual(['a', 'b']);
    store.clearShelf();
    expect(store.getState().shelf).toEqual([]);
  });

  it('puts back a stored shelf, but never over one already being filled', () => {
    const store = new EditorStore();
    const stored = [{ id: 'p1', fragment: frag('vector'), flipped: false }];
    store.restoreShelf(stored);
    expect(store.getState().shelf.map((p) => p.fragment.source)).toEqual(['vector']);

    // What the user has collected in the meantime wins over what was stored.
    const busy = new EditorStore();
    busy.addToShelf(frag('mine'));
    busy.restoreShelf(stored);
    expect(busy.getState().shelf.map((p) => p.fragment.source)).toEqual(['mine']);

    // Nothing stored leaves the shelf alone.
    busy.restoreShelf([]);
    expect(busy.getState().shelf.map((p) => p.fragment.source)).toEqual(['mine']);
  });

  it('undoes and redoes shelf changes, saying which, apart from any document', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const sources = () => store.getState().shelf.map((p) => p.fragment.source);
    expect(store.getState()).toMatchObject({ shelfUndo: null, shelfRedo: null });
    const a = store.addToShelf(frag('a'));
    store.addToShelf(frag('b'));
    expect(store.getState().shelfUndo).toBe('Add b fragment');
    store.clearShelf();
    expect(store.getState().shelfUndo).toBe('Clear the shelf');
    // A document's history is its own: the shelf did not touch it.
    expect(store.getState().history?.canUndo).toBe(false);
    store.undoShelf();
    expect(sources()).toEqual(['a', 'b']);
    expect(store.getState()).toMatchObject({
      shelfUndo: 'Add b fragment',
      shelfRedo: 'Clear the shelf',
    });
    store.redoShelf();
    expect(sources()).toEqual([]);
    store.undoShelf();
    store.removeFromShelf(a);
    // A new change drops what was undone.
    expect(store.getState()).toMatchObject({ shelfUndo: 'Remove a fragment', shelfRedo: null });
    store.redoShelf();
    expect(sources()).toEqual(['b']);
    store.undoShelf();
    store.undoShelf();
    store.undoShelf();
    store.undoShelf(); // past the start: nothing
    expect(sources()).toEqual([]);
    expect(store.getState().shelfUndo).toBeNull();
  });

  it('keeps each Bench panel as it was set, and changes nothing for a no-op', () => {
    const store = new EditorStore();
    const before = store.getState().bench;
    store.updateBench('gibson', { minOverlap: before.gibson.minOverlap });
    expect(store.getState().bench).toBe(before);
    store.updateBench('gibson', { minOverlap: 25, excluded: ['x'] });
    store.setCloningReaction('gateway');
    store.setCloningReaction('pcr');
    expect(store.getState().bench).toMatchObject({
      reaction: 'gateway',
      gibson: { minOverlap: 25, excluded: ['x'], circular: true },
      ligation: before.ligation,
    });
    expect(store.getState().sidebarReaction).toBe('pcr');
  });
});

describe('EditorStore edit-mark baseline', () => {
  function opened(): EditorStore {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    return store;
  }
  const save = (store: EditorStore): void => {
    store.markDownloaded(store.getState().documentId ?? '', 'x.gb');
  };

  it('measures from the opened state by default, across a save', () => {
    const store = opened();
    expect(store.editsBaselineDocument()).toBe(doc);
    store.apply({ type: 'insert', position: 0, text: 'TTT' });
    save(store);
    expect(store.editsBaselineDocument()).toBe(doc);
  });

  it('measures from the file on disk when asked, so a save clears the marks', () => {
    const store = opened();
    store.setEditsBaseline('saved');
    store.apply({ type: 'insert', position: 0, text: 'TTT' });
    expect(store.editsBaselineDocument()).toBe(doc);
    save(store);
    expect(store.editsBaselineDocument()).toBe(store.document);
  });

  it('has nothing to measure against while off, or with no file to compare to', () => {
    const store = opened();
    store.setEditsBaseline('off');
    expect(store.editsBaselineDocument()).toBeNull();
    store.setEditsBaseline('saved');
    store.openDocument(doc); // pasted or an example: nowhere to be saved yet
    expect(store.getState().savedDoc).toBeNull();
    expect(store.editsBaselineDocument()).toBeNull();
    // A new document starts out as the empty one it was, so typing is marked.
    store.newDocument();
    const empty = store.document;
    store.apply({ type: 'insert', position: 0, text: 'ACGT' });
    expect(store.editsBaselineDocument()).toBe(empty);
  });

  it('moves the baseline to the present state on "mark from here"', () => {
    const store = opened();
    store.apply({ type: 'insert', position: 0, text: 'TTT' });
    const marked = store.document;
    store.markEditsFromHere();
    expect(store.getState().editsBaseline).toBe('marked');
    expect(store.editsBaselineDocument()).toBe(marked);
    store.apply({ type: 'insert', position: 0, text: 'AAA' });
    expect(store.editsBaselineDocument()).toBe(marked);
    // Falls back to the opened state until it has been used for this document.
    store.openDocument(doc, 'y.gb');
    expect(store.editsBaselineDocument()).toBe(doc);
  });

  it('has no baseline with nothing open', () => {
    const store = new EditorStore();
    store.setEditsBaseline('opened');
    expect(store.editsBaselineDocument()).toBeNull();
    store.markEditsFromHere();
    expect(store.getState().editsBaseline).toBe('opened');
  });
});

describe('EditorStore tabs', () => {
  const other = SeqDocument.create({ name: 'other', sequence: 'GGGGCCCC' });
  const third = SeqDocument.create({ name: 'third', sequence: 'TTTT' });
  const ids = (store: EditorStore) => store.getState().documents.map((d) => d.documentId);

  it('opens every document in its own tab and brings the newest to the front', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    expect(ids(store)).toEqual([a, b]);
    expect(store.getState().documentId).toBe(b);
    expect(store.document).toBe(other);
    store.activateDocument(a);
    expect(store.document).toBe(doc);
    expect(store.getState().fileName).toBe('a.gb');
    store.activateDocument('missing');
    expect(store.getState().documentId).toBe(a);
  });

  it('keeps each tab on the sidebar panel it was left on', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    store.setSidebarTab('cloning');
    // A new tab opens on the panel the last one was on, since opening a
    // second file is usually part of the same piece of work.
    const b = store.openDocument(other, 'b.gb');
    expect(store.getState().sidebarTab).toBe('cloning');
    store.setSidebarTab('features');
    expect(store.getState().sidebarTab).toBe('features');
    // Which must not have moved the tab it came from.
    store.activateDocument(a);
    expect(store.getState().sidebarTab).toBe('cloning');
    store.activateDocument(b);
    expect(store.getState().sidebarTab).toBe('features');
  });

  it("keeps each tab's selection, history and enzyme ticks across a switch", () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    store.setSelection({ start: 2, end: 2 });
    store.apply({ type: 'insert', position: 0, text: 'AA' });
    store.setShownEnzymes(['EcoRI']);
    store.setFindOpen(true);
    store.activateDocument(a);
    expect(store.getState()).toMatchObject({
      selection: null,
      findOpen: false,
      dirty: false,
      shownEnzymes: new Set(),
    });
    expect(store.getState().history?.canUndo).toBe(false);
    store.activateDocument(b);
    expect(store.getState()).toMatchObject({
      selection: { start: 4, end: 4 },
      findOpen: true,
      dirty: true,
      shownEnzymes: new Set(['EcoRI']),
    });
    expect(store.document?.sequence.toString()).toBe('AAGGGGCCCC');
    // Undo reaches the file's contents, under the copy's own name.
    store.undo();
    expect(store.document?.sequence.toString()).toBe(other.sequence.toString());
    expect(store.document?.name).toBe('other copy');
  });

  it("shows the file list with the tabs kept, and the front tab's dirtiness only", () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    store.setSelection({ start: 0, end: 0 });
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.openDocument(other, 'b.gb');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documents.map((d) => d.savedDoc !== d.history.present)).toEqual([
      true,
      false,
    ]);
    store.showFiles();
    expect(store.document).toBeNull();
    expect(store.getState()).toMatchObject({ documentId: null, history: null, dirty: false });
    expect(ids(store)).toHaveLength(2);
    store.setSelection({ start: 0, end: 1 }); // nothing in front: ignored
    store.activateDocument(a);
    expect(store.getState().selection).toEqual({ start: 1, end: 1 });
    store.closeAllDocuments();
    expect(ids(store)).toEqual([]);
  });

  it('moves a tab along the strip without changing which is in front', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    const c = store.openDocument(third, 't.gb');
    store.moveDocument(a, 2);
    expect(ids(store)).toEqual([b, c, a]);
    expect(store.getState().documentId).toBe(c);
    store.moveDocument(a, -5); // out of range: to the end it is nearest
    expect(ids(store)).toEqual([a, b, c]);
    store.moveDocument(c, 99);
    expect(ids(store)).toEqual([a, b, c]);
    const before = store.getState();
    store.moveDocument('missing', 0);
    store.moveDocument(b, 1); // where it already is
    expect(store.getState()).toBe(before);
  });

  it('shows the Bench in front of the documents, which stay open behind it', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    expect(store.getState().front).toBe('document');
    store.showBench();
    expect(store.getState()).toMatchObject({ front: 'bench', documentId: null, history: null });
    expect(ids(store)).toEqual([a]);
    store.setSelection({ start: 0, end: 1 }); // no document in front: ignored
    store.closeDocument(); // nor is there one to close
    expect(ids(store)).toEqual([a]);
    store.showFiles();
    expect(store.getState().front).toBe('files');
    store.showBench();
    store.activateDocument(a);
    expect(store.getState()).toMatchObject({ front: 'document', documentId: a });
    // Opening a document brings it in front of the Bench too.
    store.showBench();
    const b = store.openDocument(other, 'b.gb');
    expect(store.getState()).toMatchObject({ front: 'document', documentId: b });
    // Closing a tab behind the Bench leaves the Bench in front.
    store.showBench();
    store.closeDocument(a);
    store.closeAllDocuments();
    expect(store.getState()).toMatchObject({ front: 'bench', documents: [] });
  });

  it('closing the front tab brings the right-hand neighbour forward, else the left, else the list', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    const c = store.openDocument(third, 'c.gb');
    store.activateDocument(b);
    store.closeDocument();
    expect(ids(store)).toEqual([a, c]);
    expect(store.getState().documentId).toBe(c);
    store.closeDocument(c);
    expect(store.getState().documentId).toBe(a);
    // Closing a background tab leaves the front one alone.
    const d = store.openDocument(third, 'd.gb');
    store.closeDocument(a);
    expect(store.getState().documentId).toBe(d);
    store.closeDocument('missing');
    expect(ids(store)).toEqual([d]);
    store.closeDocument();
    expect(store.document).toBeNull();
    expect(ids(store)).toEqual([]);
  });

  it('lets an untouched new document give up its tab to an opened one', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const fresh = store.newDocument();
    const b = store.openDocument(other, 'b.gb');
    expect(ids(store)).toEqual([a, b]);
    expect(store.documentState(fresh)).toBeNull();
    // Typed into, renamed or given a file name, it is a document of its own.
    const typed = store.newDocument();
    store.apply({ type: 'insert', position: 0, text: 'A' });
    const c = store.openDocument(third, 'c.gb');
    expect(ids(store)).toEqual([a, b, typed, c]);
    // Only the tab in front is taken over.
    const blank = store.newDocument();
    store.activateDocument(a);
    store.openDocument(third, 'd.gb');
    expect(ids(store)).toContain(blank);
  });

  it('brings an already open document forward instead of opening it twice', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb', [], { id: 'stored-a' });
    store.openDocument(other, 'b.gb');
    expect(store.openDocument(third, null, [], { id: 'stored-a' })).toBe(a);
    expect(store.getState().documentId).toBe('stored-a');
    expect(store.document).toBe(doc);
    // The same file unedited is that tab.
    store.openDocument(other, 'b.gb');
    expect(store.openDocument(doc, 'a.gb')).toBe(a);
    expect(ids(store)).toHaveLength(2);
    // Once edited the tab holds a working copy, not that file, so opening
    // the file again gives the user the original back in a tab of its own.
    store.apply({ type: 'insert', position: 0, text: 'A' });
    const reopened = store.openDocument(doc, 'a.gb');
    expect(reopened).not.toBe(a);
    expect(store.document).toBe(doc);
    expect(store.documentState(a)?.history.present.length).toBe(doc.length + 1);
    expect(ids(store)).toHaveLength(3);
    // A different file name, or no file at all, is a new tab.
    store.openDocument(doc, 'copy.gb');
    store.openDocument(doc);
    store.openDocument(doc);
    expect(ids(store)).toHaveLength(6);
  });

  it('files analysis results and edits by id, in front or not', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    store.setAnalysis(doc, [site('EcoRI', 3)], []);
    expect(store.getState().analysis).toBeNull(); // b is in front
    expect(store.documentState(a)?.analysis?.cutSites).toHaveLength(1);
    expect([...(store.documentState(a)?.shownEnzymes ?? [])]).toEqual(['EcoRI']);
    store.apply({ type: 'rename', name: 'renamed' }, undefined, a);
    expect(store.document).toBe(other);
    expect(store.documentState(a)?.history.present.name).toBe('renamed');
    // That rename forked a's working copy and named it, which is the whole
    // of the fork: the copy is called this from its first state on.
    expect(store.documentState(a)?.history.canUndo).toBe(false);
    store.apply({ type: 'rename', name: 'x' }, undefined, 'missing');
    expect(store.documentState(b)?.history.canUndo).toBe(false);
    // A new ORF threshold sends every tab back to the worker.
    store.setAnalysis(other, [], []);
    store.setOrfMinCodons(10);
    expect(store.getState().documents.map((d) => d.analysis)).toEqual([null, null]);
  });

  it('re-keys a tab in storage unless the id is taken', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    const b = store.openDocument(other, 'b.gb');
    store.setDocumentId(b, 'stored');
    expect(ids(store)).toEqual([a, 'stored']);
    expect(store.getState().documentId).toBe('stored');
    store.setDocumentId(a, 'stored');
    expect(ids(store)).toEqual([a, 'stored']);
    store.setDocumentId('missing', 'z');
    expect(ids(store)).toEqual([a, 'stored']);
  });

  it('marks a download and reviews one by id', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.openDocument(other, 'b.gb');
    store.markDownloaded(a, 'renamed.gb');
    expect(store.documentState(a)).toMatchObject({ fileName: 'renamed.gb' });
    expect(store.documentState(a)?.savedDoc).toBe(store.documentState(a)?.history.present);
    store.requestSaveReview(a, 'a.gb');
    expect(store.getState().saveReview).toBeNull(); // the review belongs to a's tab
    store.activateDocument(a);
    expect(store.getState().saveReview).toEqual({ fileName: 'a.gb' });
    store.dismissSaveReview();
    expect(store.getState().saveReview).toBeNull();
  });
});

describe('EditorStore typing runs', () => {
  const linear = SeqDocument.create({ sequence: 'ACGTACGTAC' });

  /** Types `text` one base at a time, the way the sequence view does. */
  function type(store: EditorStore, text: string): void {
    for (const base of text) {
      store.applyPlan(typeText(store.document ?? linear, store.getState().selection, base));
    }
  }

  it('makes a run of typing one undo step', () => {
    const store = new EditorStore();
    store.openDocument(linear, 'x.gb');
    store.setSelection({ start: 4, end: 4 });
    type(store, 'GGGG');
    expect(store.document?.sequence.toString()).toBe('ACGTGGGGACGTAC');
    expect(store.getState().history?.size).toBe(1);
    expect(store.getState().history?.undoLabel).toBe('Insert 4 bases');
    store.undo();
    expect(store.document?.sequence.toString()).toBe('ACGTACGTAC');
  });

  it('starts a new step when the caret moves away', () => {
    const store = new EditorStore();
    store.openDocument(linear, 'x.gb');
    store.setSelection({ start: 4, end: 4 });
    type(store, 'GG');
    store.setSelection({ start: 0, end: 0 });
    type(store, 'TT');
    expect(store.getState().history?.size).toBe(2);
    store.undo();
    expect(store.document?.sequence.toString()).toBe('ACGTGGACGTAC');
  });

  it('keeps the saved version reachable when typing carries on after a save', () => {
    const store = new EditorStore();
    const id = store.openDocument(linear, 'x.gb');
    store.setSelection({ start: 0, end: 0 });
    type(store, 'GG');
    store.markDownloaded(id, 'x.gb');
    const saved = store.document;
    type(store, 'TT');
    expect(store.getState().history?.size).toBe(2);
    // The version on disk is still a step the history panel can point at.
    expect(store.getState().history?.stateAt(1)).toBe(saved);
  });

  it('does not fold a change into a run the user has undone out of', () => {
    const store = new EditorStore();
    store.openDocument(linear, 'x.gb');
    store.setSelection({ start: 0, end: 0 });
    type(store, 'GG');
    store.apply({ type: 'rename', name: 'renamed' });
    store.undo();
    store.setSelection({ start: 2, end: 2 });
    type(store, 'T');
    expect(store.getState().history?.size).toBe(2);
    store.undo();
    expect(store.document?.sequence.toString()).toBe('GGACGTACGTAC');
  });

  it('runs Backspace and Delete separately from typing', () => {
    const store = new EditorStore();
    store.openDocument(linear, 'x.gb');
    store.setSelection({ start: 5, end: 5 });
    for (let i = 0; i < 3; i++) {
      store.applyPlan(deleteBackward(store.document ?? linear, store.getState().selection));
    }
    // Backspace at 5 eats positions 4, 3 and 2 in turn.
    expect(store.document?.sequence.toString()).toBe('ACCGTAC');
    expect(store.getState().history?.size).toBe(1);
    expect(store.getState().history?.undoLabel).toBe('Delete 3 bases');

    for (let i = 0; i < 2; i++) {
      store.applyPlan(deleteForward(store.document ?? linear, store.getState().selection));
    }
    // Delete stays at the caret and eats what shuffles into it.
    expect(store.document?.sequence.toString()).toBe('ACTAC');
    expect(store.getState().history?.undoLabel).toBe('Delete 2 bases');
    // Backspace and Delete are runs of their own.
    expect(store.getState().history?.size).toBe(2);
    store.undo();
    expect(store.document?.sequence.toString()).toBe('ACCGTAC');
  });
});

describe('EditorStore working copies', () => {
  const named = SeqDocument.create({ name: 'pOrig', sequence: 'ACGTACGTACGTACGTACGT' });

  function opened() {
    const store = new EditorStore();
    store.openDocument(named, 'pOrig.gb');
    return store;
  }

  it('forks a working copy on the first edit', () => {
    const store = opened();
    expect(store.getState()).toMatchObject({ derived: false });
    expect(store.getState().origin?.fileName).toBe('pOrig.gb');
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.document?.name).toBe('pOrig copy');
    expect(store.getState()).toMatchObject({ derived: true });
  });

  it('stamps the copy with the molecule and the file it came from', () => {
    const store = opened();
    expect(store.document?.metadata.derivedFrom).toBeNull();
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.document?.metadata.derivedFrom).toEqual({
      checksum: documentChecksum(named)?.text,
      fileName: 'pOrig.gb',
    });
    // It is the original's checksum, not the copy's, and it stays that way
    // as the copy is edited further.
    store.apply({ type: 'insert', position: 0, text: 'C' });
    expect(store.document?.metadata.derivedFrom?.checksum).toBe(documentChecksum(named)?.text);
    expect(store.document?.metadata.derivedFrom?.checksum).not.toBe(
      documentChecksum(store.document ?? named)?.text,
    );
  });

  it('starts the copy a history of its own, at the contents of the file', () => {
    const store = opened();
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.getState().history?.size).toBe(1);
    store.undo();
    // Undo reaches what the file holds and stops there: the copy keeps its
    // own name, so no state in this tab is the original again.
    expect(store.document?.sequence.toString()).toBe(named.sequence.toString());
    expect(store.document?.name).toBe('pOrig copy');
    expect(store.getState().history?.canUndo).toBe(false);
    // Editing on carries the same name rather than taking another copy name.
    store.apply({ type: 'insert', position: 5, text: 'TT' });
    expect(store.document?.name).toBe('pOrig copy');
    expect(store.getState()).toMatchObject({ derived: true });
  });

  it('names the copy what the user called it when a rename is the first edit', () => {
    const store = opened();
    store.apply({ type: 'rename', name: 'my construct' });
    expect(store.document?.name).toBe('my construct');
    expect(store.getState()).toMatchObject({ derived: true });
    // The name is the copy's first state, so there is no rename to undo.
    expect(store.getState().history?.canUndo).toBe(false);
    expect(store.getState().history?.present.sequence.toString()).toBe(named.sequence.toString());
  });

  it('keeps a name the user chose, through later edits', () => {
    const store = opened();
    store.apply({ type: 'rename', name: 'my construct' });
    expect(store.document?.name).toBe('my construct');
    expect(store.getState()).toMatchObject({ derived: true });
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.document?.name).toBe('my construct');
  });

  it('numbers the copy when another tab has that name', () => {
    const store = opened();
    store.openDocument(named.rename('pOrig copy'), 'elsewhere.gb');
    store.activateDocument(store.getState().documents[0]?.documentId ?? null);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.document?.name).toBe('pOrig copy 2');
  });

  it('leaves a document with no file of its own alone', () => {
    const store = new EditorStore();
    store.openDocument(named);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.document?.name).toBe('pOrig');
    expect(store.getState()).toMatchObject({ derived: false, origin: null });
  });
});

describe('EditorStore preview', () => {
  const span = {
    id: 'forward',
    label: 'Fwd 1',
    range: { start: 2, end: 8 },
    strand: 'forward' as const,
    shape: 'arrow' as const,
  };

  it('points the views at spans and takes them away again', () => {
    const store = new EditorStore();
    const id = store.openDocument(doc, 'x.gb');
    store.setPreview('primers', [span]);
    expect(store.getState().preview).toEqual({
      owners: ['primers'],
      documentId: id,
      items: [{ ...span, id: `primers:${span.id}` }],
    });
    store.setPreview('primers', []);
    expect(store.getState().preview).toBeNull();
  });

  it('does not notify when the same spans are set again', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    store.setPreview('primers', [span]);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setPreview('primers', [{ ...span, range: { start: 2, end: 8 } }]);
    expect(listener).not.toHaveBeenCalled();
    store.setPreview('primers', [{ ...span, range: { start: 3, end: 9 } }]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shows a preview only over the document it was computed for', () => {
    const store = new EditorStore();
    const first = store.openDocument(doc, 'x.gb');
    store.setPreview('primers', [span]);
    const second = store.openDocument(doc.rename('other'), 'y.gb');
    expect(store.getState().preview).toBeNull();
    store.activateDocument(first);
    expect(store.getState().preview?.documentId).toBe(first);
    store.closeDocument(second);
    expect(store.getState().preview?.documentId).toBe(first);
  });

  it('drops a preview when the sequence under it moves', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    store.setPreview('primers', [span]);
    store.apply({ type: 'insert', position: 0, text: 'AAAA' });
    expect(store.getState().preview).toBeNull();
  });

  it('lets only the panel that set a preview take it away', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    store.setPreview('find', [span]);
    // The find bar closing must not clear what the Primers tab is showing,
    // and the other way round.
    store.clearPreview('primers');
    expect(store.getState().preview?.owners).toEqual(['find']);
    store.clearPreview('find');
    expect(store.getState().preview).toBeNull();
  });

  it("draws two panels' previews at once, and tells a click on one to the panel it belongs to", () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    store.setPreview('find', [span]);
    store.setPreview('primers', [{ ...span, clickable: true }]);
    const merged = store.getState().preview;
    expect(merged?.owners).toEqual(['find', 'primers']);
    // The same id from two panels is two spans.
    expect(merged?.items.map((i) => i.id)).toEqual([`find:${span.id}`, `primers:${span.id}`]);
    store.activatePreview(`primers:${span.id}`);
    expect(store.getState().previewActivated).toMatchObject({ owner: 'primers', id: span.id });
    // Unchanged previews give the views the same object, so they redraw no more than they must.
    store.setSelection({ start: 0, end: 1 });
    expect(store.getState().preview).toBe(merged);
    store.clearPreview('find');
    expect(store.getState().preview?.owners).toEqual(['primers']);
  });
});
