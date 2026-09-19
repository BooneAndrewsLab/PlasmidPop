// @vitest-environment jsdom
import { SeqDocument } from '@/core';

import { editorStore } from './editorStore';
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
  editsBaseline: 'opened',
} as const;

function reset(): void {
  localStorage.clear();
  editorStore.setView(DEFAULTS.view);
  editorStore.setShowComplement(DEFAULTS.showComplement);
  editorStore.setShowTranslations(DEFAULTS.showTranslations);
  editorStore.setShowCutSites(DEFAULTS.showCutSites);
  editorStore.setSeqFontSize(DEFAULTS.seqFontSize);
  editorStore.setSeqBasesPerRow(DEFAULTS.seqBasesPerRow);
  editorStore.setNumberComplement(DEFAULTS.numberComplement);
  editorStore.setColorBases(DEFAULTS.colorBases);
  editorStore.setEditsBaseline(DEFAULTS.editsBaseline);
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
      seqFontSize: 16,
      seqBasesPerRow: 60,
      numberComplement: true,
      colorBases: true,
      editsBaseline: 'saved',
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
      seqFontSize: 11,
      seqBasesPerRow: 90,
      numberComplement: true,
      colorBases: true,
      editsBaseline: 'off',
    });
    const stop = startViewPrefs();
    expect(editorStore.getState()).toMatchObject({
      view: 'sequence',
      showComplement: false,
      showTranslations: false,
      showCutSites: false,
      seqFontSize: 11,
      seqBasesPerRow: 90,
      numberComplement: true,
      colorBases: true,
      editsBaseline: 'off',
    });
    stop();
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
    expect(loadViewPrefs()).toMatchObject({
      seqFontSize: 16,
      seqBasesPerRow: 30,
      colorBases: true,
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

  it('writes nothing for changes that are not view preferences', () => {
    const stop = startViewPrefs();
    editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'x.gb');
    expect(localStorage.getItem(KEY)).toBeNull();
    stop();
    editorStore.closeDocument();
  });
});
