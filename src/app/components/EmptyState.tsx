import { useEffect, useRef, useState } from 'react';

import {
  type DocumentSummary,
  RECENT_FILES_LIMIT,
  SCRATCH_LIFETIME_DAYS,
  expiringScratch,
  groupByParent,
} from '@/storage';

import { EXAMPLES } from '../examples';
import { openGuide } from '../help/openGuide';
import { openExample, openPastedText } from '../openFile';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { BrowseFilesDialog } from './BrowseFilesDialog';
import { StoragePanel } from './StoragePanel';
import { StoredList } from './StoredRow';

const REPOSITORY_URL = 'https://github.com/BooneAndrewsLab/PlasmidPop';

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable)
  );
}

export function EmptyState() {
  const example = EXAMPLES[0];
  const [recent, setRecent] = useState<DocumentSummary[] | null>(null);
  // When the listing was read, which the notice about documents going soon is judged by.
  const [listedAt, setListedAt] = useState(() => Date.now());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const { documents, removalNotice } = useEditorState();
  const openIds = new Set(documents.map((d) => d.documentId));

  // A listing that resolves after unmount is dropped: setting state then
  // reaches React after the page (or a test's jsdom) is gone.
  const mounted = useRef(true);

  const refresh = (): void => {
    persistence
      .listStored()
      .then((list) => {
        if (!mounted.current) return;
        setListedAt(Date.now());
        setRecent(list);
      })
      .catch(() => {
        if (mounted.current) setRecent([]);
      });
  };

  useEffect(() => {
    mounted.current = true;
    // Scratch documents past their time go as the page loads, before it lists
    // them (item 110); a failure only leaves them for the next load.
    void persistence
      .pruneScratch()
      .catch(() => 0)
      .then(refresh);
    return () => {
      mounted.current = false;
    };
  }, []);

  // The listing follows the Undo toast: documents are hidden while it is up
  // and listed again when Undo brings them back or the hold ends.
  const noticed = useRef(removalNotice);
  useEffect(() => {
    if (noticed.current === removalNotice) return;
    noticed.current = removalNotice;
    refresh();
  }, [removalNotice]);

  // Ctrl+V with nothing open: a record or bare bases pasted anywhere becomes a document.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTextField(e.target)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim() === '') return;
      e.preventDefault();
      openPastedText(text);
    };
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const report = (p: Promise<unknown>): void => {
    p.then(refresh).catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };

  const kept = (recent ?? []).filter((d) => d.kind === 'file');
  const unkept = (recent ?? []).filter((d) => d.kind === 'scratch');
  const shown = kept.slice(0, RECENT_FILES_LIMIT);
  const expiring = expiringScratch(unkept, listedAt, openIds);

  const open = (id: string): void => {
    persistence.openStored(id).catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };

  // Remove holds the documents for a few seconds with an Undo (item 111).
  const remove = (docs: readonly DocumentSummary[]): void => {
    const only = docs[0];
    const message =
      docs.length === 1 && only !== undefined
        ? `Removed "${only.name}".`
        : `Removed ${docs.length.toLocaleString()} documents.`;
    report(
      persistence.removeStoredWithUndo(
        docs.map((d) => d.id),
        message,
      ),
    );
  };

  const actions = {
    openIds,
    renamingId,
    onOpen: open,
    onStartRename: setRenamingId,
    onRename: (id: string, name: string): void => {
      report(persistence.renameStored(id, name));
    },
    onDoneRename: (): void => {
      setRenamingId(null);
    },
    onKeep: (ids: readonly string[]): void => {
      report(persistence.keepStored(ids));
    },
    onRemove: remove,
  };
  // Everything under Recent files is kept, so there is nothing to Keep.
  const { onKeep: _onKeep, ...recentActions } = actions;

  return (
    <div className="empty">
      <div className="empty__card">
        <p className="empty__lead">
          Drop a GenBank, FASTA or SnapGene file anywhere on this page to open it.
        </p>
        <div className="empty__start">
          <p className="empty__start-text">New here? Learn by doing, or read how it all works.</p>
          <div className="empty__start-buttons">
            {/* The standalone tutorials (#312): a page of the site, not of the app. */}
            <a
              className="button button--primary empty__start-button"
              href={`${import.meta.env.BASE_URL}tutorials/`}
              target="_blank"
              rel="noopener"
            >
              Cloning tutorials
            </a>
            <button
              type="button"
              className="button empty__start-button"
              onClick={() => {
                openGuide('01-getting-started');
              }}
            >
              User guide
            </button>
          </div>
        </div>
        <p className="empty__hint">
          Or paste a sequence, GenBank or FASTA record here (Ctrl+V), or{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              editorStore.requestNewDocument();
            }}
          >
            start a new sequence
          </button>{' '}
          and type it in, or{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              editorStore.requestNcbi();
            }}
          >
            open a record from NCBI
          </button>{' '}
          by its accession number.
        </p>
        <p className="empty__hint">
          Everything stays in your browser: documents are kept here as you work and never uploaded,
          and no file on your disk is written to. Opening from NCBI sends NCBI the accession numbers
          you type, and nothing else. Download the ones you want as files. Your browser may ask
          whether PlasmidPop can keep its data; saying yes protects your documents when disk space
          runs low.
          {example !== undefined && (
            <>
              {' '}
              Or{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  openExample(example);
                }}
              >
                open {example.label}
              </button>{' '}
              to look around.
            </>
          )}
        </p>
        <p className="empty__hint empty__licence">
          Free and open source under the{' '}
          <a
            className="link"
            href={`${REPOSITORY_URL}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer noopener"
          >
            MIT licence
          </a>
          ; the{' '}
          <a className="link" href={REPOSITORY_URL} target="_blank" rel="noreferrer noopener">
            source is on GitHub
          </a>
          .
        </p>
      </div>
      {expiring !== null && (
        <p className="recent__notice" role="status">
          {expiring.ids.length === 1
            ? '1 unkept document'
            : `${expiring.ids.length.toString()} unkept documents`}{' '}
          will be removed from this browser as early as{' '}
          {new Date(expiring.firstAt).toLocaleDateString()}.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              report(persistence.keepStored(expiring.ids));
            }}
          >
            Keep {expiring.ids.length === 1 ? 'it' : 'them'}
          </button>
        </p>
      )}
      {shown.length > 0 && (
        <section className="recent" aria-label="Recent files">
          <h2 className="recent__title">Recent files</h2>
          <StoredList
            entries={shown.map((row) => ({ type: 'row' as const, row }))}
            actions={recentActions}
          />
        </section>
      )}
      {unkept.length > 0 && (
        <details className="recent recent--unkept" aria-label="Unkept documents">
          <summary className="recent__title">Unkept ({unkept.length})</summary>
          <p className="recent__note">
            Made along the way by cloning, PCR and the like, or fetched for primer design. They are
            removed {SCRATCH_LIFETIME_DAYS} days after you last touched them unless you keep them;
            editing, renaming or downloading one keeps it too.{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                report(persistence.keepStored(unkept.map((d) => d.id)));
              }}
            >
              Keep all
            </button>
          </p>
          <StoredList entries={groupByParent(unkept)} actions={actions} />
        </details>
      )}
      {(recent?.length ?? 0) > 0 && (
        <p className="recent__browse">
          <button
            type="button"
            className="button"
            onClick={() => {
              setBrowsing(true);
            }}
          >
            Browse all files…
          </button>
        </p>
      )}
      {browsing && (
        <BrowseFilesDialog
          documents={recent ?? []}
          actions={actions}
          onClose={() => {
            setBrowsing(false);
          }}
        />
      )}
      <StoragePanel documents={recent ?? []} onChanged={refresh} />
    </div>
  );
}
