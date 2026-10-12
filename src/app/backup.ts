import { createBackup, recordBackup, restoreBackup } from '@/storage';

import { analytics } from './analytics';
import { downloadBlob } from './saveFile';
import { editorStore } from './state/editorStore';

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** What a backup is called: the day it was made, so several sort and do not overwrite each other. */
export function backupFileName(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `plasmidpop-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

/** File ▸ Back up all documents…: every stored document and collection, as one download (#203). */
export async function backUpAll(): Promise<void> {
  const now = Date.now();
  try {
    const { bytes, manifest } = await createBackup(undefined, now);
    // A copy, so the Blob owns a plain ArrayBuffer whatever the writer returned.
    downloadBlob(
      backupFileName(new Date(now)),
      new Blob([bytes.slice()], { type: 'application/zip' }),
    );
    recordBackup(now);
    analytics.track('file', 'backup');
    editorStore.noteBackup(
      manifest.documents === 0
        ? 'Backed up: there were no documents, only your collections and settings of this browser.'
        : `Backed up ${plural(manifest.documents, 'document')} with their undo history, and your primers, parts and imported tables. Keep the file somewhere other than this browser.`,
    );
  } catch (e) {
    editorStore.fail(`Could not make the backup: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Restores from a backup file and reports what it did; a failure says why and changes nothing it had not already. */
export async function restoreFromFile(file: File): Promise<boolean> {
  try {
    const openIds = new Set(editorStore.getState().documents.map((d) => d.documentId));
    const r = await restoreBackup(await file.arrayBuffer(), undefined, { openIds });
    analytics.track('file', 'restore');
    const parts = [
      `Restored ${plural(r.added + r.replaced, 'document')}`,
      ...(r.replaced > 0
        ? [`${r.replaced.toLocaleString()} of them newer than the copy here`]
        : []),
    ];
    let message = parts.join(' (') + (r.replaced > 0 ? ')' : '') + '.';
    if (r.kept > 0) {
      message += ` ${plural(r.kept, 'document')} here ${r.kept === 1 ? 'was' : 'were'} as new or newer, so kept.`;
    }
    if (r.open > 0) {
      message += ` ${plural(r.open, 'document')} open in a tab ${r.open === 1 ? 'was' : 'were'} left alone; close and restore again to bring ${r.open === 1 ? 'it' : 'them'} back.`;
    }
    if (r.otherRows > 0) message += ` ${plural(r.otherRows, 'row')} of collections added.`;
    if (r.skipped.length > 0) {
      message += ` ${plural(r.skipped.length, 'entry', 'entries')} could not be read (${r.skipped
        .slice(0, 3)
        .map((s) => `${s.name}: ${s.reason}`)
        .join('; ')}${r.skipped.length > 3 ? '; …' : ''}).`;
    }
    editorStore.noteBackup(message);
    return true;
  } catch (e) {
    editorStore.fail(
      `Could not restore "${file.name}": ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/** Asks for a backup file with the browser's picker, then restores it. */
export function pickBackupAndRestore(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) resolve(false);
      else void restoreFromFile(file).then(resolve);
    });
    input.addEventListener('cancel', () => {
      resolve(false);
    });
    input.click();
  });
}
