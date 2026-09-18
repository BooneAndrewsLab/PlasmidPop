import { useEffect, useRef, useState } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * Undo and Redo buttons with a dropdown listing every recorded change, so
 * the user can see what each step did and jump straight to any state.
 */
export function HistoryMenu() {
  const { history } = useEditorState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const current = currentRef.current as { scrollIntoView?: Element['scrollIntoView'] } | null;
    current?.scrollIntoView?.({ block: 'nearest' }); // jsdom has no scrollIntoView
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const labels = history?.labels ?? [];
  const position = history?.position ?? 0;
  // Newest first, so the list reads like the undo stack; the opened state is last.
  const entries = [
    ...labels.map((label, i) => ({ label, position: i + 1 })).reverse(),
    { label: 'Opened document', position: 0 },
  ];

  return (
    <div className="menu history" ref={ref}>
      <button
        type="button"
        className="button history__button"
        disabled={history?.canUndo !== true}
        title={
          history?.undoLabel === undefined ? 'Undo (Ctrl+Z)' : `Undo ${history.undoLabel} (Ctrl+Z)`
        }
        onClick={() => {
          editorStore.undo();
        }}
      >
        Undo
      </button>
      <button
        type="button"
        className="button history__button"
        disabled={history?.canRedo !== true}
        title={
          history?.redoLabel === undefined
            ? 'Redo (Ctrl+Shift+Z)'
            : `Redo ${history.redoLabel} (Ctrl+Shift+Z)`
        }
        onClick={() => {
          editorStore.redo();
        }}
      >
        Redo
      </button>
      <button
        type="button"
        className="button history__button history__toggle"
        aria-label="History"
        title="Show the list of changes"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={history === null || labels.length === 0}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        ▾
      </button>
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
                title={
                  current
                    ? 'Current state'
                    : undone
                      ? `Redo up to this change`
                      : entry.position === 0
                        ? 'Undo everything'
                        : 'Undo back to this change'
                }
                onClick={() => {
                  setOpen(false);
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
