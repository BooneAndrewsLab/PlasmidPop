/**
 * A notice the user has acknowledged once is not shown again: the download
 * notice, the CRISPR off-target disclaimer. Remembered per browser, not per
 * document, and best effort, like the rest of local persistence.
 */

export function wasSeen(key: string): boolean {
  try {
    return globalThis.localStorage.getItem(key) === '1';
  } catch {
    return false; // Storage unavailable (private mode, blocked cookies).
  }
}

export function rememberSeen(key: string): void {
  try {
    globalThis.localStorage.setItem(key, '1');
  } catch {
    // Nothing to do: the notice is shown again next time.
  }
}
