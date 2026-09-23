import { useEffect, useMemo, useState } from 'react';

import {
  type CutSite,
  type DigestProfile,
  type Enzyme,
  type Fragment,
  type GelBand,
  type SeqDocument,
  activeEnzymes,
  bandProblems,
  bestPairs,
  compareDiagnostic,
  describeBands,
  digestFragments,
  enzymeProfile,
  gelProfile,
  getEnzyme,
  overhangKind,
} from '@/core';

import {
  CUT_COUNT_OPTIONS,
  cutCountPhrase,
  isCutCountFilter,
  matchesCutCount,
} from '../state/cutFilter';
import { ENZYME_SORT_OPTIONS, isEnzymeSort } from '../state/enzymeSort';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { EnzymeImport } from './EnzymeImport';
import { Gel, type GelLane } from './Gel';
import { useRowWindow } from './useRowWindow';

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
 * Height assumed for a row not yet measured, in pixels: a name and one line
 * of cut positions. Only rows below the viewport are ever guessed at, so the
 * guess costs nothing but a slightly wrong scrollbar.
 */
const ROW_ESTIMATE = 46;

/**
 * How long a list "Show listed" will tick in one go. Ticking every enzyme of
 * an imported REBASE table is around 1,400 of them and 63,000 cut sites to
 * label, which no view can draw; past this the button asks for a narrower
 * list instead of taking the page down.
 */
const MAX_SHOW_LISTED = 200;

/**
 * How many ticked enzymes still get a lane each beside the combined digest.
 * Three is a triple digest; more than that is not a digest anyone runs to
 * check a construct, and five lanes of 32 units are too narrow to name.
 */
const MAX_SINGLE_LANES = 3;

/**
 * The enzymes a double digest is looked for among: those cutting at most
 * this many times. A pair of frequent cutters is a lane of a dozen bands,
 * which `compareDiagnostic` would rank last anyway.
 */
const MAX_PAIR_CUTS = 3;
/**
 * How many of them are paired, fewest cuts first. Every pair is a digest,
 * so this is quadratic: 120 is 7,140 pairs and about 13 ms, and a REBASE
 * table can list several hundred (docs/perf-notes.md).
 */
const MAX_PAIR_CANDIDATES = 120;
const PAIRS_SHOWN = 5;

/** "2,181 and 2,180", the pieces hidden under one band. */
function describeBandFragments(band: GelBand): string {
  const shown = band.fragments.slice(0, 3).map((n) => n.toLocaleString());
  const rest = band.fragments.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(' and ');
}

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

/**
 * The bands this enzyme alone would give, which is what a diagnostic digest
 * is actually chosen by: a cut count says nothing about whether the pieces
 * can be told apart. Bands that would run together, or off the end of the
 * gel, are said rather than left to be worked out from the numbers.
 */
function BandLine({ profile }: { readonly profile: DigestProfile }) {
  const problems = bandProblems(profile);
  // A single cutter gives one band and no warning: it linearises the
  // plasmid, which is what it is for. The mark is for a lane that hides
  // something, not for one with nothing to say.
  const clear = !profile.misleading;
  return (
    <span
      className={`enzyme-row__bands${clear ? '' : ' enzyme-row__bands--muddy'}`}
      title={
        clear
          ? `On a gel: ${describeBands(profile, 12)}`
          : `On a gel: ${describeBands(profile, 12)} — ${problems.join('; ')}`
      }
    >
      {describeBands(profile)}
      {clear ? '' : ' ⚠'}
    </span>
  );
}

interface DoubleDigestsProps {
  /** The rows the list is showing, in its order, so its filters narrow the pairs too. */
  readonly listed: readonly { readonly enzyme: Enzyme; readonly sites: readonly CutSite[] }[];
  readonly doc: SeqDocument;
  readonly shownEnzymes: ReadonlySet<string>;
}

/**
 * The best double digests among the enzymes listed, under a list ordered by
 * band separation: the same question asked of pairs, for when no enzyme on
 * its own gives a lane worth running. "Tick both" ticks the pair alone, and
 * the gel below then draws their digest beside each single one.
 */
function DoubleDigests({ listed, doc, shownEnzymes }: DoubleDigestsProps) {
  // Keyed on the names rather than on `listed`, a new array every render.
  const key = listed
    .filter((g) => g.sites.length > 0 && g.sites.length <= MAX_PAIR_CUTS)
    .map((g) => g.enzyme.name)
    .join(' ');
  const poolSize = key === '' ? 0 : key.split(' ').length;
  const pairs = useMemo(() => {
    const names = new Set(key.split(' '));
    const pool = listed
      .filter((g) => names.has(g.enzyme.name))
      .sort((a, b) => a.sites.length - b.sites.length)
      .slice(0, MAX_PAIR_CANDIDATES);
    return bestPairs(
      pool.map((g) => ({ name: g.enzyme.name, cuts: g.sites.map((site) => site.cut) })),
      doc.length,
      doc.topology,
      PAIRS_SHOWN,
    );
    // `listed` is read only through the names in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc.length, doc.topology]);
  if (poolSize < 2) return null;

  return (
    <div className="panel__section" data-testid="double-digests">
      <h3 className="panel__heading">Double digests</h3>
      {pairs.length === 0 ? (
        <p className="panel__note">
          No pair of the enzymes listed gives a lane that can be read at a glance.
        </p>
      ) : (
        <ul className="enzyme-list">
          {pairs.map((pair) => {
            // A pair reads the same whichever way the list happened to be sorted.
            const [first, second] =
              pair.first.localeCompare(pair.second) <= 0
                ? [pair.first, pair.second]
                : [pair.second, pair.first];
            const { profile } = pair;
            const both =
              shownEnzymes.size === 2 && shownEnzymes.has(first) && shownEnzymes.has(second);
            return (
              <li key={`${first}+${second}`} className="enzyme-row">
                <span className="enzyme-row__pair">
                  {first} + {second}
                </span>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  disabled={both}
                  title={
                    both
                      ? 'These two are what is ticked; the gel below is their digest'
                      : `Tick ${first} and ${second} alone, to see their digest beside each on its own`
                  }
                  onClick={() => {
                    editorStore.setShownEnzymes([pair.first, pair.second]);
                  }}
                >
                  {both ? 'Ticked' : 'Tick both'}
                </button>
                <BandLine profile={profile} />
              </li>
            );
          })}
        </ul>
      )}
      <p className="panel__note panel__note--quiet">
        Pairs of the listed enzymes that cut {MAX_PAIR_CUTS} times or fewer, best separated first
        {poolSize > MAX_PAIR_CANDIDATES
          ? ` — the ${MAX_PAIR_CANDIDATES} that cut least of ${poolSize.toLocaleString()}; narrow the list to pair the others`
          : ''}
        .
      </p>
    </div>
  );
}

export function EnzymePanel({ doc }: Props) {
  const {
    analysis,
    shownEnzymes,
    showCutSites,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSupplier,
    enzymeSort,
  } = useEditorState();
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const ready = analysis !== null && analysis.doc === doc;
  // A supplier is a code out of the table in use. A code stored from another
  // import — or from before "Go back to the bundled table" — names nobody
  // here, and filtering on it would empty the list with no way to see why.
  const supplier = enzymeSetInfo.suppliers.some((s) => s.code === enzymeSupplier)
    ? enzymeSupplier
    : '';

  const groups = useMemo(() => {
    const byName = new Map<string, CutSite[]>();
    if (ready) {
      for (const s of analysis.cutSites) {
        const list = byName.get(s.enzyme) ?? [];
        list.push(s);
        byName.set(s.enzyme, list);
      }
    }
    // The bands each enzyme alone would give. Computed for every enzyme
    // rather than for the rows on screen, because the list can be ordered by
    // them; it is a sort of a handful of cut positions per enzyme, and costs
    // a couple of ms over an imported REBASE table (docs/perf-notes.md).
    return activeEnzymes().map((enzyme) => {
      const sites = byName.get(enzyme.name) ?? [];
      return {
        enzyme,
        sites,
        profile: sites.length === 0 ? null : enzymeProfile(sites, doc.length, doc.topology),
      };
    });
    // The enzymes come from module state, so the memo has to be told to
    // re-run when the set changes; `enzymeSetInfo` is the store's record of
    // which set that is, and the linter cannot see the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, ready, enzymeSetInfo, doc.length, doc.topology]);

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
  /** How everything ticked together would read on a gel. */
  const ticked = useMemo(() => gelProfile(fragments.map((f) => f.length)), [fragments]);
  /** The ticked enzymes that cut, each with its own profile. */
  const tickedGroups = useMemo(
    () =>
      groups.flatMap((g) =>
        shownEnzymes.has(g.enzyme.name) && g.profile !== null
          ? [{ name: g.enzyme.name, sites: g.sites, profile: g.profile }]
          : [],
      ),
    [groups, shownEnzymes],
  );
  /**
   * Two or three enzymes ticked is a double or triple digest, and one of
   * those is read against the single digests beside it: a band in the
   * combined lane that is in none of the others is the piece between two
   * enzymes' sites. Past three it is a survey of cut sites rather than a
   * digest anyone runs, and one lane says as much as it can.
   */
  const lanes = useMemo((): GelLane[] => {
    const pick = (pieces: readonly Fragment[], who: string) => ({
      onPick: (band: GelBand) => {
        const piece = pieces.find((f) => f.length === band.length);
        if (piece === undefined) return;
        editorStore.setSelection({ start: piece.start, end: piece.end });
        editorStore.revealPosition(piece.start);
      },
      pickTitle: (band: GelBand) =>
        `${who}${
          band.fragments.length > 1
            ? `${describeBandFragments(band)} bp run here; select the ${band.length.toLocaleString()} bp one`
            : `Select the ${band.length.toLocaleString()} bp fragment in the views`
        }`,
    });
    const n = tickedGroups.length;
    const alone = n >= 2 && n <= MAX_SINGLE_LANES;
    // A lane is narrow, so the heading under it is a name or a count, never
    // a list of five enzymes run together into one word.
    const combined: GelLane = {
      profile: ticked,
      label:
        n === 1
          ? (tickedGroups[0]?.name ?? 'Digest')
          : alone
            ? n === 2
              ? 'Both'
              : `All ${n}`
            : `${n} enzymes`,
      ...pick(fragments, alone ? `${n === 2 ? 'Both' : `All ${n}`}: ` : ''),
    };
    if (!alone) return [combined];
    return [
      ...tickedGroups.map((g) => ({
        profile: g.profile,
        label: g.name,
        ...pick(
          digestFragments(
            g.sites.map((s) => s.cut),
            doc.length,
            doc.topology,
          ),
          `${g.name} alone: `,
        ),
      })),
      combined,
    ];
  }, [tickedGroups, ticked, fragments, doc.length, doc.topology]);

  const needle = filter.trim().toLowerCase();
  const matching = groups.filter(
    (g) =>
      matchesCutCount(enzymeCutFilter, g.sites.length) &&
      (supplier === '' || g.enzyme.suppliers?.includes(supplier) === true) &&
      (needle === '' ||
        g.enzyme.name.toLowerCase().includes(needle) ||
        g.enzyme.site.toLowerCase().includes(needle)),
  );
  // `activeEnzymes()` is already in name order, so only the other sort has
  // any work to do. Ties keep that order, which is why it is a stable sort.
  const rows =
    enzymeSort === 'bands'
      ? [...matching].sort((a, b) =>
          a.profile === null || b.profile === null
            ? Number(a.profile === null) - Number(b.profile === null)
            : compareDiagnostic(a.profile, b.profile),
        )
      : matching;
  const nonCutters = groups.filter((g) => g.sites.length === 0).length;
  const cutters = groups.length - nonCutters;
  /**
   * What the "nothing is ticked" note offers, whatever the name and supplier
   * boxes say: the enzymes the cut-count filter asks for, or the single
   * cutters when it is not narrowing anything. Single cutters are what a
   * document ticks by itself when there are few enough of them
   * (`MAX_DEFAULT_ENZYMES`); with a REBASE table there are too many, and this
   * note is how you ask for them anyway.
   */
  const offerFilter = enzymeCutFilter === 'any' ? 'once' : enzymeCutFilter;
  const offered = groups
    .filter((g) => matchesCutCount(offerFilter, g.sites.length))
    .map((g) => g.enzyme.name);

  // Only the rows on screen are rendered: an imported table lists thousands.
  const { first, end, padTop, padBottom, attachScroller, attachRow, scrollToTop } = useRowWindow(
    useMemo(() => rows.map((g) => g.enzyme.name), [rows]),
    ROW_ESTIMATE,
  );
  // A new filter is a new list, and the old scroll position means nothing in it.
  useEffect(() => {
    scrollToTop();
  }, [needle, supplier, enzymeCutFilter, enzymeSort, scrollToTop]);

  const selectSite = (site: CutSite): void => {
    const enzyme = getEnzyme(site.enzyme);
    const len = enzyme?.site.length ?? 1;
    editorStore.setSelection({ start: site.siteStart, end: site.siteStart + len });
    editorStore.revealPosition(site.siteStart);
  };

  return (
    <div className="panel">
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
              title="List only the enzymes that cut this many times — two for a diagnostic digest, one for a cloning site"
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
          <label>
            <span>Order</span>
            <select
              className="panel__select"
              value={enzymeSort}
              title="Alphabetically, or the enzymes whose fragments are furthest apart on a gel first"
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
        </div>
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={rows.length > MAX_SHOW_LISTED}
            title={
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
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : (
        <>
          <div className="enzyme-list__scroll" ref={attachScroller}>
            <ul className="enzyme-list" style={{ paddingTop: padTop, paddingBottom: padBottom }}>
              {rows.slice(first, end).map(({ enzyme, sites, profile }) => (
                <li key={enzyme.name} className="enzyme-row" ref={attachRow(enzyme.name)}>
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
                  {profile !== null && <BandLine profile={profile} />}
                </li>
              ))}
            </ul>
          </div>
          <p className="panel__note">
            {rows.length.toLocaleString()} of {enzymeSetInfo.count.toLocaleString()} enzymes{' '}
            {cutCountPhrase(enzymeCutFilter)}
            {supplier === '' ? '' : ' and are sold by that supplier'}. {nonCutters.toLocaleString()}{' '}
            do not cut.
          </p>
          {enzymeSort === 'bands' && (
            <DoubleDigests listed={rows} doc={doc} shownEnzymes={shownEnzymes} />
          )}
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
              {/* The lane before the numbers: the question a diagnostic digest
                  is chosen to answer is "will I see two bands", and that is a
                  question for the eye. Clicking one selects the piece it is. */}
              <Gel lanes={lanes} />
              <p className="panel__mono">
                {fragments.map((f) => f.length.toLocaleString()).join(', ')} bp
              </p>
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
                  ? `On a gel: ${describeBands(ticked, 6)} — ${bandProblems(ticked).join('; ')}.`
                  : `On a gel: ${ticked.bands.length === 1 ? '1 band' : `${ticked.bands.length} bands`}, ${describeBands(ticked, 6)}.`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
