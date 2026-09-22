/**
 * What the user said to keeping this origin's storage, remembered across
 * sessions in localStorage.
 *
 * - `keep`: they asked for it. The browser is asked again silently each
 *   session until it agrees: Chromium grants it by its own rules (an
 *   installed app, a bookmark, a site used often), so a request refused
 *   today may be granted after the app is installed, and Firefox only asks
 *   again if its dialog was closed without an answer.
 * - `no`: they said not now. The browser is never asked, so the dialog
 *   cannot come back on them; storage stays evictable, as it was before.
 * - `null`: not asked yet, so the banner is due.
 */
export type StorageChoice = 'keep' | 'no';

const KEY = 'plasmidpop.storageChoice';

export function storageChoice(): StorageChoice | null {
  try {
    const v = globalThis.localStorage.getItem(KEY);
    return v === 'keep' || v === 'no' ? v : null;
  } catch {
    return null; // Storage unavailable (private mode, blocked cookies).
  }
}

export function rememberStorageChoice(choice: StorageChoice): void {
  try {
    globalThis.localStorage.setItem(KEY, choice);
  } catch {
    // Best effort, like the rest of local persistence.
  }
}
