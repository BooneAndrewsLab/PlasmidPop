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
} as const;

function reset(): void {
  localStorage.clear();
  editorStore.setView(DEFAULTS.view);
  editorStore.setShowComplement(DEFAULTS.showComplement);
  editorStore.setShowTranslations(DEFAULTS.showTranslations);
  editorStore.setShowCutSites(DEFAULTS.showCutSites);
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
    } as const;
    saveViewPrefs(prefs);
    expect(loadViewPrefs()).toEqual(prefs);
  });

  it('ignores a damaged or outdated entry', () => {
    localStorage.setItem(KEY, 'not json');
    expect(loadViewPrefs()).toEqual({});
    localStorage.setItem(KEY, '[1,2]');
    expect(loadViewPrefs()).toEqual({});
    localStorage.setItem(KEY, JSON.stringify({ view: 'chromosome', showComplement: 'yes' }));
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
    });
    const stop = startViewPrefs();
    expect(editorStore.getState()).toMatchObject({
      view: 'sequence',
      showComplement: false,
      showTranslations: false,
      showCutSites: false,
    });
    stop();
  });

  it('leaves the defaults alone when only some fields are stored', () => {
    localStorage.setItem(KEY, JSON.stringify({ showCutSites: false }));
    const stop = startViewPrefs();
    expect(editorStore.getState()).toMatchObject({ ...DEFAULTS, showCutSites: false });
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

  it('writes nothing for changes that are not view preferences', () => {
    const stop = startViewPrefs();
    editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'x.gb');
    expect(localStorage.getItem(KEY)).toBeNull();
    stop();
    editorStore.closeDocument();
  });
});
