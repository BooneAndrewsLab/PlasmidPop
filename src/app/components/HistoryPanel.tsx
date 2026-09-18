import { useEffect, useMemo, useRef } from 'react';

import { type HistoryRow, historyRows, stepTime } from '../historyView';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

function rowTitle(row: HistoryRow): string {
  const state = `${row.state.length.toLocaleString()} bp, ${row.state.isCircular ? 'circular' : 'linear'}`;
  if (row.current) return `Current state — ${state}`;
  if (row.undone) return `Redo up to this change — ${state}`;
  if (row.position === 0) return `Undo everything — ${state}`;
  return `Undo back to this change — ${state}`;
}

/**
 * The list of recorded changes, newest first, with what each one did to the
 * document and where the file on disk sits. Clicking a row undoes or redoes
 * as far as it takes to get back to that state.
 */
export function HistoryPanel() {
  const { history, savedDoc, fileName } = useEditorState();
  const currentRef = useRef<HTMLButtonElement>(null);

  const rows = useMemo(
    () =>
      historyRows(history, {
        savedDoc,
        startLabel: fileName === null ? 'New document' : 'Opened document',
      }),
    [history, savedDoc, fileName],
  );

  const position = history?.position ?? 0;
  useEffect(() => {
    const current = currentRef.current as { scrollIntoView?: Element['scrollIntoView'] } | null;
    current?.scrollIntoView?.({ block: 'nearest' }); // jsdom has no scrollIntoView
  }, [position]);

  const total = history?.size ?? 0;
  const undoneCount = total - position;

  return (
    <div className="panel history-panel">
      <h3 className="panel__heading history-panel__heading">
        Changes
        <span className="panel__heading-note">
          {total === 0
            ? 'none yet'
            : total === 1
              ? '1 change'
              : `${total.toLocaleString()} changes`}
          {undoneCount > 0 && `, ${undoneCount.toLocaleString()} undone`}
        </span>
        <button
          type="button"
          className="button button--small history-panel__latest"
          disabled={undoneCount === 0}
          title="Redo every undone change"
          onClick={() => {
            editorStore.jumpHistory(total);
          }}
        >
          Latest
        </button>
      </h3>
      {total === 0 && (
        <p className="panel__note">
          Nothing has been changed yet. Every edit is listed here, newest first, and clicking one
          takes the document back to that state.
        </p>
      )}
      <ol className="history-panel__list" aria-label="Changes">
        {rows.map((row) => (
          <li key={row.position}>
            <button
              ref={row.current ? currentRef : undefined}
              type="button"
              aria-current={row.current ? 'step' : undefined}
              className={`history-panel__item${row.current ? ' history-panel__item--current' : ''}${
                row.undone ? ' history-panel__item--undone' : ''
              }`}
              title={rowTitle(row)}
              onClick={() => {
                editorStore.jumpHistory(row.position);
              }}
            >
              <span className="history-panel__step">
                {row.position === 0 ? '·' : row.position.toLocaleString()}
              </span>
              <span className="history-panel__label">{row.label}</span>
              <span className="history-panel__time">{stepTime(row.at)}</span>
              <span className="history-panel__effect">
                {row.effect}
                {row.saved && <span className="history-panel__saved">on disk</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
