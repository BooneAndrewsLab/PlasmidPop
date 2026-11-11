import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  type CrisprGuide,
  type SeqDocument,
  OLIGO_SCHEMES,
  formatSpan,
  oligoSchemesFor,
} from '@/core';

import { type SortBy } from '../crisprSession';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { MAX_PREVIEWED, addGuidesInPlace, flagsOf, guideId, startsDescending } from './crisprScan';
import { CrisprGuideDetail } from './CrisprGuideDetail';
import { type CrisprScan } from './CrisprGuideList';
import { SortTh } from './SortTh';
import { type SortState, nextRowIndex } from './tableKeys';
import { useRowWindow } from './useRowWindow';
import { TableSpacer } from './TableSpacer';

/** Height assumed for a row not yet measured, in pixels: one line of text. */
const ROW_ESTIMATE = 28;

/** The sort a mismatch column stands for: the exact column is the fewest-first order. */
const mismatchSort = (i: number): SortBy => (i === 0 ? 'offTargets' : (`mm${String(i)}` as SortBy));

/** What a click on a guide does: selects the protospacer in the views, and shows it. */
function chooseGuide(scan: CrisprScan, g: CrisprGuide): void {
  scan.set({ clicked: guideId(g) });
  editorStore.setSelection(g.range);
  editorStore.revealPosition(g.range.start);
}

/** The open guide closes with its selection, so the views are clear again. */
function clearGuide(scan: CrisprScan): void {
  scan.set({ clicked: null });
  editorStore.setSelection(null);
}

interface Props {
  readonly doc: SeqDocument;
  readonly scan: CrisprScan;
}

/**
 * The Guides page's table (item 133, C4): every guide the filters leave,
 * windowed so a 200 kb BAC's 25,000 of them are a screenful of rows, the
 * selected guide in full beside or under it, and **Add the N listed as
 * features** with the line that says what it did. The filters, the order and
 * the open guide are the session's, which the slim tab shares; the 200-guide
 * cap that tab keeps is the map's alone.
 */
export function CrisprGuideTable({ doc, scan }: Props) {
  const { s, set, nuclease, baseEditor, editableCount, guides, sorted, filtered, clean, others } =
    scan;
  const { selected, selectedId } = scan;
  const { maxMismatches, sortBy, sortReversed, showFlagged, schemeId } = s;
  const { history } = useEditorState();
  const total = guides?.length ?? 0;

  const keys = useMemo(() => sorted.map(guideId), [sorted]);
  const { first, end, padTop, padBottom, attachScroller, attachRow, scrollToTop, scrollToIndex } =
    useRowWindow(keys, ROW_ESTIMATE);
  // A new filter or order is a new list, and the old scroll position means nothing in it.
  useEffect(() => {
    scrollToTop();
  }, [sorted, scrollToTop]);

  // A guide opened elsewhere (clicked on the map) is brought into view here,
  // once: scrolling away from it afterwards is the reader's.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === null) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === selectedId) return;
    scrolledTo.current = selectedId;
    const at = keys.indexOf(selectedId);
    if (at >= 0) scrollToIndex(at);
  });

  // A key that moves to a row not drawn yet leaves its focus until it is.
  const body = useRef<HTMLTableSectionElement>(null);
  const focusKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    const row = [...(body.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? [])].find(
      (r) => r.getAttribute('data-row') === key,
    );
    if (row === undefined) return;
    focusKey.current = null;
    row.focus();
  });

  // The offered oligo schemes follow the nuclease; the one chosen falls back to the first.
  const schemes = nuclease === null ? OLIGO_SCHEMES : oligoSchemesFor(nuclease);
  const scheme = schemes.find((o) => o.id === schemeId) ?? schemes[0];

  const mismatchColumns = Array.from({ length: maxMismatches + 1 }, (_, i) => i);
  const hasSpecificity = (guides ?? []).some((g) => g.specificity !== null);
  const editing = baseEditor !== undefined;
  // #, strand, position, spacer, PAM and GC; the counts; what is conditional; the flag.
  const columns = 6 + mismatchColumns.length + (hasSpecificity ? 1 : 0) + (editing ? 1 : 0) + 1;

  // The order the column is in: its first click is the natural one, a second turns it round.
  const sort: SortState<SortBy> = {
    key: sortBy,
    dir: startsDescending(sortBy) === sortReversed ? 'asc' : 'desc',
  };
  const onSort = (column: SortBy): void => {
    set(
      column === sortBy ? { sortReversed: !sortReversed } : { sortBy: column, sortReversed: false },
    );
  };

  const selectedIndex = selectedId === null ? -1 : keys.indexOf(selectedId);
  // The one row in the tab order: the open guide, if it is listed, else the first.
  const stop = selectedIndex >= 0 ? selectedId : (keys[0] ?? null);
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Escape puts the guide away first; the workspace shuts on the next one.
    if (e.key === 'Escape') {
      if (selectedIndex < 0) return;
      e.preventDefault();
      clearGuide(scan);
      return;
    }
    const from =
      e.target instanceof Element
        ? e.target.closest('tr[data-row]')?.getAttribute('data-row')
        : null;
    const at = keys.indexOf(from ?? selectedId ?? '');
    const to = nextRowIndex(e.key, at < 0 ? null : at, sorted.length);
    const next = to === null ? undefined : sorted[to];
    if (to === null || next === undefined) return;
    e.preventDefault();
    scrollToIndex(to);
    chooseGuide(scan, next);
    focusKey.current = guideId(next);
  };

  // What Add did, and Undo while that edit is still the document's last.
  const [added, setAdded] = useState<{ count: number; after: SeqDocument } | null>(null);
  const add = (list: readonly CrisprGuide[]): void => {
    const after = addGuidesInPlace(list);
    setAdded(after === null ? null : { count: list.length, after });
  };
  const undoable = added !== null && history?.present === added.after;

  return (
    <div className="crispr-ws">
      <div className="crispr-ws__main">
        <div className="tablewrap crispr-ws__scroll" ref={attachScroller}>
          <table className="wst dt" role="grid" aria-label="Guides">
            <thead>
              <tr>
                <th className="wst__th wst__n" data-tip="Place in this list">
                  #
                </th>
                <th className="wst__th" aria-label="Strand" data-tip="Forward (→) or reverse (←)" />
                <SortTh
                  column="position"
                  sort={sort}
                  onSort={onSort}
                  tip="The protospacer's place along the molecule, 1-based"
                >
                  Position
                </SortTh>
                <th className="wst__th" data-tip="The 5′→3′ spacer, on the guide's strand">
                  Spacer
                </th>
                <th className="wst__th">PAM</th>
                <SortTh column="gc" sort={sort} onSort={onSort} numeric tip="GC content">
                  GC
                </SortTh>
                {mismatchColumns.map((i) => (
                  <SortTh
                    key={i}
                    column={mismatchSort(i)}
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip={
                      i === 0
                        ? 'Other sites with the same spacer and a PAM, in the open documents; sorted, the guides with the fewest first, then the fewest near ones'
                        : `Other sites differing in ${String(i)} ${i === 1 ? 'base' : 'bases'}, in the open documents`
                    }
                  >
                    {i === 0 ? 'Exact' : `${String(i)} mm`}
                  </SortTh>
                ))}
                {hasSpecificity && (
                  <SortTh
                    column="specificity"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="MIT score (Hsu 2013) over the off-target sites counted here, 100 being no other site; sorted, the highest first"
                  >
                    Spec.
                  </SortTh>
                )}
                {baseEditor !== undefined && (
                  <th
                    className="wst__th wst__n"
                    data-tip={`${baseEditor.name}: how many ${baseEditor.from} to ${baseEditor.to} edits sit in the window`}
                  >
                    {baseEditor.from}→{baseEditor.to}
                  </th>
                )}
                <th className="wst__th" aria-label="Flags" />
              </tr>
            </thead>
            <tbody ref={body} onKeyDown={onRowsKeyDown}>
              {padTop > 0 && <TableSpacer height={padTop} columns={columns} />}
              {sorted.slice(first, end).map((g, i) => {
                const key = guideId(g);
                const on = key === selectedId;
                return (
                  <GuideTr
                    key={key}
                    guide={g}
                    number={first + i + 1}
                    doc={doc}
                    on={on}
                    stop={key === stop}
                    mismatchColumns={maxMismatches + 1}
                    specificity={hasSpecificity}
                    edits={editing ? editableCount(g) : null}
                    editTip={
                      baseEditor === undefined
                        ? ''
                        : `${baseEditor.from} to ${baseEditor.to} edits in the window`
                    }
                    trRef={attachRow(key)}
                    onPick={() => {
                      if (on) clearGuide(scan);
                      else chooseGuide(scan, g);
                    }}
                  />
                );
              })}
              {padBottom > 0 && <TableSpacer height={padBottom} columns={columns} />}
            </tbody>
          </table>
        </div>
        <p className="panel__note" role="status">
          {sorted.length.toLocaleString()} {sorted.length === 1 ? 'guide' : 'guides'} listed
          {filtered ? `, of ${total.toLocaleString()} found` : ''}. {clean.toLocaleString()} of the{' '}
          {total.toLocaleString()} have no flags.
          {!showFlagged && clean < total
            ? ' Flagged guides are hidden; Show flagged lists them.'
            : ''}
        </p>
        {sorted.length > MAX_PREVIEWED && (
          <p className="panel__note panel__note--quiet">
            More than {MAX_PREVIEWED} are listed, so none are drawn on the map or the sequence.
            Filter the list or narrow the scan to a selection to see them there.
          </p>
        )}
        <div className="crispr-actions">
          <button
            type="button"
            className="button button--small"
            data-tip="Annotate every guide in the list as a feature, in one step to undo"
            onClick={() => {
              add(sorted);
            }}
          >
            Add {filtered ? 'the ' : 'all '}
            {sorted.length.toLocaleString()} listed as features
          </button>
        </div>
        {undoable && (
          <p className="panel__note crispr-ws__added" role="status">
            Added {added.count.toLocaleString()} {added.count === 1 ? 'feature' : 'features'}.{' '}
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => {
                editorStore.undo();
              }}
            >
              Undo
            </button>
          </p>
        )}
        {selected === null && (
          <p className="panel__note panel__note--quiet">
            Select a guide to see its details and oligos.
          </p>
        )}
      </div>
      {selected !== null && scheme !== undefined && (
        <CrisprGuideDetail
          key={guideId(selected)}
          doc={doc}
          guide={selected}
          flags={flagsOf(selected)}
          others={others}
          baseEditor={baseEditor}
          schemes={schemes}
          scheme={scheme}
          onScheme={(id) => {
            set({ schemeId: id });
          }}
          onAdd={() => {
            add([selected]);
          }}
        />
      )}
    </div>
  );
}

interface TrProps {
  readonly guide: CrisprGuide;
  readonly number: number;
  readonly doc: SeqDocument;
  readonly on: boolean;
  readonly stop: boolean;
  readonly mismatchColumns: number;
  readonly specificity: boolean;
  /** The base editor's count, or null when no editor is chosen. */
  readonly edits: number | null;
  readonly editTip: string;
  readonly trRef: (el: HTMLElement | null) => void;
  readonly onPick: () => void;
}

/** One guide's row: where it is, its spacer and PAM, GC, the off-target counts, and a `!` for its flags. */
function GuideTr({
  guide: g,
  number,
  doc,
  on,
  stop,
  mismatchColumns,
  specificity,
  edits,
  editTip,
  trRef,
  onPick,
}: TrProps) {
  const flags = flagsOf(g);
  return (
    <tr
      className={`cand${on ? ' is-selected' : ''}`}
      ref={trRef}
      data-row={guideId(g)}
      tabIndex={stop ? 0 : -1}
      aria-selected={on}
      onClick={onPick}
    >
      <td className="wst__n">{number.toLocaleString()}</td>
      <td aria-label={g.strand === 'forward' ? 'forward strand' : 'reverse strand'}>
        {g.strand === 'forward' ? '→' : '←'}
      </td>
      <td>{formatSpan(g.range, doc.length)}</td>
      <td className="panel__mono wst__seq">{g.spacer}</td>
      <td className="panel__mono wst__seq">{g.pam}</td>
      <td className="wst__n">{Math.round(g.gc * 100)}%</td>
      {Array.from({ length: mismatchColumns }, (_, i) => (
        <td key={i} className="wst__n">
          {(g.offTargets[i] ?? 0).toLocaleString()}
        </td>
      ))}
      {specificity && (
        <td className="wst__n">{g.specificity === null ? '' : g.specificity.toFixed(0)}</td>
      )}
      {edits !== null && (
        <td className="wst__n" data-tip={editTip}>
          {edits}
        </td>
      )}
      <td className="crispr-ws__flag" data-tip={flags.length > 0 ? flags.join('; ') : undefined}>
        {flags.length > 0 ? '!' : ''}
      </td>
    </tr>
  );
}
