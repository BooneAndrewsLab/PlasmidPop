import { useEffect, useRef } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { useMenu } from './useMenu';

/**
 * The conventional curved arrow, head on the left for Undo and mirrored for
 * Redo. Drawn rather than typed as ↶ ↷: those take whatever font the system
 * picks, and some render them as bent arrows nobody reads as undo (#293).
 */
function HistoryIcon({ direction }: { readonly direction: 'undo' | 'redo' }) {
  return (
    <svg
      className={`history__icon history__icon--${direction}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M5.5 2.5 2.5 5.5l3 3M2.5 5.5h6.5a4 4 0 0 1 0 8H5.5" />
    </svg>
  );
}

/**
 * Undo and Redo buttons with a dropdown listing every recorded change, so
 * the user can see what each step did and jump straight to any state.
 * With the Bench in front they undo and redo the shelf instead, which keeps
 * a history of its own (item 49); it has no list to jump through.
 */
export function HistoryMenu() {
  const { history, front, shelfUndo, shelfRedo } = useEditorState();
  const { open, toggle, close, ref } = useMenu();
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const current = currentRef.current as { scrollIntoView?: Element['scrollIntoView'] } | null;
    current?.scrollIntoView?.({ block: 'nearest' }); // jsdom has no scrollIntoView
  }, [open]);

  const labels = history?.labels ?? [];
  const position = history?.position ?? 0;
  // Newest first, so the list reads like the undo stack; the opened state is last.
  const entries = [
    ...labels.map((label, i) => ({ label, position: i + 1 })).reverse(),
    { label: 'Opened document', position: 0 },
  ];

  if (front === 'bench') {
    return (
      <div className="menu history">
        <div className="segmented" role="group" aria-label="History">
          <button
            type="button"
            className="segmented__button"
            aria-label="Undo"
            disabled={shelfUndo === null}
            data-tip={shelfUndo === null ? 'Undo (Ctrl+Z)' : `Undo ${shelfUndo} (Ctrl+Z)`}
            onClick={() => {
              editorStore.undoShelf();
            }}
          >
            <HistoryIcon direction="undo" />
          </button>
          <button
            type="button"
            className="segmented__button"
            aria-label="Redo"
            disabled={shelfRedo === null}
            data-tip={
              shelfRedo === null ? 'Redo (Ctrl+Shift+Z)' : `Redo ${shelfRedo} (Ctrl+Shift+Z)`
            }
            onClick={() => {
              editorStore.redoShelf();
            }}
          >
            <HistoryIcon direction="redo" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="menu history" ref={ref}>
      <div className="segmented" role="group" aria-label="History">
        <button
          type="button"
          className="segmented__button"
          aria-label="Undo"
          disabled={history?.canUndo !== true}
          data-tip={
            history?.undoLabel === undefined
              ? 'Undo (Ctrl+Z)'
              : `Undo ${history.undoLabel} (Ctrl+Z)`
          }
          onClick={() => {
            editorStore.undo();
          }}
        >
          <HistoryIcon direction="undo" />
        </button>
        <button
          type="button"
          className="segmented__button"
          aria-label="Redo"
          disabled={history?.canRedo !== true}
          data-tip={
            history?.redoLabel === undefined
              ? 'Redo (Ctrl+Shift+Z)'
              : `Redo ${history.redoLabel} (Ctrl+Shift+Z)`
          }
          onClick={() => {
            editorStore.redo();
          }}
        >
          <HistoryIcon direction="redo" />
        </button>
        <button
          type="button"
          className="segmented__button segmented__button--caret"
          aria-label="History"
          data-tip="Show the list of changes"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={history === null || labels.length === 0}
          onClick={toggle}
        >
          ▾
        </button>
      </div>
      {open && (
        <div className="menu__list history__list" role="menu" aria-label="Changes">
          {entries.map((entry) => {
            const current = entry.position === position;
            const undone = entry.position > position;
            return (
              <button
                key={entry.position}
                ref={current ? currentRef : undefined}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={`menu__item history__item${current ? ' history__item--current' : ''}${
                  undone ? ' history__item--undone' : ''
                }`}
                data-tip={
                  current
                    ? 'Current state'
                    : undone
                      ? `Redo up to this change`
                      : entry.position === 0
                        ? 'Undo everything'
                        : 'Undo back to this change'
                }
                onClick={() => {
                  close();
                  editorStore.jumpHistory(entry.position);
                }}
              >
                <span className="history__step">
                  {entry.position === 0 ? '' : String(entry.position)}
                </span>
                <span className="history__label">{entry.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
