import { useEffect, useRef, useState } from 'react';

import { type DocumentSummary, type SortKey, groupByParent, searchRows, sortRows } from '@/storage';

import { type RowActions, StoredList } from './StoredRow';

interface Props {
  /** Everything stored, kept and unkept. */
  readonly documents: readonly DocumentSummary[];
  readonly actions: Omit<RowActions, 'selected' | 'onSelect' | 'openGroups'>;
  readonly onClose: () => void;
}

const SORTS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'updated', label: 'Last updated' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
];

const count = (n: number): string => `${n.toLocaleString()} ${n === 1 ? 'document' : 'documents'}`;

/**
 * Every stored document, kept and unkept (item 111): search by name or file
 * name, sort by update, name or size, tick several and Remove or Keep them
 * at once. The scratch products of one parent are one collapsed line.
 */
export function BrowseFilesDialog({ documents, actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    // A name being edited has its own Escape; only one outside a text field closes.
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const shown = sortRows(searchRows(documents, query), sort);
  const shownIds = shown.map((d) => d.id);
  const allShown = shown.length > 0 && shown.every((d) => selected.has(d.id));
  // A removed or kept document leaves the selection with its row.
  const chosen = documents.filter((d) => selected.has(d.id));
  const chosenScratch = chosen.filter((d) => d.kind === 'scratch');

  const select = (ids: readonly string[], on: boolean): void => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide browse"
        role="dialog"
        aria-modal="true"
        aria-labelledby="browse-title"
      >
        <h2 id="browse-title" className="dialog__title">
          All files
        </h2>
        <div className="browse__controls">
          <input
            ref={searchRef}
            className="panel__search"
            type="search"
            aria-label="Search by name or file name"
            placeholder="Search by name or file name"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query !== '') setQuery('');
              else if (e.key === 'Escape') onClose();
            }}
          />
          <label className="browse__sort">
            <span>Sort by</span>
            <select
              className="panel__select"
              value={sort}
              onChange={(e) => {
                setSort(SORTS.find((s) => s.key === e.target.value)?.key ?? 'updated');
              }}
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="recent__note" role="status">
          {query.trim() === ''
            ? count(documents.length)
            : `${count(shown.length)} of ${documents.length.toLocaleString()}`}
          {chosen.length > 0 && `, ${chosen.length.toLocaleString()} selected`}
        </p>
        <div className="browse__list">
          {shown.length === 0 ? (
            <p className="recent__note">
              {documents.length === 0 ? 'Nothing is stored.' : 'No document matches.'}
            </p>
          ) : (
            <StoredList
              entries={groupByParent(shown)}
              actions={{
                ...actions,
                selected,
                onSelect: select,
                openGroups: query.trim() !== '',
              }}
            />
          )}
        </div>
        <div className="dialog__actions browse__actions">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              select(shownIds, !allShown);
            }}
            disabled={shown.length === 0}
          >
            {allShown ? 'Clear selection' : 'Select all shown'}
          </button>
          <button
            type="button"
            className="button"
            disabled={chosenScratch.length === 0}
            data-tip="Keep the selected unkept documents: they stay under Recent files"
            onClick={() => {
              actions.onKeep?.(chosenScratch.map((d) => d.id));
              select(
                chosenScratch.map((d) => d.id),
                false,
              );
            }}
          >
            Keep selected
          </button>
          <button
            type="button"
            className="button"
            disabled={chosen.length === 0}
            onClick={() => {
              actions.onRemove(chosen);
              setSelected(new Set());
            }}
          >
            Remove selected
          </button>
          <button type="button" className="button button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
