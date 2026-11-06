import { useEffect, useId, useMemo, useState } from 'react';

import {
  type CutSite,
  type Enzyme,
  type EnzymeSites,
  type SeqDocument,
  bandProblems,
  cutLabel,
  describeBands,
  formatInt,
  getEnzyme,
  type HostMethylationState,
  describeHost,
  hostMarksFromBits,
  isHostMethylationSensitive,
  isDoubleCutter,
  overhangKind,
} from '@/core';

import { CUT_COUNT_OPTIONS, cutCountPhrase, isCutCountFilter } from '../state/cutFilter';
import { ENZYME_SORT_OPTIONS, isEnzymeSort } from '../state/enzymeSort';
import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { BandLine } from './BandLine';
import { CustomEnzymeForm } from './CustomEnzymeForm';
import type { EnzymeList } from './enzymeList';
import { EnzymeImport } from './EnzymeImport';
import { Gel } from './Gel';
import { useRowWindow } from './useRowWindow';

/**
 * The strains a document can say it came from (#45). Not every combination
 * a lab could make, but the four a digest is planned against: the ordinary
 * one, either knockout, and DNA that was never in a cell.
 */
const HOSTS: readonly HostMethylationState[] = [
  { dam: true, dcm: true },
  { dam: true, dcm: false },
  { dam: false, dcm: true },
  { dam: false, dcm: false },
];

/**
 * Cut positions listed in one row before the rest become a count. An imported
 * REBASE table has four-base cutters that hit a plasmid a hundred times, and
 * a hundred numbers in a row is not a list anyone reads.
 */
const MAX_SITES_SHOWN = 12;

/** The sites a row lists, made one by one rather than all of the enzyme's (#281). */
function firstSites(site: EnzymeSites['site'], count: number): CutSite[] {
  const out: CutSite[] = [];
  for (let i = 0; i < Math.min(count, MAX_SITES_SHOWN); i++) {
    const s = site(i);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/**
 * Height assumed for a row not yet measured, in pixels: a name and one line
 * of cut positions. Only rows below the viewport are ever guessed at, so the
 * guess costs nothing but a slightly wrong scrollbar.
 */
const ROW_ESTIMATE = 46;

/** How many of a row's sites carry a Dam or Dcm mark. */
function countMarked(marks: Iterable<number>): number {
  let n = 0;
  for (const bits of marks) if (bits !== 0) n++;
  return n;
}

/**
 * How long a list "Show listed" will tick in one go. Ticking every enzyme of
 * an imported REBASE table is around 1,400 of them and 63,000 cut sites to
 * label, which no view can draw; past this the button asks for a narrower
 * list instead of taking the page down.
 */
const MAX_SHOW_LISTED = 200;

function describeSite(site: CutSite, doc: SeqDocument): string {
  return formatInt(cutLabel(site.cut, doc.length, doc.topology));
}

/** Tooltip for an enzyme: the overhang, and whatever an import added. */
function describeEnzyme(enzyme: Enzyme): string {
  const lines = [`${overhangKind(enzyme)} overhang`];
  if (isDoubleCutter(enzyme)) {
    lines.push(
      'Cuts on both sides of its site, so each site is two cuts and leaves on a short piece',
    );
  }
  if (enzyme.suppliers !== undefined && enzyme.suppliers.length > 0) {
    lines.push(`Suppliers: ${enzyme.suppliers.join('')}`);
  }
  if (enzyme.methylation !== undefined) {
    lines.push(`Methylated by its own MTase at ${enzyme.methylation}`);
  }
  if (isHostMethylationSensitive(enzyme.name)) {
    lines.push(
      'Blocked or impaired by Dam or Dcm methylation where it overlaps the site (NEB); marked sites are those',
    );
  }
  const iso = enzyme.isoschizomers ?? [];
  if (iso.length > 0) {
    lines.push(`Isoschizomers: ${iso.slice(0, 8).join(', ')}${iso.length > 8 ? ', …' : ''}`);
  }
  return lines.join('\n');
}

/**
 * "1 of 2 sites blocked by Dam/Dcm", under a row whose enzyme would not cut
 * every site it has in DNA grown in an ordinary E. coli strain (#17).
 */
function MethylationNote({ count, of }: { readonly count: number; readonly of: number }) {
  if (count === 0) return null;
  return (
    <span
      className="enzyme-row__methylation"
      data-tip="Most laboratory E. coli strains methylate GATC (Dam) and CCWGG (Dcm). Grow the plasmid in a dam–/dcm– strain, or use an isoschizomer that is not sensitive, to cut these sites."
    >
      {count === of ? (of === 1 ? 'Its site' : `All ${of} sites`) : `${count} of ${of} sites`} may
      be blocked by Dam/Dcm methylation
    </span>
  );
}

/** "BstI, AliI and 3 more", a row's other names. */
function describeOthers(shown: Enzyme, members: readonly Enzyme[]): string {
  const others = members.filter((e) => e !== shown).map((e) => e.name);
  const named = others.slice(0, 8);
  const rest = others.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  return named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`
    : named.join('');
}

/** The pieces of the Enzymes list the slim panel and the Enzyme workspace both mount (item 133). */
interface ListProps {
  readonly doc: SeqDocument;
  readonly list: EnzymeList;
}

/**
 * Where the DNA was grown (#45): a document fact that changes every digest,
 * so the workspace carries it in its head on every page.
 */
export function GrownIn({
  doc,
  className,
}: {
  readonly doc: SeqDocument;
  readonly className?: string;
}) {
  return (
    <label
      className={className}
      data-tip="Where the DNA was grown. An ordinary laboratory strain methylates GATC (Dam) and CCWGG (Dcm), which blocks some enzymes; DNA made by PCR carries neither"
    >
      <span>Grown in</span>
      <select
        className="panel__select"
        aria-label="Host methylation"
        value={describeHost(doc.methylation)}
        onChange={(e) => {
          const chosen = HOSTS.find((h) => describeHost(h) === e.target.value);
          if (chosen !== undefined) {
            editorStore.apply({ type: 'setMethylation', methylation: chosen });
          }
        }}
      >
        {HOSTS.map((h) => (
          <option key={describeHost(h)} value={describeHost(h)}>
            {describeHost(h)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The filters, the order, the supplier, the ticks' buttons and the notes a
 * hidden or empty tick state needs. `host` puts **Grown in** among them: the
 * workspace has it in its head instead.
 */
export function EnzymeControls({
  doc,
  list,
  host = true,
}: ListProps & { readonly host?: boolean }) {
  const {
    showCutSites,
    shownEnzymes,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSort,
    enzymeGroupIsoschizomers: grouped,
    enzymeSortReversed: reversed,
  } = useEditorState();
  const orderId = useId();
  const { filter, setFilter, supplier, ready, rows, cutters, offerFilter, offered } = list;
  return (
    <>
      <div className="panel__controls">
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
          <label htmlFor={orderId}>
            <span>Order</span>
            <span className="panel__form-pair">
              <select
                id={orderId}
                className="panel__select"
                value={enzymeSort}
                data-tip="Alphabetically, or the enzymes whose fragments are furthest apart on a gel first"
                onChange={(e) => {
                  editorStore.setEnzymeSort(isEnzymeSort(e.target.value) ? e.target.value : 'name');
                }}
              >
                {ENZYME_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} title={o.title}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--quiet button--small"
                aria-pressed={reversed}
                aria-label="Reverse the order"
                data-tip={
                  enzymeSort === 'name'
                    ? 'List Z to A'
                    : 'List the lanes that would be hardest to read first'
                }
                onClick={() => {
                  editorStore.setEnzymeSortReversed(!reversed);
                }}
              >
                {reversed ? '↑' : '↓'}
              </button>
            </span>
          </label>
          {host && <GrownIn doc={doc} />}
          <span className="panel__form-label">Isoschizomers</span>
          <span className="panel__form-range">
            <label
              className="panel__form-check"
              data-tip="Enzymes that cut the same site in the same place give the same fragments and ends; list them as one row"
            >
              <input
                type="checkbox"
                checked={grouped}
                onChange={(e) => {
                  editorStore.setEnzymeGroupIsoschizomers(e.target.checked);
                }}
              />
              share a row
            </label>
          </span>
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
      {!showCutSites && (
        <p className="panel__note">
          Cut sites are hidden in the views and in the SVG exports. The ticks below still choose the
          fragments here and the enzymes the Cloning tab digests with.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              editorStore.setShowCutSites(true);
            }}
          >
            Show cut sites
          </button>
        </p>
      )}
      {ready && shownEnzymes.size === 0 && cutters > 0 && (
        <p className="panel__note">
          Nothing is ticked, so no cut sites are drawn and the Cloning tab has nothing to digest
          with.{' '}
          {offered.length > 0 && offered.length <= MAX_SHOW_LISTED && (
            <>
              <button
                type="button"
                className="link"
                onClick={() => {
                  editorStore.setShownEnzymes(offered);
                }}
              >
                Tick the {offered.length} enzymes that {cutCountPhrase(offerFilter)}
              </button>
              .
            </>
          )}
        </p>
      )}
    </>
  );
}

/** The list itself, windowed, with the line on how many enzymes it shows. */
export function EnzymeRows({ doc, list }: ListProps) {
  const {
    shownEnzymes,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSort,
    enzymeSortReversed: reversed,
  } = useEditorState();
  const { needle, supplier, ready, rows, listedEnzymes, nonCutters } = list;
  // Only the rows on screen are rendered: an imported table lists thousands.
  const { first, end, padTop, padBottom, attachScroller, attachRow, scrollToTop } = useRowWindow(
    useMemo(() => rows.map((g) => g.enzyme.name), [rows]),
    ROW_ESTIMATE,
  );
  // A new filter is a new list, and the old scroll position means nothing in it.
  useEffect(() => {
    scrollToTop();
  }, [needle, supplier, enzymeCutFilter, enzymeSort, reversed, scrollToTop]);

  const selectSite = (site: CutSite): void => {
    const enzyme = getEnzyme(site.enzyme);
    const len = enzyme?.site.length ?? 1;
    editorStore.setSelection({ start: site.siteStart, end: site.siteStart + len });
    editorStore.revealPosition(site.siteStart);
  };

  if (!ready) return <p className="panel__note">Scanning for restriction sites…</p>;
  return (
    <>
      <div className="enzyme-list__scroll" ref={attachScroller}>
        <ul className="enzyme-list" style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {rows.slice(first, end).map(({ enzyme, members, count, site, host: marks, profile }) => (
            <li key={enzyme.name} className="enzyme-row" ref={attachRow(enzyme.name)}>
              <label
                className="enzyme-row__toggle"
                data-tip="Tick to draw this enzyme's cut sites and to digest with it"
              >
                <input
                  type="checkbox"
                  checked={members.some((e) => shownEnzymes.has(e.name))}
                  onChange={(e) => {
                    if (e.target.checked) editorStore.setEnzymeShown(enzyme.name, true);
                    else {
                      // Unticking the row unticks the whole group, or an
                      // isoschizomer ticked earlier would keep it ticked.
                      const names = new Set(members.map((m) => m.name));
                      editorStore.setShownEnzymes(
                        [...shownEnzymes].filter((name) => !names.has(name)),
                      );
                    }
                  }}
                />
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
              </label>
              <span className="enzyme-row__site" data-tip={describeEnzyme(enzyme)}>
                {enzyme.site}
              </span>
              <span className="enzyme-row__cuts">
                {firstSites(site, count).map((s, i) => {
                  // Dam or Dcm inside this site in DNA from a methylating
                  // strain; see `hostMethylationAt`.
                  const host = hostMarksFromBits(marks[i] ?? 0);
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`link link--mono${host.length > 0 ? ' link--methylated' : ''}`}
                      data-tip={`Select the ${enzyme.name} site cut after base ${describeSite(s, doc)}${
                        host.length > 0
                          ? ` — ${host.join(' and ')} methylation overlaps it, so it may not cut DNA grown in a ${host.map((h) => h.toLowerCase()).join('+/')}+ strain of E. coli`
                          : ''
                      }`}
                      onClick={() => {
                        selectSite(s);
                      }}
                    >
                      {describeSite(s, doc)}
                      {host.length > 0 && <sup>m</sup>}
                    </button>
                  );
                })}
                {count > MAX_SITES_SHOWN && (
                  <span
                    className="enzyme-row__more"
                    data-tip={`${enzyme.name} cuts ${count} times in all`}
                  >
                    +{count - MAX_SITES_SHOWN}
                  </span>
                )}
              </span>
              <MethylationNote
                count={isHostMethylationSensitive(enzyme.name) ? countMarked(marks) : 0}
                of={count}
              />
              <BandLine profile={profile()} />
            </li>
          ))}
        </ul>
      </div>
      <p className="panel__note">
        {listedEnzymes.toLocaleString()} of {enzymeSetInfo.count.toLocaleString()} enzymes{' '}
        {cutCountPhrase(enzymeCutFilter)}
        {supplier === '' ? '' : ' and are sold by that supplier'}
        {rows.length < listedEnzymes
          ? `, in ${rows.length.toLocaleString()} rows with isoschizomers together`
          : ''}
        . {nonCutters.toLocaleString()} do not cut.
      </p>
    </>
  );
}

/** The table in use, with **Add enzyme…** and **Import a REBASE table…** and their forms. */
export function EnzymeSource() {
  const { enzymeSetInfo } = useEditorState();
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <p className="panel__note panel__note--quiet">
        {enzymeSetInfo.bundled
          ? 'Scanning with the bundled table of common cloning enzymes.'
          : `Scanning with ${enzymeSetInfo.label}${
              enzymeSetInfo.fileName === null ? '' : `, from ${enzymeSetInfo.fileName}`
            }.`}
        {enzymeSetInfo.custom.length > 0
          ? ` Plus ${enzymeSetInfo.custom.length.toLocaleString()} of your own.`
          : ''}{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            setAdding((v) => !v);
          }}
        >
          {adding ? 'Hide add enzyme' : 'Add enzyme…'}
        </button>{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            setImporting((v) => !v);
          }}
        >
          {importing ? 'Hide import' : 'Import a REBASE table…'}
        </button>
      </p>
      {adding && (
        <CustomEnzymeForm
          onClose={() => {
            setAdding(false);
          }}
        />
      )}
      {importing && (
        <EnzymeImport
          onClose={() => {
            setImporting(false);
          }}
        />
      )}
    </>
  );
}

/** The ticked enzymes' fragments: the gel, the lengths and how it would read. */
export function EnzymeFragments({ list }: { readonly list: EnzymeList }) {
  const gel = useGelOptions();
  const { fragments, ticked, tickedGroups, lanes } = list;
  if (fragments.length === 0) return null;
  return (
    <div className="panel__section">
      <h3 className="panel__heading">Fragments from ticked enzymes</h3>
      {/* The lane before the numbers: the question a diagnostic digest
                  is chosen to answer is "will I see two bands", and that is a
                  question for the eye. Clicking one selects the piece it is. */}
      <Gel lanes={lanes} />
      <p className="panel__mono">{fragments.map((f) => f.length.toLocaleString()).join(', ')} bp</p>
      {lanes.length > 1 && (
        <p className="panel__note panel__note--quiet" data-testid="gel-singles">
          Beside it, each alone:{' '}
          {tickedGroups.map((g) => `${g.name} ${describeBands(g.profile)}`).join('; ')}.
        </p>
      )}
      {/* The pieces are one thing, the lane is another: a digest of
                  five fragments can still show three bands. */}
      <p
        className={`panel__note${ticked.misleading ? ' panel__note--warn' : ''}`}
        data-testid="gel-reading"
      >
        {ticked.misleading
          ? `On a gel: ${describeBands(ticked, 6)} — ${bandProblems(ticked, gel).join('; ')}.`
          : `On a gel: ${ticked.bands.length === 1 ? '1 band' : `${ticked.bands.length} bands`}, ${describeBands(ticked, 6)}.`}
      </p>
    </div>
  );
}
