import { useEffect, useState } from 'react';

import {
  type BackupStatus,
  type DocumentSummary,
  BACKUP_NUDGE_DAYS,
  backupStatus,
  lastBackupAt,
  mayBeDroppedAfterAWeek,
} from '@/storage';

import { backUpAll, pickBackupAndRestore } from '../backup';
import { openGuide } from '../help/openGuide';
import { useEditorState } from '../state/useEditorStore';
import { BackupNotice } from './BackupNotice';

interface Props {
  /** The stored documents, newest first; the panel counts them and reads when they last changed. */
  readonly documents: readonly DocumentSummary[];
  /** Called after a restore or a backup, so the list above can be read again. */
  readonly onChanged: () => void;
}

function whenText(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Whether the browser granted persistent storage, or null where it cannot say. */
function usePersisted(refreshKey: unknown): boolean | null {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    const storage = (navigator as { storage?: StorageManager }).storage;
    if (storage === undefined || typeof storage.persisted !== 'function') return;
    let live = true;
    storage
      .persisted()
      .then((p) => {
        if (live) setPersisted(p);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refreshKey]);
  return persisted;
}

function installed(): boolean {
  const nav = navigator as { standalone?: boolean };
  try {
    return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return nav.standalone === true;
  }
}

/**
 * Where the documents are and how safe they are (#203): whether the browser
 * promised to keep them, how many there are, when they were last backed up,
 * and the two actions. Everything here is read from this browser; nothing is
 * sent anywhere.
 */
export function StoragePanel({ documents, onChanged }: Props) {
  const { backupNotice } = useEditorState();
  const persisted = usePersisted(backupNotice);
  const status: BackupStatus = backupStatus(
    documents.map((d) => d.updatedAt),
    lastBackupAt(),
  );
  const webkit = mayBeDroppedAfterAWeek({
    userAgent: navigator.userAgent,
    standalone: installed(),
  });
  return (
    <section className="recent storage-status" aria-label="Storage and backup">
      <h2 className="recent__title">Storage and backup</h2>
      <BackupNotice />
      <ul className="storage-status__list">
        <li>
          {status.documents === 0
            ? 'No documents are stored in this browser.'
            : `${status.documents.toLocaleString()} ${status.documents === 1 ? 'document is' : 'documents are'} stored in this browser.`}{' '}
          {persisted === true && 'The browser has agreed to keep them.'}
          {persisted === false && 'The browser may clear them when disk space runs low.'}
        </li>
        <li>
          {status.lastBackupAt === null
            ? 'Never backed up.'
            : `Last backup: ${whenText(status.lastBackupAt)}.`}
          {status.documents > 0 &&
            status.unbackedUp > 0 &&
            status.lastBackupAt !== null &&
            ` ${status.unbackedUp.toLocaleString()} changed since.`}
        </li>
        {status.nudge && (
          <li role="alert">
            Changes from more than {BACKUP_NUDGE_DAYS} days ago are not in any backup. Back up now,
            so a cleared browser does not take them.
          </li>
        )}
        {webkit && (
          <li role="alert">
            This browser may drop the documents of a site you have not visited for seven days,
            unless the app is added to the home screen (or the Dock). Back up, or install it.
          </li>
        )}
      </ul>
      <div className="storage-status__actions">
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            void backUpAll().then(onChanged);
          }}
        >
          Back up all documents…
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => {
            void pickBackupAndRestore().then(onChanged);
          }}
        >
          Restore from backup…
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            openGuide('02-files#local-storage-and-recent-files');
          }}
        >
          What this means
        </button>
      </div>
    </section>
  );
}
