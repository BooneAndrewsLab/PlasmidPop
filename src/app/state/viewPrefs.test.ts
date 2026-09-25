// @vitest-environment jsdom
import { DEFAULT_PRIMER_CRITERIA, SeqDocument } from '@/core';

import { DEFAULT_BENCH } from './benchSettings';
import { editorStore } from './editorStore';
import { DEFAULT_LAYOUT } from './layout';
import { loadViewPrefs, saveViewPrefs, startViewPrefs } from './viewPrefs';

const KEY = 'plasmidpop.viewPrefs';

const DEFAULTS = {
  view: 'both',
  showComplement: true,
  showTranslations: true,
  showCutSites: true,
  seqFontSize: 13,
  seqBasesPerRow: null,
  numberComplement: false,
  colorBases: false,
  traceSize: 'short',
  baseColors: null,
  editsBaseline: 'opened',
  layout: DEFAULT_LAYOUT,
  sidebarOpen: true,
  enzymeCutFilter: 'any',
  enzymeSupplier: '',
  enzymeSort: 'name',
  enzymeGroupIsoschizomers: true,
  enzymeSortReversed: false,
  gelAgarose: 1,
  gelLadder: 'auto',
  sidebarReaction: 'digest',
  bench: DEFAULT_BENCH,
  geneticCode: 1,
  primerCriteria: DEFAULT_PRIMER_CRITERIA,
  readConfidentQuality: 20,
  readTrimCutoff: 0.05,
  detectOnOpen: false,
  detectMinIdentity: 0.95,
} as const;

function reset(): void {
  localStorage.clear();
  editorStore.setView(DEFAULTS.view);
  editorStore.setShowComplement(DEFAULTS.showComplement);
  editorStore.setShowTranslations(DEFAULTS.showTranslations);
  editorStore.setPhoneLayout(false);
  editorStore.setShowCutSites(DEFAULTS.showCutSites, 'desktop');
  editorStore.setShowCutSites(false, 'phone');
  editorStore.setSeqFontSize(DEFAULTS.seqFontSize);
  editorStore.setSeqBasesPerRow(DEFAULTS.seqBasesPerRow);
  editorStore.setNumberComplement(DEFAULTS.numberComplement);
  editorStore.setColorBases(DEFAULTS.colorBases);
  editorStore.setTraceSize(DEFAULTS.traceSize);
  editorStore.setBaseColors(DEFAULTS.baseColors);
  editorStore.setEditsBaseline(DEFAULTS.editsBaseline);
  editorStore.setLayout(DEFAULT_LAYOUT);
  editorStore.setSidebarOpen(true);
  editorStore.setEnzymeCutFilter(DEFAULTS.enzymeCutFilter);
  editorStore.setEnzymeSupplier(DEFAULTS.enzymeSupplier);
  editorStore.setEnzymeSort(DEFAULTS.enzymeSort);
  editorStore.setEnzymeGroupIsoschizomers(DEFAULTS.enzymeGroupIsoschizomers);
  editorStore.setEnzymeSortReversed(DEFAULTS.enzymeSortReversed);
  editorStore.setGelAgarose(DEFAULTS.gelAgarose);
  editorStore.setGelLadder(DEFAULTS.gelLadder);
  editorStore.setCloningReaction(DEFAULTS.sidebarReaction);
  editorStore.restoreBench(DEFAULTS.bench);
  editorStore.setGeneticCode(DEFAULTS.geneticCode);
  editorStore.setPrimerCriteria(DEFAULTS.primerCriteria);
  editorStore.setReadConfidentQuality(DEFAULTS.readConfidentQuality);
  editorStore.setReadTrimCutoff(DEFAULTS.readTrimCutoff);
  editorStore.setDetectOnOpen(DEFAULTS.detectOnOpen);
  editorStore.setDetectMinIdentity(DEFAULTS.detectMinIdentity);
  editorStore.restorePhonePanes({});
}

describe('view preferences', () => {
  beforeEach(reset);

  it('reads nothing when there is nothing stored', () => {
    expect(loadViewPrefs()).toEqual({});
  });

  it('round-trips through local storage', () => {
    const prefs = {
      view: 'map',
      showComplement: false,
      showTranslations: true,
      showCutSites: false,
      phoneShowCutSites: true,
      seqFontSize: 16,
      seqBasesPerRow: 60,
      numberComplement: true,
      colorBases: true,
      traceSize: 'tall',
      baseColors: { a: '#00aa00', c: '#0000ff', g: '#000000', t: '#ff0000' },
      editsBaseline: 'saved',
      layout: {
        viewsSplit: 0.5,
        viewsSplitStacked: 0.3,
        sidebarWidth: 420,
        sidebarHeightStacked: 260,
      },
      sidebarOpen: false,
      enzymeCutFilter: 'twice',
      enzymeSupplier: 'N',
      enzymeSort: 'bands',
      enzymeGroupIsoschizomers: false,
      enzymeSortReversed: true,
      gelAgarose: 2,
      gelLadder: '1 kb Plus',
      sidebarReaction: 'pcr',
      bench: {
        ...DEFAULT_BENCH,
        reaction: 'gibson',
        gibson: { excluded: ['tab-1'], minOverlap: 25, circular: false, name: 'pNew' },
        gateway: { reaction: 'BP', insertId: 'tab-2', vectorId: 'tab-3' },
      },
      geneticCode: 11,
      primerCriteria: {
        ...DEFAULT_PRIMER_CRITERIA,
        minLength: 20,
        forwardRegion: { near: -30, far: 0 },
        requireGcClamp: true,
      },
      readConfidentQuality: 40,
      readTrimCutoff: 0.01,
      detectOnOpen: true,
      detectMinIdentity: 0.9,
      phonePanes: { 'doc-1': 'sequence', 'doc-2': 'details' },
    } as const;
    saveViewPrefs(prefs);
    expect(loadViewPrefs()).toEqual(prefs);
  });

  it('ignores a damaged or outdated entry', () => {
    localStorage.setItem(KEY, 'not json');
    expect(loadViewPrefs()).toEqual({});
    localStorage.setItem(KEY, '[1,2]');
    expect(loadViewPrefs()).toEqual({});
    localStorage.setItem(
      KEY,
      JSON.stringify({
        view: 'chromosome',
        showComplement: 'yes',
        editsBaseline: 'marked',
        seqFontSize: 9,
        seqBasesPerRow: 4,
        colorBases: 1,
      }),
    );
    expect(loadViewPrefs()).toEqual({});
    // A partial entry keeps the fields it does have.
    localStorage.setItem(KEY, JSON.stringify({ showCutSites: false, extra: 1 }));
    expect(loadViewPrefs()).toEqual({ showCutSites: false });
  });

  it('applies what was stored to the store', () => {
    saveViewPrefs({
      view: 'sequence',
      showComplement: false,
      showTranslations: false,
      showCutSites: false,
      phoneShowCutSites: true,
      seqFontSize: 11,
      seqBasesPerRow: 90,
      numberComplement: true,
      colorBases: true,
      traceSize: 'tall',
      baseColors: { a: '#00aa00', c: '#0000ff', g: '#000000', t: '#ff0000' },
      editsBaseline: 'off',
      layout: {
        viewsSplit: 0.62,
        viewsSplitStacked: 0.5,
        sidebarWidth: 420,
        sidebarHeightStacked: 200,
      },
      sidebarOpen: false,
      enzymeCutFilter: 'once-or-twice',
      enzymeSupplier: 'N',
      enzymeSort: 'bands',
      enzymeGroupIsoschizomers: false,
      enzymeSortReversed: true,
      gelAgarose: 2,
      gelLadder: '1 kb Plus',
      sidebarReaction: 'mutagenesis',
      bench: { ...DEFAULT_BENCH, reaction: 'golden-gate' },
      geneticCode: 2,
      primerCriteria: { ...DEFAULT_PRIMER_CRITERIA, maxHairpin: 3 },
      readConfidentQuality: 30,
      readTrimCutoff: 0.1,
      detectOnOpen: true,
      detectMinIdentity: 1,
      phonePanes: {},
    });
    const stop = startViewPrefs();
    expect(editorStore.getState()).toMatchObject({
      view: 'sequence',
      showComplement: false,
      showTranslations: false,
      showCutSites: false,
      phoneShowCutSites: true,
      seqFontSize: 11,
      seqBasesPerRow: 90,
      numberComplement: true,
      colorBases: true,
      traceSize: 'tall',
      baseColors: { a: '#00aa00', c: '#0000ff', g: '#000000', t: '#ff0000' },
      editsBaseline: 'off',
      layout: {
        viewsSplit: 0.62,
        viewsSplitStacked: 0.5,
        sidebarWidth: 420,
        sidebarHeightStacked: 200,
      },
      sidebarOpen: false,
      enzymeCutFilter: 'once-or-twice',
      enzymeSupplier: 'N',
      enzymeSort: 'bands',
      enzymeGroupIsoschizomers: false,
      enzymeSortReversed: true,
      gelAgarose: 2,
      gelLadder: '1 kb Plus',
      sidebarReaction: 'mutagenesis',
      bench: { ...DEFAULT_BENCH, reaction: 'golden-gate' },
      geneticCode: 2,
      primerCriteria: { ...DEFAULT_PRIMER_CRITERIA, maxHairpin: 3 },
      readConfidentQuality: 30,
      readTrimCutoff: 0.1,
      detectOnOpen: true,
      detectMinIdentity: 1,
    });
    stop();
  });

  it("sends an older entry's one reaction to the sidebar or the Bench", () => {
    localStorage.setItem(KEY, JSON.stringify({ cloningReaction: 'pcr' }));
    expect(loadViewPrefs()).toEqual({ sidebarReaction: 'pcr' });
    localStorage.setItem(KEY, JSON.stringify({ cloningReaction: 'gibson' }));
    expect(loadViewPrefs()).toEqual({
      sidebarReaction: 'digest',
      bench: { ...DEFAULT_BENCH, reaction: 'gibson' },
    });
    // Damaged Bench settings keep what makes sense and default the rest.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        bench: { reaction: 'cloning', gibson: { minOverlap: 7, circular: false } },
      }),
    );
    expect(loadViewPrefs().bench).toEqual({
      ...DEFAULT_BENCH,
      gibson: { ...DEFAULT_BENCH.gibson, circular: false },
    });
  });

  it('leaves the defaults alone when only some fields are stored', () => {
    localStorage.setItem(KEY, JSON.stringify({ showCutSites: false }));
    const stop = startViewPrefs();
    expect(editorStore.getState()).toMatchObject({ ...DEFAULTS, showCutSites: false });
    stop();
  });

  it('records a format choice', () => {
    const stop = startViewPrefs();
    editorStore.setSeqFontSize(16);
    editorStore.setSeqBasesPerRow(30);
    editorStore.setColorBases(true);
    editorStore.setTraceSize('tall');
    expect(loadViewPrefs()).toMatchObject({
      seqFontSize: 16,
      seqBasesPerRow: 30,
      colorBases: true,
      traceSize: 'tall',
    });
    stop();
  });

  it('records a toggle, and stops recording once released', () => {
    const stop = startViewPrefs();
    editorStore.setShowCutSites(false);
    expect(loadViewPrefs()).toMatchObject({ ...DEFAULTS, showCutSites: false });
    editorStore.setView('map');
    expect(loadViewPrefs()).toMatchObject({ view: 'map', showCutSites: false });
    stop();
    editorStore.setShowComplement(false);
    expect(loadViewPrefs()).toMatchObject({ showComplement: true });
  });

  it('remembers the edit-mark baseline, but not a "mark from here"', () => {
    const stop = startViewPrefs();
    editorStore.setEditsBaseline('saved');
    expect(loadViewPrefs()).toMatchObject({ editsBaseline: 'saved' });
    editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'x.gb');
    editorStore.markEditsFromHere();
    expect(editorStore.getState().editsBaseline).toBe('marked');
    // A baseline that only exists in this session comes back as "since opened".
    expect(loadViewPrefs()).toMatchObject({ editsBaseline: 'opened' });
    stop();
    editorStore.closeDocument();
  });

  it('does not remember a comparison marked in the views', () => {
    const stop = startViewPrefs();
    editorStore.setEditsBaseline('saved');
    const doc = SeqDocument.create({ sequence: 'ACGT' });
    editorStore.openDocument(doc, 'x.gb');
    editorStore.markComparedInViews('theirs.gb', doc.insert(2, 'GG'));
    expect(editorStore.getState().editsBaseline).toBe('compared');
    // The other side was a file or a tab of this session: it comes back as "since opened".
    expect(loadViewPrefs()).toMatchObject({ editsBaseline: 'opened' });
    stop();
    editorStore.closeDocument();
  });

  it('will not read a stored "compared" back', () => {
    localStorage.setItem(KEY, JSON.stringify({ editsBaseline: 'compared' }));
    expect(loadViewPrefs().editsBaseline).toBeUndefined();
  });

  it('remembers a hidden sidebar, and brings the layout back on a reset', () => {
    const stop = startViewPrefs();
    editorStore.setSidebarOpen(false);
    editorStore.setLayout({ sidebarWidth: 500, viewsSplit: 0.7 });
    expect(loadViewPrefs()).toMatchObject({ sidebarOpen: false });
    editorStore.resetLayout();
    expect(loadViewPrefs()).toMatchObject({ sidebarOpen: true, layout: DEFAULT_LAYOUT });
    stop();
  });

  it('remembers what the Enzymes tab is looking for, but not a made-up filter', () => {
    const stop = startViewPrefs();
    editorStore.setEnzymeCutFilter('twice');
    editorStore.setEnzymeSupplier('N');
    expect(loadViewPrefs()).toMatchObject({ enzymeCutFilter: 'twice', enzymeSupplier: 'N' });
    stop();
    localStorage.setItem(KEY, JSON.stringify({ enzymeCutFilter: 'sometimes' }));
    expect(loadViewPrefs()).toEqual({});
  });

  it("remembers the Align tab's quality settings, but only values it offers (#56)", () => {
    const stop = startViewPrefs();
    editorStore.setReadConfidentQuality(40);
    editorStore.setReadTrimCutoff(0.02);
    expect(loadViewPrefs()).toMatchObject({ readConfidentQuality: 40, readTrimCutoff: 0.02 });
    // The store will not take a value the select cannot show.
    editorStore.setReadConfidentQuality(21);
    expect(editorStore.getState().readConfidentQuality).toBe(40);
    stop();
    localStorage.setItem(
      KEY,
      JSON.stringify({ readConfidentQuality: 99, readTrimCutoff: '0.05', showCutSites: false }),
    );
    expect(loadViewPrefs()).toEqual({ showCutSites: false });
  });

  it('remembers the Detect features settings, but only identities it offers (item 59)', () => {
    const stop = startViewPrefs();
    editorStore.setDetectOnOpen(true);
    editorStore.setDetectMinIdentity(0.98);
    expect(loadViewPrefs()).toMatchObject({ detectOnOpen: true, detectMinIdentity: 0.98 });
    editorStore.setDetectMinIdentity(0.97);
    expect(editorStore.getState().detectMinIdentity).toBe(0.98);
    stop();
    localStorage.setItem(KEY, JSON.stringify({ detectOnOpen: 'yes', detectMinIdentity: 0.5 }));
    expect(loadViewPrefs()).toEqual({});
  });

  it('records where a splitter was left', () => {
    const stop = startViewPrefs();
    editorStore.setLayout({ viewsSplit: 0.55 });
    editorStore.setLayout({ sidebarWidth: 400 });
    expect(loadViewPrefs()).toMatchObject({
      layout: {
        viewsSplit: 0.55,
        viewsSplitStacked: DEFAULT_LAYOUT.viewsSplitStacked,
        sidebarWidth: 400,
      },
    });
    stop();
  });

  it('refuses stored colours that could not be used as they are', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        baseColors: { a: '#123456', c: 'red', g: '#000000', t: '#ffffff' },
        seqBasesPerRow: 99999,
      }),
    );
    expect(loadViewPrefs()).toEqual({
      seqBasesPerRow: 1000,
    });
  });

  it('holds a stored split to what the layout can show', () => {
    // A hand-edited or damaged entry must not be able to collapse a pane.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        layout: {
          viewsSplit: 4,
          sidebarWidth: 10,
          viewsSplitStacked: 'wide',
          sidebarHeightStacked: 5000,
        },
      }),
    );
    expect(loadViewPrefs()).toEqual({
      layout: {
        viewsSplit: 0.95,
        viewsSplitStacked: DEFAULT_LAYOUT.viewsSplitStacked,
        sidebarWidth: 240,
        sidebarHeightStacked: 900,
      },
    });
  });

  it('writes nothing for changes that are not view preferences', () => {
    const stop = startViewPrefs();
    editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'x.gb');
    expect(localStorage.getItem(KEY)).toBeNull();
    stop();
    editorStore.closeDocument();
  });

  describe('the phone pane (#43)', () => {
    afterEach(() => {
      editorStore.closeAllDocuments();
    });

    it('keeps only panes under ids that could be ids, and no more than are kept', () => {
      const many = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`doc-${String(i)}`, 'sequence']),
      );
      localStorage.setItem(
        KEY,
        JSON.stringify({
          phonePanes: { a: 'sequence', b: 'sideways', '': 'details', ['x'.repeat(65)]: 'details' },
        }),
      );
      expect(loadViewPrefs()).toEqual({ phonePanes: { a: 'sequence' } });
      localStorage.setItem(KEY, JSON.stringify({ phonePanes: ['sequence'] }));
      expect(loadViewPrefs()).toEqual({});
      localStorage.setItem(KEY, JSON.stringify({ phonePanes: many }));
      expect(Object.keys(loadViewPrefs().phonePanes ?? {})).toHaveLength(20);
    });

    it('records the pane each tab was left on, and not the map', () => {
      const stop = startViewPrefs();
      const a = editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'a.gb');
      editorStore.setPhonePane('sequence');
      const b = editorStore.openDocument(SeqDocument.create({ sequence: 'GGCC' }), 'b.gb');
      // A new tab starts on the map, whatever the last one was on.
      expect(editorStore.getState().phonePane).toBe('map');
      editorStore.setPhonePane('details');
      expect(loadViewPrefs().phonePanes).toEqual({ [a]: 'sequence', [b]: 'details' });
      // Back to the first tab: its own pane.
      editorStore.activateDocument(a);
      expect(editorStore.getState().phonePane).toBe('sequence');
      editorStore.setPhonePane('map');
      expect(loadViewPrefs().phonePanes).toEqual({ [b]: 'details' });
      stop();
    });

    it('gives a document reopened from storage the pane it was left on, and nothing else', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ phonePanes: { 'stored-1': 'sequence', 'stored-2': 'details' } }),
      );
      const stop = startViewPrefs();
      // Reopened from local storage under its id, as a reload does.
      editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'a.gb', [], {
        id: 'stored-1',
      });
      expect(editorStore.getState().phonePane).toBe('sequence');
      // A file opened fresh, or a share link, starts on the map.
      editorStore.openDocument(SeqDocument.create({ sequence: 'TTTT' }), null);
      expect(editorStore.getState().phonePane).toBe('map');
      // One not reopened yet keeps its pane for when it is.
      expect(loadViewPrefs().phonePanes).toEqual({ 'stored-1': 'sequence', 'stored-2': 'details' });
      stop();
    });
  });

  describe('cut sites on a phone (#43)', () => {
    afterEach(() => {
      editorStore.setPhoneLayout(false);
    });

    it('hides them on a phone by default, leaving the desktop preference alone', () => {
      expect(editorStore.getState().showCutSites).toBe(true);
      editorStore.setPhoneLayout(true);
      expect(editorStore.getState().showCutSites).toBe(false);
      // The link in the Enzymes tab shows them on the phone only.
      editorStore.setShowCutSites(true);
      expect(editorStore.getState().showCutSites).toBe(true);
      editorStore.setPhoneLayout(false);
      editorStore.setShowCutSites(false);
      editorStore.setPhoneLayout(true);
      expect(editorStore.getState().showCutSites).toBe(true);
      editorStore.setPhoneLayout(false);
      expect(editorStore.getState().showCutSites).toBe(false);
    });

    it('remembers each layout under its own name', () => {
      const stop = startViewPrefs();
      editorStore.setPhoneLayout(true);
      editorStore.setShowCutSites(true);
      expect(loadViewPrefs()).toMatchObject({ showCutSites: true, phoneShowCutSites: true });
      editorStore.setPhoneLayout(false);
      editorStore.setShowCutSites(false);
      expect(loadViewPrefs()).toMatchObject({ showCutSites: false, phoneShowCutSites: true });
      stop();
      // Put back by name, whichever layout is on screen when they load.
      editorStore.setShowCutSites(true, 'desktop');
      editorStore.setShowCutSites(false, 'phone');
      editorStore.setPhoneLayout(true);
      startViewPrefs()();
      expect(editorStore.getState()).toMatchObject({
        desktopShowCutSites: false,
        phoneShowCutSites: true,
        showCutSites: true,
      });
    });

    it('does not carry a desktop choice made before there was a phone setting to the phone', () => {
      // An entry from before 1.6 has the desktop's alone: the phone keeps its default.
      localStorage.setItem(KEY, JSON.stringify({ showCutSites: true }));
      startViewPrefs()();
      editorStore.setPhoneLayout(true);
      expect(editorStore.getState().showCutSites).toBe(false);
    });
  });
});
