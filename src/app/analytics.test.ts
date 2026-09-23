// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  Analytics,
  EVENTS,
  doNotTrack,
  formatOfFileName,
  readConfig,
  trackableUrl,
} from './analytics';

const CONFIG = { url: 'https://stats.example.org/matomo/', siteId: '6' };

function paq(): readonly (readonly unknown[])[] {
  return (globalThis as { _paq?: readonly (readonly unknown[])[] })._paq ?? [];
}

describe('readConfig', () => {
  it('is null unless both URL and site id are set', () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ VITE_MATOMO_URL: 'https://x/' })).toBeNull();
    expect(readConfig({ VITE_MATOMO_SITE_ID: '6' })).toBeNull();
    expect(readConfig({ VITE_MATOMO_URL: ' ', VITE_MATOMO_SITE_ID: '6' })).toBeNull();
  });

  it('normalises the trailing slash', () => {
    expect(readConfig({ VITE_MATOMO_URL: 'https://x/m', VITE_MATOMO_SITE_ID: '6' })).toEqual({
      url: 'https://x/m/',
      siteId: '6',
    });
  });
});

describe('trackableUrl', () => {
  // A share link carries the whole document after the `#`; Matomo takes
  // `location.href` whole unless told not to, so this is what stands between
  // a shared plasmid and the analytics instance.
  it('cuts off the fragment', () => {
    expect(trackableUrl('https://x.org/PlasmidPop/#d=1AAAAsequence')).toBe(
      'https://x.org/PlasmidPop/',
    );
    expect(trackableUrl('https://x.org/PlasmidPop/')).toBe('https://x.org/PlasmidPop/');
    expect(trackableUrl('https://x.org/p/?a=1#d=xyz')).toBe('https://x.org/p/?a=1');
  });

  it('reports a page view with no fragment even when the page has one', () => {
    globalThis.location.hash = '#d=1AAAAsecret';
    const load = vi.fn();
    new Analytics(CONFIG, false, load);
    const urls = paq()
      .filter((e) => e[0] === 'setCustomUrl')
      .map((e) => String(e[1]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('#');
    expect(urls[0]).not.toContain('secret');
    globalThis.location.hash = '';
  });
});

describe('doNotTrack', () => {
  it('reads the navigator flag', () => {
    expect(doNotTrack({ doNotTrack: '1' })).toBe(true);
    expect(doNotTrack({ doNotTrack: 'yes' })).toBe(true);
    expect(doNotTrack({ doNotTrack: '0' })).toBe(false);
    expect(doNotTrack({})).toBe(false);
  });
});

describe('Analytics', () => {
  beforeEach(() => {
    delete (globalThis as { _paq?: unknown })._paq;
  });
  afterEach(() => {
    delete (globalThis as { _paq?: unknown })._paq;
  });

  it('is silent without config', () => {
    const load = vi.fn();
    const a = new Analytics(null, false, load);
    expect(a.enabled).toBe(false);
    a.track('file', 'open', 'genbank');
    expect(paq()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('is silent under Do-Not-Track', () => {
    const load = vi.fn();
    const a = new Analytics(CONFIG, true, load);
    expect(a.enabled).toBe(false);
    a.track('file', 'open', 'genbank');
    expect(paq()).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('configures the tracker cookieless, loads the script and records events', () => {
    const load = vi.fn();
    const a = new Analytics(CONFIG, false, load);
    expect(a.enabled).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(CONFIG.url);
    expect(paq()).toEqual([
      ['disableCookies'],
      ['setDoNotTrack', true],
      ['setTrackerUrl', 'https://stats.example.org/matomo/matomo.php'],
      ['setSiteId', '6'],
      ['discardHashTag', true],
      ['setCustomUrl', trackableUrl()],
      ['trackPageView'],
      ['enableLinkTracking'],
    ]);

    a.track('file', 'open', 'genbank');
    a.track('file', 'download');
    expect(paq().slice(-2)).toEqual([
      ['trackEvent', 'file', 'open', 'genbank'],
      ['trackEvent', 'file', 'download'],
    ]);
  });

  it('sends a trackOnce event the first time only, per name', () => {
    const a = new Analytics(CONFIG, false, vi.fn());
    const before = paq().length;
    a.trackOnce('panel', 'open', 'primers');
    a.trackOnce('panel', 'open', 'primers');
    a.trackOnce('panel', 'open', 'enzymes');
    a.shortcut('alt+c');
    a.shortcut('alt+c');
    expect(paq().slice(before)).toEqual([
      ['trackEvent', 'panel', 'open', 'primers'],
      ['trackEvent', 'panel', 'open', 'enzymes'],
      ['trackEvent', 'shortcut', 'use', 'alt+c'],
    ]);
  });

  it('reports the kind of visit once', () => {
    const a = new Analytics(CONFIG, false, vi.fn());
    const before = paq().length;
    a.start('1.2.0', true);
    a.start('1.2.0', true);
    expect(paq().slice(before)).toEqual([
      ['trackEvent', 'app', 'start', '1.2.0'],
      ['trackEvent', 'app', 'layout', 'phone'],
      ['trackEvent', 'app', 'display', 'browser'],
    ]);
  });

  it('keeps trackOnce silent when disabled', () => {
    const a = new Analytics(null, false, vi.fn());
    a.trackOnce('edit', 'insert');
    a.start('1.2.0', false);
    expect(paq()).toEqual([]);
  });
});

describe('EVENTS', () => {
  it('lists every kind of edit, plus undo and redo', () => {
    expect(EVENTS.edit).toContain('reverseComplement');
    expect(EVENTS.edit).toContain('removeFeature');
    expect(EVENTS.edit.slice(-2)).toEqual(['undo', 'redo']);
  });
});

describe('formatOfFileName', () => {
  // The extension is the one part of a file name that is reported, and only
  // as one of the formats the app knows.
  it('reduces an extension to a known format', () => {
    expect(formatOfFileName('pUC19.GB')).toBe('genbank');
    expect(formatOfFileName('x.fasta')).toBe('fasta');
    expect(formatOfFileName('my plasmid.dna')).toBe('snapgene');
    expect(formatOfFileName('lab-notes-for-project-x.docx')).toBe('other');
    expect(formatOfFileName('no-extension')).toBe('other');
  });
});
