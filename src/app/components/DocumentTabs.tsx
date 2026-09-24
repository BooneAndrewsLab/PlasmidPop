import { type DragEvent, useState } from 'react';

import { type DocumentState, editorStore, isDirty } from '../state/editorStore';
import { PHONE_QUERY } from '../state/layout';
import { useEditorState } from '../state/useEditorStore';
import { useMediaQuery } from './useMediaQuery';

/**
 * One tab per open document under the toolbar, with the file list as a
 * fixed first tab and the Cloning Bench as a fixed second one, so several
 * constructs can be open at once and a piece cut from one can be carried to
 * another. Nothing is shown until a document is open or the shelf holds a
 * part. Closing a tab keeps the document in local storage, like Show files
 * always has. The phone reader has no Bench (item 49).
 */
export function DocumentTabs() {
  const { documents, documentId, front, shelf } = useEditorState();
  const phone = useMediaQuery(PHONE_QUERY);
  // A tab being dragged to a new place (#33), and the gap it would drop into:
  // 0 before the first document tab, `documents.length` after the last.
  const [drag, setDrag] = useState<{ readonly id: string; readonly gap: number | null } | null>(
    null,
  );
  if (documents.length === 0 && (phone || shelf.length === 0)) return null;
  return (
    <nav className="doctabs">
      <div className="doctabs__list" role="tablist" aria-label="Open documents">
        <div className={tabClass(front === 'files')}>
          <button
            type="button"
            role="tab"
            className="doctabs__name"
            aria-selected={front === 'files'}
            title="The files stored in this browser"
            onClick={() => {
              editorStore.showFiles();
            }}
          >
            Files
          </button>
        </div>
        {!phone && (
          <div className={tabClass(front === 'bench')}>
            <button
              type="button"
              role="tab"
              className="doctabs__name"
              aria-selected={front === 'bench'}
              title="The Cloning Bench: the shelf, and reactions that join parts from any tab"
              onClick={() => {
                editorStore.showBench('tab');
              }}
            >
              Bench
              {shelf.length > 0 && (
                <span
                  className="doctabs__count"
                  aria-label={`, ${String(shelf.length)} ${shelf.length === 1 ? 'part' : 'parts'} on the shelf`}
                >
                  {shelf.length}
                </span>
              )}
            </button>
          </div>
        )}
        {documents.map((d, i) => (
          <DocumentTab
            key={d.documentId}
            state={d}
            active={d.documentId === documentId}
            drop={drag?.gap === i ? 'before' : drag?.gap === i + 1 ? 'after' : null}
            onDragStart={() => {
              setDrag({ id: d.documentId, gap: null });
            }}
            onDragOver={(after) => {
              if (drag !== null) setDrag({ ...drag, gap: after ? i + 1 : i });
            }}
            onDrop={() => {
              if (drag?.gap == null) return;
              const from = documents.findIndex((x) => x.documentId === drag.id);
              // The gap is counted with the dragged tab still in place.
              editorStore.moveDocument(drag.id, from < drag.gap ? drag.gap - 1 : drag.gap);
              setDrag(null);
            }}
            onDragEnd={() => {
              setDrag(null);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="doctabs__new"
        title="Start an empty sequence in a new tab"
        aria-label="New sequence"
        onClick={() => {
          editorStore.newDocument();
        }}
      >
        +
      </button>
    </nav>
  );
}

function tabClass(active: boolean): string {
  return `doctabs__tab${active ? ' doctabs__tab--active' : ''}`;
}

interface TabProps {
  readonly state: DocumentState;
  readonly active: boolean;
  /** Which side of this tab a dragged one would land on, if on this tab. */
  readonly drop: 'before' | 'after' | null;
  readonly onDragStart: () => void;
  readonly onDragOver: (after: boolean) => void;
  readonly onDrop: () => void;
  readonly onDragEnd: () => void;
}

/** The MIME type a dragged tab carries, so nothing else dropped here is taken for one. */
const TAB_TYPE = 'application/x-plasmidpop-tab';

function DocumentTab({
  state,
  active,
  drop,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: TabProps) {
  const name = state.history.present.name;
  const dirty = isDirty(state);
  const isTab = (e: DragEvent): boolean => e.dataTransfer.types.includes(TAB_TYPE);
  return (
    <div
      className={`${tabClass(active)}${drop === null ? '' : ` doctabs__tab--drop-${drop}`}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_TYPE, state.documentId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(e) => {
        if (!isTab(e)) return;
        // Claimed, so the app does not take it for a file being dropped.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const box = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientX > box.left + box.width / 2);
      }}
      onDrop={(e) => {
        if (!isTab(e)) return;
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        role="tab"
        className="doctabs__name"
        aria-selected={active}
        title={state.fileName === null ? name : `${name}\n${state.fileName}`}
        onClick={() => {
          editorStore.activateDocument(state.documentId);
        }}
      >
        {name}
        {dirty && (
          <span className="doctabs__dirty" title="Changed since the last download">
            {' '}
            •
          </span>
        )}
      </button>
      <button
        type="button"
        className="doctabs__close"
        aria-label={`Close ${name}`}
        title="Close this tab (the document stays stored in this browser)"
        onClick={() => {
          editorStore.closeDocument(state.documentId);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
