import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import { type PrimerPair, type PrimerReport, type Range, type SeqDocument } from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { PRIMER_BLAST_SENDS, primerBlastUrl } from '../primerBlast';
import { addFeaturesAsOneStep } from '../state/featureSteps';
import { useRemembered } from '../state/panelMemory';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { type PrimerDesign, pct, primerFeature, productRange, tm } from './primerDesign';
import {
  DEFAULT_RESULTS_SORT,
  NO_RESULTS_FILTER,
  type ResultRow,
  type ResultsFilter,
  type ResultsSort,
  type ResultsSortKey,
  filterRows,
  pairAsText,
  pairChecks,
  sortRows,
} from './primerResults';
import { type WorkspaceLayout } from '../primerWorkspace';
import { SortTh } from './SortTh';
import { nextRowIndex, toggleSort } from './tableKeys';

/** "45–66", a site 1-based and inclusive, the end wrapped onto a circle. */
function span(r: Range, seqLength: number): string {
  return `${(r.start + 1).toLocaleString()}–${(((r.end - 1) % Math.max(1, seqLength)) + 1).toLocaleString()}`;
}

/** The pair's two oligos as `primer_bind` features, one undo step (#96). */
function addBoth(pair: PrimerPair, rank: number): void {
  addFeaturesAsOneStep(
    [
      primerFeature(`Fwd primer ${rank}`, pair.forwardSite, 'forward', pair.forward.sequence),
      primerFeature(`Rev primer ${rank}`, pair.reverseSite, 'reverse', pair.reverse.sequence),
    ],
    pair.reverseSite,
  );
}

function saveBoth(
  doc: SeqDocument,
  designedFor: string,
  pair: PrimerPair,
  rank: number,
): Promise<string> {
  const note = (p: PrimerReport): string =>
    `Designed for ${doc.name} ${designedFor}; Tm ${tm(p.tm)}, GC ${pct(p.gc)}`;
  return savePrimers(
    [
      {
        name: `${doc.name} fwd ${rank}`,
        sequence: pair.forward.sequence,
        notes: note(pair.forward),
      },
      {
        name: `${doc.name} rev ${rank}`,
        sequence: pair.reverse.sequence,
        notes: note(pair.reverse),
      },
    ],
    'design',
  ).then((r) =>
    r.added.length === 0
      ? 'Already in My primers.'
      : `Saved ${r.added.map((q) => q.name).join(' and ')} to My primers.`,
  );
}

/** The #298 slot: stage a opens NCBI; stage b would fill this with the result. */
function SpecCell() {
  return (
    <span
      className="spec spec--none"
      data-tip="Not checked. Check specificity… opens NCBI Primer-BLAST"
    >
      not checked
    </span>
  );
}

/** One primer's line in the detail pane. */
function OligoRow({
  strand,
  primer,
  site,
  seqLength,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: PrimerReport;
  readonly site: Range;
  readonly seqLength: number;
}) {
  return (
    <tr>
      <th scope="row">{strand === 'forward' ? '→ Forward' : '← Reverse'}</th>
      <td className="panel__mono dt__seq">{primer.sequence}</td>
      <td className="wst__n">{primer.length} nt</td>
      <td className="wst__n" data-tip="Melting temperature">
        Tm {primer.tm.toFixed(1)}
      </td>
      <td className="wst__n" data-tip="GC content">
        GC {pct(primer.gc)}
      </td>
      <td className="wst__n" data-tip="Where it anneals">
        {span(site, seqLength)}
      </td>
      <td
        className={primer.gcClamp ? 'dt__ok' : 'dt__warn'}
        data-tip="Whether the 3′ end is G or C"
      >
        {primer.gcClamp ? 'clamp' : 'no clamp'}
      </td>
    </tr>
  );
}

interface DetailProps {
  readonly doc: SeqDocument;
  readonly design: PrimerDesign;
  readonly row: ResultRow;
  readonly onSaid: (note: string) => void;
}

/**
 * The detail pane (item 107): the selected pair in full — both primers with
 * their positions, the dimer checks, and the actions. "Show on map" is the
 * pair's preview and the product's selection, unticked without losing the
 * row (point 3). "Check specificity…" is #298's link: a plain anchor, so
 * the address it opens is in the status bar before it is clicked.
 */
function PairDetail({ doc, design, row, onSaid }: DetailProps) {
  const { pair, index } = row;
  const rank = index + 1;
  const checks = useMemo(() => pairChecks(pair, doc), [pair, doc]);
  const product = productRange(pair, doc.length);
  const two = (a: number, b: number): string => `${a} · ${b}`;
  const blast = primerBlastUrl({ forward: pair.forward.sequence, reverse: pair.reverse.sequence });
  return (
    <aside className="detail" aria-label={`Pair ${rank}`}>
      <div className="detail__head">
        <strong>Pair {rank}</strong>
        <span className="dnote">
          {pair.productLength.toLocaleString()} bp · {span(product, doc.length)} · ΔTm{' '}
          {pair.tmDifference.toFixed(1)} °C
        </span>
        <label className="chk detail__show">
          <input
            type="checkbox"
            checked={design.shown === index}
            onChange={(e) => {
              design.setFollowMap(e.target.checked);
            }}
          />
          Show on map
        </label>
      </div>
      <table className="dt">
        <tbody>
          <OligoRow
            strand="forward"
            primer={pair.forward}
            site={pair.forwardSite}
            seqLength={doc.length}
          />
          <OligoRow
            strand="reverse"
            primer={pair.reverse}
            site={pair.reverseSite}
            seqLength={doc.length}
          />
        </tbody>
      </table>
      <div className="detail__checks">
        <span data-tip="Longest hairpin stem, forward · reverse, bp">
          hairpin {two(...checks.hairpin)}
        </span>
        <span data-tip="Longest self-complementary stretch, forward · reverse, bp">
          self-dimer {two(...checks.selfDimer)}
        </span>
        <span data-tip="3′ end pairing with itself, forward · reverse, and between the two, bp">
          3′ dimer {two(...checks.threePrimeSelf)} · cross {checks.crossDimer}
        </span>
        <span data-tip="Other sites on this document each primer would also anneal to, forward · reverse">
          elsewhere{' '}
          {checks.elsewhere[0] === 0 && checks.elsewhere[1] === 0
            ? 'none'
            : two(...checks.elsewhere)}
        </span>
      </div>
      <div className="actions">
        <button
          type="button"
          className="button button--small"
          aria-label="Add both as features"
          data-tip="Annotate both sites as primer_bind features, one undo step"
          onClick={() => {
            addBoth(pair, rank);
          }}
        >
          Add both
        </button>
        <button
          type="button"
          className="button button--small"
          data-tip="Keep both primers in My primers, in this browser"
          onClick={() => {
            void saveBoth(doc, design.designedFor, pair, rank).then(onSaid);
          }}
        >
          Save both
        </button>
        <button
          type="button"
          className="button button--small"
          data-tip="Copy both oligos, 5′ to 3′, name and bases a line each"
          onClick={() => {
            copyText(pairAsText(pair, rank));
            onSaid('Copied both primers.');
          }}
        >
          Copy
        </button>
        <span className="actions__gap" />
        <a
          className="button button--small"
          href={blast}
          target="_blank"
          rel="noopener noreferrer"
          data-tip={PRIMER_BLAST_SENDS}
          onClick={() => {
            analytics.track('primers', 'primer-blast');
          }}
        >
          Check specificity…
        </a>
        <SpecCell />
      </div>
    </aside>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly design: PrimerDesign;
  readonly layout: WorkspaceLayout;
}

/**
 * The workspace's Results page (item 107): the designed pairs as a dense
 * table, sorted by any column and narrowed by a box and three chips, with
 * the selected pair's detail pane under it. Selecting a row (a click, or
 * `↑ ↓` with the keyboard in the table) shows the pair on the map. On a
 * phone the table is a list of rows and the selected one opens out.
 */
export function PrimerCandidates({ doc, design, layout }: Props) {
  const { documentId } = useEditorState();
  const { pairs, designedFor, selected, select, setHovered } = design;
  const [sort, setSort] = useRemembered<ResultsSort>(
    'primers.resultsSort',
    documentId,
    DEFAULT_RESULTS_SORT,
  );
  const [filter, setFilter] = useRemembered<ResultsFilter>(
    'primers.resultsFilter',
    documentId,
    NO_RESULTS_FILTER,
  );
  /** What the last save or copy came to, said under the pane. */
  const [said, setSaid] = useState<string | null>(null);
  const rowsEl = useRef<HTMLElement | null>(null);
  const holdRows = (el: HTMLElement | null): void => {
    rowsEl.current = el;
  };

  const rows = useMemo<ResultRow[]>(
    () => (pairs ?? []).map((pair, index) => ({ index, pair })),
    [pairs],
  );
  const visible = useMemo(
    () => sortRows(filterRows(rows, filter, doc.length), sort),
    [rows, filter, sort, doc.length],
  );

  if (pairs === null) {
    return <p className="panel__note">No design yet. Design primers for a target first.</p>;
  }
  if (pairs.length === 0) {
    return (
      <p className="panel__note">
        No suitable pairs for {designedFor}. Try a different region, look further from it, or loosen
        the settings.
      </p>
    );
  }

  const selectedRow = selected === null ? undefined : rows[selected];
  // The one row in the tab order: the selected, if it is in view, else the first.
  const stop = visible.some((r) => r.index === selected) ? selected : (visible[0]?.index ?? null);
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const at = visible.findIndex((r) => r.index === selected);
    const to = nextRowIndex(e.key, at < 0 ? null : at, visible.length);
    if (to === null) return;
    e.preventDefault();
    const next = visible[to];
    if (next === undefined) return;
    select(next.index);
    rowsEl.current?.querySelector<HTMLElement>(`[data-row="${next.index}"]`)?.focus();
  };
  const onSort = (key: ResultsSortKey): void => {
    setSort((s) => toggleSort(s, key));
  };
  const chip = (key: 'closeTm' | 'clampBoth' | 'noHairpin', label: string, tip: string) => (
    <button
      type="button"
      className={`button button--small button--toggle${filter[key] ? ' button--toggle-on' : ''}`}
      aria-pressed={filter[key]}
      data-tip={tip}
      onClick={() => {
        setFilter((f) => ({ ...f, [key]: !f[key] }));
      }}
    >
      {label}
    </button>
  );
  const hover = {
    onMouseEnter: (i: number) => {
      setHovered(i);
    },
    onMouseLeave: (i: number) => {
      setHovered((h) => (h === i ? null : h));
    },
  };
  const detail =
    selectedRow === undefined ? null : (
      <PairDetail doc={doc} design={design} row={selectedRow} onSaid={setSaid} />
    );

  return (
    <div className="results">
      <div className="filters">
        {layout === 'phone' && (
          <select
            className="panel__select"
            aria-label="Sort by"
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':') as [ResultsSortKey, 'asc' | 'desc'];
              setSort({ key, dir });
            }}
          >
            <option value="rank:asc">Rank</option>
            <option value="product:asc">Product, shortest first</option>
            <option value="product:desc">Product, longest first</option>
            <option value="dtm:asc">ΔTm, smallest first</option>
            <option value="fwdTm:asc">Forward Tm</option>
            <option value="revTm:asc">Reverse Tm</option>
          </select>
        )}
        <input
          className="panel__search results__filter"
          type="search"
          placeholder="Filter bases, position, #rank"
          aria-label="Filter pairs"
          value={filter.query}
          onChange={(e) => {
            setFilter((f) => ({ ...f, query: e.target.value }));
          }}
        />
        {chip('closeTm', 'ΔTm ≤ 1', 'Pairs whose primers differ by 1 °C or less')}
        {chip('clampBoth', 'GC clamp both', 'Both primers end in G or C')}
        {chip('noHairpin', 'No hairpin', 'Neither primer folds into a hairpin')}
        <span className="dnote" role="status">
          {visible.length} of {pairs.length}
        </span>
      </div>
      {layout === 'phone' ? (
        <ul className="plist" aria-label="Candidate pairs" ref={holdRows} onKeyDown={onRowsKeyDown}>
          {visible.map(({ index, pair }) => {
            const on = index === selected;
            return (
              <li
                key={index}
                className={`prow${on ? ' is-selected' : ''}`}
                aria-current={on ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="prow__h"
                  data-row={index}
                  tabIndex={index === stop ? 0 : -1}
                  aria-expanded={on}
                  onClick={() => {
                    select(on ? null : index);
                  }}
                >
                  <b>#{index + 1}</b>
                  <span>{pair.productLength.toLocaleString()} bp</span>
                  <span>ΔTm {pair.tmDifference.toFixed(1)}</span>
                  <span>
                    Tm {pair.forward.tm.toFixed(1)} / {pair.reverse.tm.toFixed(1)}
                  </span>
                </button>
                {on && <div className="prow__d">{detail}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div className="tablewrap">
            <table className="wst cands" role="grid" aria-label="Candidate pairs">
              <thead>
                <tr>
                  <SortTh
                    column="rank"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Rank: lowest penalty first"
                  >
                    #
                  </SortTh>
                  <SortTh
                    column="product"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Product length, bp"
                  >
                    Product
                  </SortTh>
                  <SortTh column="dtm" sort={sort} onSort={onSort} numeric tip="Tm difference, °C">
                    ΔTm
                  </SortTh>
                  <SortTh column="fwd" sort={sort} onSort={onSort}>
                    Forward 5′→3′
                  </SortTh>
                  <SortTh column="fwdTm" sort={sort} onSort={onSort} numeric tip="Forward Tm, °C">
                    Tm
                  </SortTh>
                  <SortTh
                    column="fwdGc"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Forward GC content"
                  >
                    GC
                  </SortTh>
                  <SortTh column="rev" sort={sort} onSort={onSort}>
                    Reverse 5′→3′
                  </SortTh>
                  <SortTh column="revTm" sort={sort} onSort={onSort} numeric tip="Reverse Tm, °C">
                    Tm
                  </SortTh>
                  <SortTh
                    column="revGc"
                    sort={sort}
                    onSort={onSort}
                    numeric
                    tip="Reverse GC content"
                  >
                    GC
                  </SortTh>
                  <th className="wst__th" data-tip="Specificity (NCBI Primer-BLAST)">
                    Spec.
                  </th>
                </tr>
              </thead>
              <tbody ref={holdRows} onKeyDown={onRowsKeyDown}>
                {visible.map(({ index, pair }) => {
                  const on = index === selected;
                  return (
                    <tr
                      key={index}
                      className={`cand${on ? ' is-selected' : ''}`}
                      data-row={index}
                      tabIndex={index === stop ? 0 : -1}
                      aria-selected={on}
                      onClick={() => {
                        select(index);
                      }}
                      onMouseEnter={() => {
                        hover.onMouseEnter(index);
                      }}
                      onMouseLeave={() => {
                        hover.onMouseLeave(index);
                      }}
                    >
                      <td className="wst__n">{index + 1}</td>
                      <td className="wst__n">{pair.productLength.toLocaleString()}</td>
                      <td className="wst__n">{pair.tmDifference.toFixed(1)}</td>
                      <td className="panel__mono wst__seq">{pair.forward.sequence}</td>
                      <td className="wst__n">{pair.forward.tm.toFixed(1)}</td>
                      <td className="wst__n">{Math.round(pair.forward.gc * 100)}</td>
                      <td className="panel__mono wst__seq">{pair.reverse.sequence}</td>
                      <td className="wst__n">{pair.reverse.tm.toFixed(1)}</td>
                      <td className="wst__n">{Math.round(pair.reverse.gc * 100)}</td>
                      <td>
                        <SpecCell />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && (
            <p className="panel__note panel__note--quiet">No pair matches the filter.</p>
          )}
          {detail ?? (
            <p className="panel__note panel__note--quiet results__hint">
              Select a pair to see it in full and on the map.
            </p>
          )}
        </>
      )}
      {said !== null && (
        <p className="panel__note panel__note--quiet" role="status">
          {said}
        </p>
      )}
    </div>
  );
}
