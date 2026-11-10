import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';

import {
  type CutSite,
  type SeqDocument,
  digestFragments,
  hostMarksFromBits,
  isHostMethylationSensitive,
  overhangKind,
  overhangLength,
  wrapPosition,
} from '@/core';

import type { WorkspaceLayout } from '../workspaceController';
import { CUT_COUNT_OPTIONS, cutCountPhrase, isCutCountFilter } from '../state/cutFilter';
import { type EnzymeSort } from '../state/enzymeSort';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { BandLine } from './BandLine';
import { type EnzymeList, pickPiece } from './enzymeList';
import {
  MAX_SHOW_LISTED,
  MAX_SITES_SHOWN,
  countMarked,
  describeOthers,
  describeSite,
  enzymeFacts,
  firstSites,
  selectCutSite,
  tickRow,
} from './enzymeRows';
import { EnzymeNotes } from './EnzymeListView';
import { Gel } from './Gel';
import { SortTh } from './SortTh';
import { type SortState, nextRowIndex, toggleSort } from './tableKeys';
import { useRowWindow } from './useRowWindow';

/**
 * Height assumed for a row not yet measured, in pixels: one line of text.
 * A row with many cut positions wraps taller, and is measured once drawn.
 */
const ROW_ESTIMATE = 30;

/** Positions listed in a row on a phone, where the column is the long one. */
const PHONE_SITES_SHOWN = 3;

/**
 * Sites the detail pane tabulates. A four-base cutter can hit a long
 * sequence thousands of times, and a table of thousands of rows is not one
 * anyone reads; the rest are a count.
 */
const MAX_DETAIL_SITES = 200;

/** Bases of the sequence shown either side of a site in the detail pane. */
const CONTEXT = 10;

type Row = EnzymeList['rows'][number];

/**
 * What a row is called to the table: the first member of its group, which
 * the ticks do not change, where the name on the row follows them.
 */
function rowKey(row: Row): string {
  return row.members[0]?.name ?? row.enzyme.name;
}

/** `from` to `to` of the sequence, round the origin on a circle and clipped on a line. */
function readRange(doc: SeqDocument, from: number, to: number): string {
  const n = doc.length;
  // Nothing to read, and no length to fold onto: the loop below would end only on a NaN.
  if (n === 0) return '';
  if (doc.topology !== 'circular') return doc.sequence.slice(Math.max(0, from), Math.min(n, to));
  let out = '';
  for (let p = from; p < to;) {
    const at = wrapPosition(p, n);
    const take = Math.min(to - p, n - at);
    out += doc.sequence.slice(at, at + take);
    p += take;
  }
  return out;
}

/** The recognition site of a cut site with the bases either side of it, top strand. */
function siteContext(doc: SeqDocument, site: CutSite, length: number) {
  const end = site.siteStart + length;
  return {
    before: readRange(doc, site.siteStart - CONTEXT, site.siteStart).toUpperCase(),
    site: readRange(doc, site.siteStart, end).toUpperCase(),
    after: readRange(doc, end, end + CONTEXT).toUpperCase(),
  };
}

/** The filters, the supplier, and the buttons that tick the list. */
function EnzymeFilterBar({ list }: { readonly list: EnzymeList }) {
  const { enzymeSetInfo, enzymeCutFilter, enzymeGroupIsoschizomers: grouped } = useEditorState();
  const { filter, setFilter, supplier, rows } = list;
  return (
    <div className="panel__controls enz-bar">
      <div className="panel__form">
        <label>
          <span>Filter</span>
          <input
            className="panel__search"
            type="search"
            placeholder="Enzyme or site"
            aria-label="Filter enzymes"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
        </label>
        <label>
          <span>Cuts</span>
          <select
            className="panel__select"
            value={enzymeCutFilter}
            data-tip="List only the enzymes that cut this many times — two for a diagnostic digest, one for a cloning site"
            onChange={(e) => {
              editorStore.setEnzymeCutFilter(
                isCutCountFilter(e.target.value) ? e.target.value : 'any',
              );
            }}
          >
            {CUT_COUNT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {enzymeSetInfo.suppliers.length > 0 && (
          <label>
            <span>Sold by</span>
            <select
              className="panel__select"
              value={supplier}
              onChange={(e) => {
                editorStore.setEnzymeSupplier(e.target.value);
              }}
            >
              <option value="">Any supplier</option>
              {enzymeSetInfo.suppliers.map((sup) => (
                <option key={sup.code} value={sup.code}>
                  {sup.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          className={`button button--small button--toggle${grouped ? ' button--toggle-on' : ''}`}
          aria-pressed={grouped}
          data-tip="Enzymes that cut the same site in the same place give the same fragments and ends; list them as one row"
          onClick={() => {
            editorStore.setEnzymeGroupIsoschizomers(!grouped);
          }}
        >
          Isoschizomers share a row
        </button>
      </div>
      <div className="panel__buttons">
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={rows.length > MAX_SHOW_LISTED}
          data-tip={
            rows.length > MAX_SHOW_LISTED
              ? `${rows.length.toLocaleString()} enzymes is more than the views can label; filter the list first`
              : 'Tick every enzyme in the list'
          }
          onClick={() => {
            editorStore.setShownEnzymes(rows.map((g) => g.enzyme.name));
          }}
        >
          Show listed
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            editorStore.setShownEnzymes([]);
          }}
        >
          Hide all
        </button>
      </div>
    </div>
  );
}

interface TableProps {
  readonly doc: SeqDocument;
  readonly list: EnzymeList;
  readonly layout?: WorkspaceLayout;
  /** **Find a partner ›**: the Double page, with this enzyme searched. */
  readonly onPartner: (name: string) => void;
}

/**
 * The Enzymes page (item 133, E4): the filter bar over a table of the
 * enzymes that cut this DNA, windowed so an imported table's 1,500 rows are
 * a screenful of them, and the selected enzyme in full beside or under it.
 * The ticks, the filters and the order are the store's and the slim
 * panel's, so a choice made in either is made in both.
 */
export function EnzymeTable({ doc, list, layout = 'split', onPartner }: TableProps) {
  const { ready } = list;
  return (
    <>
      <EnzymeFilterBar list={list} />
      <EnzymeNotes list={list} />
      {ready ? (
        <EnzymeGrid doc={doc} list={list} layout={layout} onPartner={onPartner} />
      ) : (
        <p className="panel__note">Scanning for restriction sites…</p>
      )}
    </>
  );
}

/** The table itself with its detail pane and the line on how many enzymes it lists. */
function EnzymeGrid({ doc, list, layout, onPartner }: TableProps) {
  const {
    documentId,
    shownEnzymes,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSort,
    enzymeSortReversed: reversed,
  } = useEditorState();
  const { needle, supplier, rows, listedEnzymes, nonCutters } = list;
  const [selected, select] = useRemembered('enzymes.selected', documentId, '');
  const phone = layout === 'phone';

  const { first, end, padTop, padBottom, attachScroller, attachRow, scrollToTop, scrollToIndex } =
    useRowWindow(
      useMemo(() => rows.map(rowKey), [rows]),
      ROW_ESTIMATE,
    );
  // A new filter is a new list, and the old scroll position means nothing in it.
  useEffect(() => {
    scrollToTop();
  }, [needle, supplier, enzymeCutFilter, enzymeSort, reversed, scrollToTop]);

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

  // The highlight is the pointer's: it must not outlive the table.
  useEffect(
    () => () => {
      editorStore.setHighlightedEnzymes([]);
    },
    [],
  );

  const sort: SortState<EnzymeSort> = { key: enzymeSort, dir: reversed ? 'desc' : 'asc' };
  const onSort = (column: EnzymeSort): void => {
    const next = toggleSort(sort, column);
    editorStore.setEnzymeSort(next.key);
    editorStore.setEnzymeSortReversed(next.dir === 'desc');
  };

  const selectedRow = rows.find((r) => rowKey(r) === selected);
  // The one row in the tab order: the selected, if it is listed, else the first.
  const stop =
    selectedRow === undefined ? (rows[0] === undefined ? null : rowKey(rows[0])) : selected;
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Escape puts the detail away first; the workspace shuts on the next one.
    if (e.key === 'Escape') {
      if (selectedRow === undefined) return;
      e.preventDefault();
      select('');
      return;
    }
    const from =
      e.target instanceof Element
        ? e.target.closest('tr[data-row]')?.getAttribute('data-row')
        : null;
    const key = from ?? selected;
    const at = rows.findIndex((r) => rowKey(r) === key);
    const to = nextRowIndex(e.key, at < 0 ? null : at, rows.length);
    const next = to === null ? undefined : rows[to];
    if (to === null || next === undefined) return;
    e.preventDefault();
    scrollToIndex(to);
    select(rowKey(next));
    focusKey.current = rowKey(next);
  };

  // The Dam/Dcm column is for the DNA that has a site it could block: on a
  // plasmid with none it is a blank column's width taken from the bands.
  const methylation = useMemo(
    () => rows.some((r) => isHostMethylationSensitive(r.enzyme.name) && countMarked(r.host) > 0),
    [rows],
  );
  const sites = phone ? PHONE_SITES_SHOWN : MAX_SITES_SHOWN;
  return (
    <div className="enz-ws">
      <div className="enz-ws__main">
        <div className="tablewrap enz-ws__scroll" ref={attachScroller}>
          <table className="wst dt" role="grid" aria-label="Enzymes">
            <thead>
              <tr>
                <th className="wst__th" aria-label="Ticked" />
                <SortTh column="name" sort={sort} onSort={onSort} tip="Alphabetically">
                  Name
                </SortTh>
                <th className="wst__th" data-tip="Recognition site, 5′→3′ on the top strand">
                  Site
                </th>
                <SortTh
                  column="overhang"
                  sort={sort}
                  onSort={onSort}
                  tip="The end the cut leaves; sorted, blunt first, then 5′, then 3′, the shorter first"
                >
                  Overhang
                </SortTh>
                <SortTh
                  column="cuts"
                  sort={sort}
                  onSort={onSort}
                  numeric
                  tip="How many times it cuts this DNA; sorted, fewest first"
                >
                  Cuts
                </SortTh>
                <th
                  className="wst__th"
                  data-tip="The base each cut is after; click to select the site"
                >
                  Positions
                </th>
                {methylation && (
                  <th className="wst__th" data-tip="Sites Dam or Dcm methylation may block">
                    Dam/Dcm
                  </th>
                )}
                <SortTh
                  column="bands"
                  sort={sort}
                  onSort={onSort}
                  tip="The bands the enzyme alone would give; sorted, the enzymes whose bands are furthest apart on a gel first"
                >
                  Bands
                </SortTh>
              </tr>
            </thead>
            <tbody ref={body} onKeyDown={onRowsKeyDown}>
              {padTop > 0 && <Spacer height={padTop} />}
              {rows.slice(first, end).map((row) => {
                const key = rowKey(row);
                const on = key === selected;
                return (
                  <EnzymeTr
                    key={key}
                    row={row}
                    doc={doc}
                    on={on}
                    stop={key === stop}
                    sites={sites}
                    methylation={methylation}
                    shownEnzymes={shownEnzymes}
                    trRef={attachRow(key)}
                    onPick={() => {
                      select(on ? '' : key);
                    }}
                  />
                );
              })}
              {padBottom > 0 && <Spacer height={padBottom} />}
            </tbody>
          </table>
        </div>
        <p className="panel__note" role="status">
          {listedEnzymes.toLocaleString()} of {enzymeSetInfo.count.toLocaleString()} enzymes{' '}
          {cutCountPhrase(enzymeCutFilter)}
          {supplier === '' ? '' : ' and are sold by that supplier'}
          {rows.length < listedEnzymes
            ? `, in ${rows.length.toLocaleString()} rows with isoschizomers together`
            : ''}
          . {nonCutters.toLocaleString()} do not cut.
        </p>
        {rows.length === 0 && <p className="panel__note">No enzyme matches that.</p>}
        {rows.length > 0 && selectedRow === undefined && (
          <p className="panel__note panel__note--quiet">
            Select an enzyme to see where it cuts, in full.
          </p>
        )}
      </div>
      {selectedRow !== undefined && (
        <EnzymeDetail
          key={rowKey(selectedRow)}
          doc={doc}
          list={list}
          row={selectedRow}
          onPartner={onPartner}
        />
      )}
    </div>
  );
}

/** Rows not drawn, as the height they would take. */
function Spacer({ height }: { readonly height: number }) {
  return (
    <tr className="wst__spacer" aria-hidden="true" style={{ height }}>
      <td colSpan={8} />
    </tr>
  );
}

interface TrProps {
  readonly row: Row;
  readonly doc: SeqDocument;
  readonly on: boolean;
  readonly stop: boolean;
  readonly sites: number;
  /** Whether the table has the Dam/Dcm column. */
  readonly methylation: boolean;
  readonly shownEnzymes: ReadonlySet<string>;
  readonly trRef: (el: HTMLElement | null) => void;
  readonly onPick: () => void;
}

/** One enzyme's row: ticked or not, its site, how often and where it cuts, and its bands. */
function EnzymeTr({
  row,
  doc,
  on,
  stop,
  sites,
  methylation,
  shownEnzymes,
  trRef,
  onPick,
}: TrProps) {
  const { enzyme, members, count, host: marks, site, profile } = row;
  const ticked = members.some((e) => shownEnzymes.has(e.name));
  const marked = isHostMethylationSensitive(enzyme.name) ? countMarked(marks) : 0;
  const kind = overhangKind(enzyme).replace("'", '′');
  const tab = stop ? 0 : -1;
  return (
    <tr
      className={`cand${on ? ' is-selected' : ''}`}
      ref={trRef}
      data-row={rowKey(row)}
      tabIndex={tab}
      aria-selected={on}
      // The row's sites light up on the map and the sequence (#401). A
      // finger has no hover, and a tap would leave them lit.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') {
          editorStore.setHighlightedEnzymes(members.map((m) => m.name));
        }
      }}
      onPointerLeave={() => {
        editorStore.setHighlightedEnzymes([]);
      }}
      onClick={(e) => {
        // A tick or a position is its own click, not a choice of row.
        if (e.target instanceof Element && e.target.closest('input, button') !== null) return;
        onPick();
      }}
    >
      <td>
        <input
          type="checkbox"
          aria-label={`Tick ${enzyme.name}`}
          tabIndex={tab}
          data-tip="Tick to draw this enzyme's cut sites and to digest with it"
          checked={ticked}
          onChange={(e) => {
            tickRow(enzyme, members, shownEnzymes, e.target.checked);
          }}
        />
      </td>
      <td>
        <span className="enzyme-row__name">{enzyme.name}</span>
        {members.length > 1 && (
          <span
            className="enzyme-row__more"
            data-tip={`Same site and cut: ${describeOthers(enzyme, members)}`}
          >
            {' '}
            +{members.length - 1}
          </span>
        )}
      </td>
      <td className="panel__mono wst__seq" data-tip={enzymeFacts(enzyme).join('\n')}>
        {enzyme.site}
      </td>
      <td
        data-tip={
          kind === 'blunt' ? 'Blunt ends' : `${kind} overhang of ${overhangLength(enzyme)} bases`
        }
      >
        {kind}
      </td>
      <td className="wst__n">{count.toLocaleString()}</td>
      <td className="enz-cuts">
        {firstSites(site, count, sites).map((s, i) => {
          // Dam or Dcm inside this site in DNA from a methylating
          // strain; see `hostMethylationAt`.
          const hostMarks = hostMarksFromBits(marks[i] ?? 0);
          return (
            <button
              key={i}
              type="button"
              tabIndex={tab}
              className={`link link--mono${hostMarks.length > 0 ? ' link--methylated' : ''}`}
              data-tip={`Select the ${enzyme.name} site cut after base ${describeSite(s, doc)}${
                hostMarks.length > 0
                  ? ` — ${hostMarks.join(' and ')} methylation overlaps it, so it may not cut DNA grown in a ${hostMarks.map((h) => h.toLowerCase()).join('+/')}+ strain of E. coli`
                  : ''
              }`}
              onClick={() => {
                selectCutSite(s);
              }}
            >
              {describeSite(s, doc)}
              {hostMarks.length > 0 && <sup>m</sup>}
            </button>
          );
        })}
        {count > sites && (
          <span className="enzyme-row__more" data-tip={`${enzyme.name} cuts ${count} times in all`}>
            +{count - sites}
          </span>
        )}
      </td>
      {methylation && (
        <td
          className={marked > 0 ? 'dt__warn' : undefined}
          data-tip={
            marked > 0
              ? 'Most laboratory E. coli strains methylate GATC (Dam) and CCWGG (Dcm). Grow the plasmid in a dam–/dcm– strain, or use an isoschizomer that is not sensitive, to cut these sites.'
              : undefined
          }
        >
          {marked > 0 ? `${marked} of ${count}` : ''}
        </td>
      )}
      <td className="enz-bands">
        <BandLine profile={profile()} />
      </td>
    </tr>
  );
}

interface DetailProps {
  readonly doc: SeqDocument;
  readonly list: EnzymeList;
  readonly row: Row;
  readonly onPartner: (name: string) => void;
}

/**
 * The selected enzyme in full: what is known of it, every site it cuts with
 * the bases around it and a button to select it, its lane alone on a gel,
 * and the two things to do with it. **Find a partner ›** is the Double
 * page's question with this enzyme as the one asked about.
 */
function EnzymeDetail({ doc, list, row, onPartner }: DetailProps) {
  const { shownEnzymes, enzymeSetInfo } = useEditorState();
  const headId = useId();
  const { enzyme, members, count, site, host: marks, profile } = row;
  const ticked = members.some((e) => shownEnzymes.has(e.name));
  const lane = profile();
  const cutAt = list.cuts;
  const lanes = useMemo(
    () =>
      lane === null
        ? []
        : [
            {
              profile: lane,
              label: enzyme.name,
              ...pickPiece(digestFragments(cutAt(row), doc.length, doc.topology), ''),
            },
          ],
    [lane, enzyme.name, cutAt, row, doc.length, doc.topology],
  );
  const shown = firstSites(site, count, MAX_DETAIL_SITES);
  const others = members.filter((e) => e !== enzyme).map((e) => e.name);
  const marked = isHostMethylationSensitive(enzyme.name) ? countMarked(marks) : 0;
  const kind = overhangKind(enzyme).replace("'", '′');
  const canPair =
    list.pairable.length >= 2 && list.pairable.some((r) => r.members.includes(enzyme.name));
  return (
    <aside className="detail enz-detail" aria-labelledby={headId}>
      <div className="detail__head">
        <strong id={headId}>{enzyme.name}</strong>
        <span className="dnote">
          {enzyme.site} · {kind === 'blunt' ? 'blunt' : `${kind} overhang`} · cuts{' '}
          {count === 1 ? 'once' : `${count.toLocaleString()} times`}
        </span>
        <span className="detail__show panel__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            data-tip="Draw this enzyme's cut sites and digest with it"
            onClick={() => {
              tickRow(enzyme, members, shownEnzymes, !ticked);
            }}
          >
            {ticked ? 'Untick' : 'Tick'}
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={!canPair}
            data-tip={
              canPair
                ? `The Double page, with the best partners for ${enzyme.name} among the enzymes that cut three times or fewer`
                : `${enzyme.name} cuts too often (or every site is blocked by methylation) to pair`
            }
            onClick={() => {
              onPartner(enzyme.name);
            }}
          >
            Find a partner ›
          </button>
        </span>
      </div>
      <div className="enz-detail__body">
        <div className="enz-detail__facts">
          <ul className="enz-detail__list">
            {/* The first fact is the overhang, which the head above already says. */}
            {enzymeFacts(enzyme, Infinity, enzymeSetInfo.suppliers)
              .slice(1)
              .map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            {others.length > 0 && <li>Same site and cut: {others.join(', ')}</li>}
            {marked > 0 && (
              <li className="enzyme-row__methylation">
                {marked === count
                  ? count === 1
                    ? 'Its site'
                    : `All ${count} sites`
                  : `${marked} of ${count} sites`}{' '}
                may be blocked by Dam/Dcm methylation
              </li>
            )}
          </ul>
          <div className="enz-detail__sites">
            <table className="dt" aria-label={`${enzyme.name} sites`}>
              <thead>
                <tr>
                  <th>Cut after</th>
                  <th>Strand</th>
                  <th>Site in the sequence</th>
                  <th>Dam/Dcm</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s, i) => {
                  const context = siteContext(doc, s, enzyme.site.length);
                  const hostMarks = hostMarksFromBits(marks[i] ?? 0);
                  return (
                    <tr key={i}>
                      <td className="wst__n">{describeSite(s, doc)}</td>
                      <td>{s.strand}</td>
                      <td className="panel__mono dt__seq">
                        {context.before}
                        <strong>{context.site}</strong>
                        {context.after}
                      </td>
                      <td className={hostMarks.length > 0 ? 'dt__warn' : undefined}>
                        {hostMarks.join(', ')}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link"
                          aria-label={`Select the ${enzyme.name} site cut after base ${describeSite(s, doc)}`}
                          onClick={() => {
                            selectCutSite(s);
                          }}
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {count > shown.length && (
              <p className="panel__note panel__note--quiet">
                The first {shown.length.toLocaleString()} of {count.toLocaleString()} sites.
              </p>
            )}
          </div>
        </div>
        {lanes.length > 0 && (
          <div className="enz-detail__gel">
            <Gel lanes={lanes} />
          </div>
        )}
      </div>
    </aside>
  );
}
