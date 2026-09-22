import { useEffect, useState } from 'react';

import { type DocumentSummary } from '@/storage';

import { EXAMPLES } from '../examples';
import { openExample, openPastedText } from '../openFile';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { InlineRename } from './InlineRename';

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { documents } = useEditorState();
  const openIds = new Set(documents.map((d) => d.documentId));

  const refresh = (): void => {
    persistence
      .listStored()
      .then(setRecent)
      .catch(() => {
        setRecent([]);
      });
  };

  useEffect(refresh, []);

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
              editorStore.newDocument();
            }}
          >
            start a new sequence
          </button>{' '}
          and type it in.
        </p>
        <p className="empty__hint">
          Everything stays in your browser: documents are kept here as you work and never uploaded,
          and no file on your disk is written to. Download the ones you want as files. Your browser
          may ask whether PlasmidPop can keep its data; saying yes protects your documents when disk
          space runs low.
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
      </div>
      {recent !== null && recent.length > 0 && (
        <section className="recent" aria-label="Recent files">
          <h2 className="recent__title">Recent files</h2>
          <ul className="recent__list">
            {recent.map((d) => (
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
                      persistence.openStored(d.id).catch((e: unknown) => {
                        editorStore.fail(e instanceof Error ? e.message : String(e));
                      });
                    }}
                  >
                    <span className="recent__name">
                      {d.name}
                      {openIds.has(d.id) && (
                        <span className="recent__badge" title="Open in a tab">
                          open
                        </span>
                      )}
                    </span>
                    <span className="recent__meta">
                      {d.length.toLocaleString()} bp, {d.topology}, {d.featureCount} features
                      {d.fileName === null ? '' : `, ${d.fileName}`}
                    </span>
                    <span className="recent__when">{formatWhen(d.updatedAt)}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="button button--quiet button--small"
                  title="Give this document a different name"
                  onClick={() => {
                    setRenamingId(d.id);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  title="Remove from this browser's storage"
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
    </div>
  );
}
