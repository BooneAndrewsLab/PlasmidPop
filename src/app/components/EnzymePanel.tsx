import { useMemo, useState } from 'react';

import {
  type CutSite,
  type SeqDocument,
  ENZYMES,
  digestFragments,
  getEnzyme,
  overhangKind,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

function describeSite(site: CutSite): string {
  return site.cut.toLocaleString();
}

export function EnzymePanel({ doc }: Props) {
  const { analysis, shownEnzymes } = useEditorState();
  const [singleOnly, setSingleOnly] = useState(false);
  const [filter, setFilter] = useState('');
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
    return ENZYMES.map((enzyme) => ({ enzyme, sites: byName.get(enzyme.name) ?? [] }));
  }, [analysis, ready]);

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
      (needle === '' ||
        g.enzyme.name.toLowerCase().includes(needle) ||
        g.enzyme.site.toLowerCase().includes(needle)),
  );
  const nonCutters = groups.filter((g) => g.sites.length === 0).length;

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
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
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
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : (
        <>
          <ul className="enzyme-list">
            {rows.map(({ enzyme, sites }) => (
              <li key={enzyme.name} className="enzyme-row">
                <label className="enzyme-row__toggle" title="Show cut sites in the views">
                  <input
                    type="checkbox"
                    checked={shownEnzymes.has(enzyme.name)}
                    onChange={(e) => {
                      editorStore.setEnzymeShown(enzyme.name, e.target.checked);
                    }}
                  />
                  <span className="enzyme-row__name">{enzyme.name}</span>
                </label>
                <span className="enzyme-row__site" title={`${overhangKind(enzyme)} overhang`}>
                  {enzyme.site}
                </span>
                <span className="enzyme-row__cuts">
                  {sites.map((s, i) => (
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
                </span>
              </li>
            ))}
          </ul>
          <p className="panel__note">
            {rows.length} of {ENZYMES.length} enzymes cut{singleOnly ? ' once' : ''}. {nonCutters}{' '}
            do not cut.
          </p>
          {fragments.length > 0 && (
            <div className="panel__section">
              <h3 className="panel__heading">Fragments from shown enzymes</h3>
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
