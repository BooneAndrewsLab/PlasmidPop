import { useMemo, useState } from 'react';

import {
  type CutSite,
  type Enzyme,
  type SeqDocument,
  activeEnzymes,
  digestFragments,
  getEnzyme,
  overhangKind,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { EnzymeImport } from './EnzymeImport';

interface Props {
  readonly doc: SeqDocument;
}

/**
 * Cut positions listed in one row before the rest become a count. An imported
 * REBASE table has four-base cutters that hit a plasmid a hundred times, and
 * a hundred numbers in a row is not a list anyone reads.
 */
const MAX_SITES_SHOWN = 12;

/**
 * Enzyme rows rendered at once. With the bundled table this never bites, but
 * an imported REBASE table has around 1,500 enzymes and most of them cut a
 * plasmid somewhere; rendering every row locks the page up for seconds. The
 * filters above the list are how you get to the one you want, so the tail is
 * cut off with a note rather than virtualized.
 */
const MAX_ROWS_SHOWN = 200;

function describeSite(site: CutSite): string {
  return site.cut.toLocaleString();
}

/** Tooltip for an enzyme: the overhang, and whatever an import added. */
function describeEnzyme(enzyme: Enzyme): string {
  const lines = [`${overhangKind(enzyme)} overhang`];
  if (enzyme.suppliers !== undefined && enzyme.suppliers.length > 0) {
    lines.push(`Suppliers: ${enzyme.suppliers.join('')}`);
  }
  if (enzyme.methylation !== undefined) {
    lines.push(`Methylated by its own MTase at ${enzyme.methylation}`);
  }
  const iso = enzyme.isoschizomers ?? [];
  if (iso.length > 0) {
    lines.push(`Isoschizomers: ${iso.slice(0, 8).join(', ')}${iso.length > 8 ? ', …' : ''}`);
  }
  return lines.join('\n');
}

export function EnzymePanel({ doc }: Props) {
  const { analysis, shownEnzymes, showCutSites, enzymeSetInfo } = useEditorState();
  const [singleOnly, setSingleOnly] = useState(false);
  const [filter, setFilter] = useState('');
  const [supplier, setSupplier] = useState('');
  const [importing, setImporting] = useState(false);
  const ready = analysis !== null && analysis.doc === doc;

  const groups = useMemo(() => {
    const byName = new Map<string, CutSite[]>();
    if (ready) {
      for (const s of analysis.cutSites) {
        const list = byName.get(s.enzyme) ?? [];
        list.push(s);
        byName.set(s.enzyme, list);
      }
    }
    return activeEnzymes().map((enzyme) => ({ enzyme, sites: byName.get(enzyme.name) ?? [] }));
    // The enzymes come from module state, so the memo has to be told to
    // re-run when the set changes; `enzymeSetInfo` is the store's record of
    // which set that is, and the linter cannot see the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, ready, enzymeSetInfo]);

  const shownCuts = useMemo(() => {
    const cuts: number[] = [];
    for (const g of groups)
      if (shownEnzymes.has(g.enzyme.name)) for (const s of g.sites) cuts.push(s.cut);
    return cuts;
  }, [groups, shownEnzymes]);
  const fragments = useMemo(
    () =>
      shownCuts.length === 0
        ? []
        : digestFragments(shownCuts, doc.length, doc.topology).sort((a, b) => b.length - a.length),
    [shownCuts, doc.length, doc.topology],
  );

  const needle = filter.trim().toLowerCase();
  const rows = groups.filter(
    (g) =>
      g.sites.length > 0 &&
      (!singleOnly || g.sites.length === 1) &&
      (supplier === '' || g.enzyme.suppliers?.includes(supplier) === true) &&
      (needle === '' ||
        g.enzyme.name.toLowerCase().includes(needle) ||
        g.enzyme.site.toLowerCase().includes(needle)),
  );
  const nonCutters = groups.filter((g) => g.sites.length === 0).length;
  const shownRows = rows.slice(0, MAX_ROWS_SHOWN);
  /**
   * Every enzyme that cuts once, whatever the filters say. This is what a
   * document ticks by itself when there are few enough of them
   * (`MAX_DEFAULT_ENZYMES`); with a REBASE table there are too many, and the
   * note below is how you ask for them anyway.
   */
  const singleCutters = groups.filter((g) => g.sites.length === 1).map((g) => g.enzyme.name);

  const selectSite = (site: CutSite): void => {
    const enzyme = getEnzyme(site.enzyme);
    const len = enzyme?.site.length ?? 1;
    editorStore.setSelection({ start: site.siteStart, end: site.siteStart + len });
    editorStore.revealPosition(site.siteStart);
  };

  return (
    <div className="panel">
      <div className="panel__controls">
        <input
          className="panel__search"
          type="search"
          placeholder="Filter enzymes or sites"
          aria-label="Filter enzymes"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
          }}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={singleOnly}
            onChange={(e) => {
              setSingleOnly(e.target.checked);
            }}
          />
          Single cutters only
        </label>
        {enzymeSetInfo.suppliers.length > 0 && (
          <label className="panel__field panel__field--row">
            <span>Sold by</span>
            <select
              className="panel__select"
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
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
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              editorStore.setShownEnzymes(shownRows.map((g) => g.enzyme.name));
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
      {ready && shownEnzymes.size === 0 && singleCutters.length > 0 && (
        <p className="panel__note">
          Nothing is ticked, so no cut sites are drawn and the Cloning tab has nothing to digest
          with.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              editorStore.setShownEnzymes(singleCutters);
            }}
          >
            Tick the {singleCutters.length} enzymes that cut once
          </button>
          .
        </p>
      )}
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : (
        <>
          <ul className="enzyme-list">
            {shownRows.map(({ enzyme, sites }) => (
              <li key={enzyme.name} className="enzyme-row">
                <label
                  className="enzyme-row__toggle"
                  title="Tick to draw this enzyme's cut sites and to digest with it"
                >
                  <input
                    type="checkbox"
                    checked={shownEnzymes.has(enzyme.name)}
                    onChange={(e) => {
                      editorStore.setEnzymeShown(enzyme.name, e.target.checked);
                    }}
                  />
                  <span className="enzyme-row__name">{enzyme.name}</span>
                </label>
                <span className="enzyme-row__site" title={describeEnzyme(enzyme)}>
                  {enzyme.site}
                </span>
                <span className="enzyme-row__cuts">
                  {sites.slice(0, MAX_SITES_SHOWN).map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="link link--mono"
                      title={`Select the ${enzyme.name} site cut after base ${describeSite(s)}`}
                      onClick={() => {
                        selectSite(s);
                      }}
                    >
                      {describeSite(s)}
                    </button>
                  ))}
                  {sites.length > MAX_SITES_SHOWN && (
                    <span
                      className="enzyme-row__more"
                      title={`${enzyme.name} cuts ${sites.length} times in all`}
                    >
                      +{sites.length - MAX_SITES_SHOWN}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="panel__note">
            {rows.length} of {enzymeSetInfo.count.toLocaleString()} enzymes cut
            {singleOnly ? ' once' : ''}
            {supplier === '' ? '' : ' and are sold by that supplier'}. {nonCutters} do not cut.
            {rows.length > MAX_ROWS_SHOWN &&
              ` Showing the first ${MAX_ROWS_SHOWN}; filter to narrow the list.`}
          </p>
          <p className="panel__note panel__note--quiet">
            {enzymeSetInfo.bundled
              ? 'Scanning with the bundled table of common cloning enzymes.'
              : `Scanning with ${enzymeSetInfo.label}${
                  enzymeSetInfo.fileName === null ? '' : `, from ${enzymeSetInfo.fileName}`
                }.`}{' '}
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
          {importing && (
            <EnzymeImport
              onClose={() => {
                setImporting(false);
              }}
            />
          )}
          {fragments.length > 0 && (
            <div className="panel__section">
              <h3 className="panel__heading">Fragments from ticked enzymes</h3>
              <p className="panel__mono">
                {fragments.map((f) => f.length.toLocaleString()).join(', ')} bp
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
