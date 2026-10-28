import { formatLength } from '@/core';
import { type DocumentSummary, type ListEntry } from '@/storage';

import { formatWhen } from '../formatWhen';
import { InlineRename } from './InlineRename';

/** What a stored document's row and the groups of them do; the lists differ only in which they pass. */
export interface RowActions {
  readonly openIds: ReadonlySet<string>;
  readonly renamingId: string | null;
  readonly onOpen: (id: string) => void;
  readonly onStartRename: (id: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDoneRename: () => void;
  readonly onKeep?: (ids: readonly string[]) => void;
  readonly onRemove: (docs: readonly DocumentSummary[]) => void;
  /** Present in the browse panel: which rows are ticked, and ticking them. */
  readonly selected?: ReadonlySet<string>;
  readonly onSelect?: (ids: readonly string[], on: boolean) => void;
  /** Groups start open (a search is looking inside them). */
  readonly openGroups?: boolean;
}

function Row({ doc, actions }: { doc: DocumentSummary; actions: RowActions }) {
  const { openIds, renamingId, selected, onSelect } = actions;
  return (
    <li className="recent__item">
      {onSelect !== undefined && (
        <input
          type="checkbox"
          className="recent__select"
          aria-label={`Select ${doc.name}`}
          checked={selected?.has(doc.id) ?? false}
          onChange={(e) => {
            onSelect([doc.id], e.target.checked);
          }}
        />
      )}
      {renamingId === doc.id ? (
        <InlineRename
          value={doc.name}
          label="Document name"
          className="recent__rename"
          onCommit={(name) => {
            actions.onRename(doc.id, name);
          }}
          onDone={actions.onDoneRename}
        />
      ) : (
        <button
          type="button"
          className="recent__open"
          onClick={() => {
            actions.onOpen(doc.id);
          }}
        >
          <span className="recent__name">
            <span className="recent__title-text">{doc.name}</span>
            {openIds.has(doc.id) && (
              <span className="recent__badge" data-tip="Open in a tab">
                open
              </span>
            )}
          </span>
          <span className="recent__meta">
            {formatLength(doc.length, doc.alphabet)},{' '}
            {doc.alphabet === 'protein' ? 'protein' : doc.topology}, {doc.featureCount} features
            {doc.fileName === null ? '' : `, ${doc.fileName}`}
          </span>
          <span className="recent__when">{formatWhen(doc.updatedAt)}</span>
        </button>
      )}
      {doc.kind === 'scratch' && actions.onKeep !== undefined && (
        <button
          type="button"
          className="button button--quiet button--small"
          data-tip="Keep this document: it stays under Recent files"
          onClick={() => {
            actions.onKeep?.([doc.id]);
          }}
        >
          Keep
        </button>
      )}
      <button
        type="button"
        className="button button--quiet button--small"
        data-tip="Give this document a different name"
        onClick={() => {
          actions.onStartRename(doc.id);
        }}
      >
        Rename
      </button>
      <button
        type="button"
        className="button button--quiet button--small"
        data-tip="Remove from this browser's storage (Undo for a few seconds)"
        onClick={() => {
          actions.onRemove([doc]);
        }}
      >
        Remove
      </button>
    </li>
  );
}

/**
 * A list of stored documents, the scratch products of one parent folded into
 * one collapsed line (item 111) that opens to them, with Keep all and Remove
 * all for the group.
 */
export function StoredList({
  entries,
  actions,
}: {
  entries: readonly ListEntry<DocumentSummary>[];
  actions: RowActions;
}) {
  const { selected, onSelect } = actions;
  return (
    <ul className="recent__list">
      {entries.map((e) => {
        if (e.type === 'row') return <Row key={e.row.id} doc={e.row} actions={actions} />;
        const ids = e.rows.map((r) => r.id);
        return (
          <li key={`group-${e.parentChecksum}`} className="recent__group">
            <details open={actions.openGroups === true ? true : undefined}>
              <summary className="recent__group-summary">
                {onSelect !== undefined && (
                  <input
                    type="checkbox"
                    className="recent__select"
                    aria-label={`Select the ${e.rows.length.toString()} products of ${e.parentName}`}
                    checked={ids.every((id) => selected?.has(id) ?? false)}
                    onClick={(ev) => {
                      ev.stopPropagation();
                    }}
                    onChange={(ev) => {
                      onSelect(ids, ev.target.checked);
                    }}
                  />
                )}
                <span className="recent__title-text">
                  {e.rows.length.toString()} products of {e.parentName}
                </span>
              </summary>
              <div className="recent__group-actions">
                {actions.onKeep !== undefined && (
                  <button
                    type="button"
                    className="button button--quiet button--small"
                    onClick={() => {
                      actions.onKeep?.(ids);
                    }}
                  >
                    Keep all
                  </button>
                )}
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => {
                    actions.onRemove(e.rows);
                  }}
                >
                  Remove all
                </button>
              </div>
              <ul className="recent__list recent__list--nested">
                {e.rows.map((r) => (
                  <Row key={r.id} doc={r} actions={actions} />
                ))}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
