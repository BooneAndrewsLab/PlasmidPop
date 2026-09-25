// @vitest-environment jsdom
import { takeShareTargetMarker } from './sharedFiles';

describe('takeShareTargetMarker (#43)', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('takes the marker off the address bar, keeping the rest', () => {
    history.replaceState(null, '', '/PlasmidPop/?share-target=2&lang=en#top');
    expect(takeShareTargetMarker()).toBe('files');
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(
      '/PlasmidPop/?lang=en#top',
    );
    // Taken once: a reload, or React running the effect twice, finds nothing.
    expect(takeShareTargetMarker()).toBeNull();
  });

  it('says when the service worker could not take the files', () => {
    history.replaceState(null, '', '/PlasmidPop/?share-target=failed');
    expect(takeShareTargetMarker()).toBe('failed');
    expect(location.search).toBe('');
  });

  it('is null for a page not opened by a share', () => {
    history.replaceState(null, '', '/PlasmidPop/');
    expect(takeShareTargetMarker()).toBeNull();
  });
});
