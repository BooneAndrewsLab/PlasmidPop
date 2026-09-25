import {
  SHARE_TARGET_CACHE,
  SHARE_TARGET_NAME_HEADER,
  SHARE_TARGET_PARAM,
  SHARE_TARGET_PATH,
} from '@/pwa/shareTarget';

import { analytics } from './analytics';
import { openFile } from './openFile';
import { editorStore } from './state/editorStore';

/**
 * The app's half of the Web Share Target (#43): the service worker stashed
 * the files shared to the app in Cache Storage and sent the page here with
 * `?share-target=<count>` (`src/pwa/shareTarget.ts`). They are opened as if
 * picked with File ▸ Open — the same `openFile`, the same formats — and the
 * stash is cleared. Nothing leaves the device at any point: the POST the
 * mail app made never reached a network, only the service worker.
 */

/** What the redirect said: files are waiting, or the service worker could not take them. */
export type ShareTargetMarker = 'files' | 'failed';

/**
 * Reads the marker off the address bar and takes it off, so a reload does
 * not open the files a second time. Synchronous and first thing, like
 * `takeShareFragment`, which also makes it safe to run twice.
 */
export function takeShareTargetMarker(): ShareTargetMarker | null {
  const { location, history } = globalThis;
  const params = new URLSearchParams(location.search);
  const value = params.get(SHARE_TARGET_PARAM);
  if (value === null) return null;
  params.delete(SHARE_TARGET_PARAM);
  const search = params.toString();
  try {
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${search === '' ? '' : `?${search}`}${location.hash}`,
    );
  } catch {
    // Not fatal: the files still open, the marker just stays put.
  }
  return value === 'failed' ? 'failed' : 'files';
}

/** The stash's position of a file, from the URL it was put under. */
function indexOf(request: Request): number {
  const tail = request.url.slice(request.url.lastIndexOf('/') + 1);
  const n = Number(tail);
  return Number.isInteger(n) ? n : Number.MAX_SAFE_INTEGER;
}

function nameOf(response: Response, index: number): string {
  const raw = response.headers.get(SHARE_TARGET_NAME_HEADER);
  if (raw !== null) {
    try {
      const name = decodeURIComponent(raw);
      if (name !== '') return name;
    } catch {
      // A malformed name: fall through to a made-up one.
    }
  }
  return `shared-${String(index + 1)}`;
}

/**
 * Opens the files the service worker stashed, in the order they were
 * shared, then deletes the stash. Returns how many opened.
 */
export async function openSharedFiles(
  marker: ShareTargetMarker,
  storage: CacheStorage | null = 'caches' in globalThis ? globalThis.caches : null,
): Promise<number> {
  const failed = 'The shared file could not be received. Try opening it with File ▸ Open instead.';
  if (marker === 'failed' || storage === null) {
    editorStore.fail(failed);
    return 0;
  }
  let files: File[];
  try {
    const cache = await storage.open(SHARE_TARGET_CACHE);
    const requests = [...(await cache.keys())]
      .filter((r) => r.url.includes(`/${SHARE_TARGET_PATH}/`))
      .sort((a, b) => indexOf(a) - indexOf(b));
    files = [];
    for (const [i, request] of requests.entries()) {
      const response = await cache.match(request);
      if (response === undefined) continue;
      files.push(new File([await response.blob()], nameOf(response, i)));
    }
  } catch {
    editorStore.fail(failed);
    return 0;
  } finally {
    // Opened or not, the stash has had its one chance: a file left in it
    // would open again on the next share.
    await storage.delete(SHARE_TARGET_CACHE).catch(() => false);
  }
  if (files.length === 0) {
    editorStore.fail('Nothing arrived with the share. Try opening the file with File ▸ Open.');
    return 0;
  }
  analytics.track('phone', 'share-target-open');
  let opened = 0;
  for (const file of files) {
    if ((await openFile(file)) !== null) opened++;
  }
  return opened;
}
