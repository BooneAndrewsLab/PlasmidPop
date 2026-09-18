// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Analytics, doNotTrack, readConfig } from './analytics';

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
      ['trackPageView'],
      ['enableLinkTracking'],
    ]);

    a.track('file', 'open', 'genbank');
    a.track('file', 'save');
    expect(paq().slice(-2)).toEqual([
      ['trackEvent', 'file', 'open', 'genbank'],
      ['trackEvent', 'file', 'save'],
    ]);
  });
});
