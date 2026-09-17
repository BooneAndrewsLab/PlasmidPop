import { useEffect, useState } from 'react';

import { type DocumentSummary } from '@/storage';

import { EXAMPLES } from '../examples';
import { openText } from '../openFile';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';

function formatWhen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function EmptyState() {
  const example = EXAMPLES[0];
  const [recent, setRecent] = useState<DocumentSummary[] | null>(null);

  const refresh = (): void => {
    persistence
      .listStored()
      .then(setRecent)
      .catch(() => {
        setRecent([]);
      });
  };

  useEffect(refresh, []);

  return (
    <div className="empty">
      <div className="empty__card">
        <p className="empty__lead">
          Drop a GenBank, FASTA or SnapGene file anywhere on this page to open it.
        </p>
        <p className="empty__hint">
          Everything stays in your browser. Nothing is uploaded.
          {example !== undefined && (
            <>
              {' '}
              Or{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  openText(example.text, example.fileName);
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
        <section className="recent" aria-label="Recent documents">
          <h2 className="recent__title">Recent documents</h2>
          <ul className="recent__list">
            {recent.map((d) => (
              <li key={d.id} className="recent__item">
                <button
                  type="button"
                  className="recent__open"
                  onClick={() => {
                    persistence.openStored(d.id).catch((e: unknown) => {
                      editorStore.fail(e instanceof Error ? e.message : String(e));
                    });
                  }}
                >
                  <span className="recent__name">{d.name}</span>
                  <span className="recent__meta">
                    {d.length.toLocaleString()} bp, {d.topology}, {d.featureCount} features
                    {d.fileName === null ? '' : `, ${d.fileName}`}
                  </span>
                  <span className="recent__when">{formatWhen(d.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  title="Remove from this browser's storage"
                  onClick={() => {
                    persistence
                      .removeStored(d.id)
                      .then(refresh)
                      .catch((e: unknown) => {
                        editorStore.fail(e instanceof Error ? e.message : String(e));
                      });
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
