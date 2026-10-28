import { useEffect, useRef, useState } from 'react';

import { formatLength } from '@/core';
import { type DocumentSummary, SCRATCH_LIFETIME_DAYS, expiringScratch } from '@/storage';

import { EXAMPLES } from '../examples';
import { openExample, openPastedText } from '../openFile';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { InlineRename } from './InlineRename';
import { StoragePanel } from './StoragePanel';

const REPOSITORY_URL = 'https://github.com/BooneAndrewsLab/PlasmidPop';

function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

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
  const { documents } = useEditorState();
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
  const expiring = expiringScratch(unkept, listedAt, openIds);

  const open = (id: string): void => {
    persistence.openStored(id).catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <div className="empty">
      <div className="empty__card">
        <p className="empty__lead">
          Drop a GenBank, FASTA or SnapGene file anywhere on this page to open it.
        </p>
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
      {kept.length > 0 && (
        <section className="recent" aria-label="Recent files">
          <h2 className="recent__title">Recent files</h2>
          <ul className="recent__list">
            {kept.map((d) => (
              <li key={d.id} className="recent__item">
                {renamingId === d.id ? (
                  <InlineRename
                    value={d.name}
                    label="Document name"
                    className="recent__rename"
                    onCommit={(name) => {
                      report(persistence.renameStored(d.id, name));
                    }}
                    onDone={() => {
                      setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="recent__open"
                    onClick={() => {
                      open(d.id);
                    }}
                  >
                    <span className="recent__name">
                      <span className="recent__title-text">{d.name}</span>
                      {openIds.has(d.id) && (
                        <span className="recent__badge" data-tip="Open in a tab">
                          open
                        </span>
                      )}
                    </span>
                    <span className="recent__meta">
                      {formatLength(d.length, d.alphabet)},{' '}
                      {d.alphabet === 'protein' ? 'protein' : d.topology}, {d.featureCount} features
                      {d.fileName === null ? '' : `, ${d.fileName}`}
                    </span>
                    <span className="recent__when">{formatWhen(d.updatedAt)}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="button button--quiet button--small"
                  data-tip="Give this document a different name"
                  onClick={() => {
                    setRenamingId(d.id);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  data-tip="Remove from this browser's storage"
                  onClick={() => {
                    report(persistence.removeStored(d.id));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
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
          <ul className="recent__list">
            {unkept.map((d) => (
              <li key={d.id} className="recent__item">
                <button
                  type="button"
                  className="recent__open"
                  onClick={() => {
                    open(d.id);
                  }}
                >
                  <span className="recent__name">
                    <span className="recent__title-text">{d.name}</span>
                    {openIds.has(d.id) && (
                      <span className="recent__badge" data-tip="Open in a tab">
                        open
                      </span>
                    )}
                  </span>
                  <span className="recent__meta">
                    {formatLength(d.length, d.alphabet)},{' '}
                    {d.alphabet === 'protein' ? 'protein' : d.topology}, {d.featureCount} features
                  </span>
                  <span className="recent__when">{formatWhen(d.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  data-tip="Keep this document: it stays under Recent files"
                  onClick={() => {
                    report(persistence.keepStored([d.id]));
                  }}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  data-tip="Remove from this browser's storage"
                  onClick={() => {
                    report(persistence.removeStored(d.id));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <StoragePanel documents={recent ?? []} onChanged={refresh} />
    </div>
  );
}
