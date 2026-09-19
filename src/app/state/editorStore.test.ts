import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { parseGenBank } from '@/io';

import { ERROR_FADE_MS, EditorStore } from './editorStore';

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
      fileHandle: null,
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
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.markSaved(store.getState().documentId ?? '', 'y.gb');
    expect(store.getState()).toMatchObject({ dirty: false, fileName: 'y.gb' });
    store.closeDocument();
    expect(store.document).toBeNull();
    expect(store.getState()).toMatchObject({ documentId: null, dirty: false, fileHandle: null });
  });

  it('treats documents without a file as unsaved and keeps a given id and handle', () => {
    const store = new EditorStore();
    const handle = { name: 'h.gb' } as FileSystemFileHandle;
    store.openDocument(doc, null, [], { id: 'fixed', handle });
    expect(store.getState()).toMatchObject({
      dirty: true,
      documentId: 'fixed',
      fileHandle: handle,
    });
    store.setFileHandle('fixed', null);
    expect(store.getState().fileHandle).toBeNull();
    store.setFileHandle('elsewhere', handle); // not open: nothing happens
    expect(store.getState().fileHandle).toBeNull();
  });
});

describe('assembly shelf', () => {
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
    const a = store.addToAssembly(frag('a'));
    const b = store.addToAssembly(frag('b'));
    const c = store.addToAssembly(frag('c'));
    expect(store.getState().assembly.map((p) => p.fragment.source)).toEqual(['a', 'b', 'c']);
    store.moveAssemblyPart(c, -1);
    expect(store.getState().assembly.map((p) => p.fragment.source)).toEqual(['a', 'c', 'b']);
    store.moveAssemblyPart(a, -1); // already first: no-op
    expect(store.getState().assembly.map((p) => p.fragment.source)).toEqual(['a', 'c', 'b']);
    store.flipAssemblyPart(b, { ...frag('b'), sequence: 'TTTT' });
    expect(store.getState().assembly[2]).toMatchObject({ flipped: true });
    expect(store.getState().assembly[2]?.fragment.sequence).toBe('TTTT');
    store.removeFromAssembly(c);
    store.openDocument(SeqDocument.create({ sequence: 'AAAA' }));
    expect(store.getState().assembly.map((p) => p.fragment.source)).toEqual(['a', 'b']);
    store.clearAssembly();
    expect(store.getState().assembly).toEqual([]);
  });
});

describe('EditorStore edit-mark baseline', () => {
  function opened(): EditorStore {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    return store;
  }
  const save = (store: EditorStore): void => {
    store.markSaved(store.getState().documentId ?? '');
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
    store.undo();
    expect(store.document).toBe(other);
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
    // The same file opened again, even after edits, is that tab.
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.openDocument(other, 'b.gb');
    expect(store.openDocument(doc, 'a.gb')).toBe(a);
    expect(store.document?.length).toBe(doc.length + 1);
    expect(ids(store)).toHaveLength(2);
    // A different file name, or no file at all, is a new tab.
    store.openDocument(doc, 'copy.gb');
    store.openDocument(doc);
    store.openDocument(doc);
    expect(ids(store)).toHaveLength(5);
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
    expect(store.documentState(a)?.history.undoLabel).toBe('Rename');
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

  it('marks saved and prompts for overwrite by id', () => {
    const store = new EditorStore();
    const a = store.openDocument(doc, 'a.gb');
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.openDocument(other, 'b.gb');
    store.markSaved(a, 'renamed.gb');
    expect(store.documentState(a)).toMatchObject({ fileName: 'renamed.gb' });
    expect(store.documentState(a)?.savedDoc).toBe(store.documentState(a)?.history.present);
    store.requestOverwrite(a, 'renamed.gb');
    expect(store.getState().overwritePrompt).toBeNull(); // the prompt belongs to a's tab
    store.activateDocument(a);
    expect(store.getState().overwritePrompt).toEqual({ fileName: 'renamed.gb' });
    store.dismissOverwrite();
    expect(store.getState().overwritePrompt).toBeNull();
  });
});
