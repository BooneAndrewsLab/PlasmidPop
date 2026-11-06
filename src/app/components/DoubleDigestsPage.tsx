import { useMemo, useState } from 'react';

import { type Enzyme, type EnzymeSites, type SeqDocument, bestPairs, bestPartners } from '@/core';

import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { BandLine } from './BandLine';
import { MAX_PAIR_CUTS, type PairRow } from './enzymeList';

/**
 * How many of them are paired, fewest cuts first. Every pair is a digest,
 * so this is quadratic: 120 is 7,140 pairs and about 13 ms, and a REBASE
 * table can list several hundred (docs/perf-notes.md).
 */
const MAX_PAIR_CANDIDATES = 120;
const PAIRS_SHOWN = 5;

interface DoubleDigestsProps {
  /** The rows the list is showing, in its order, so its filters narrow the pairs too. */
  readonly listed: readonly (EnzymeSites & { readonly enzyme: Enzyme })[];
  /**
   * Every row that cuts at most `MAX_PAIR_CUTS` times, whatever the name and
   * cut-count filters say (the supplier filter still holds): where a partner
   * for one chosen enzyme is looked for.
   */
  readonly pairable: readonly PairRow[];
  /** The cuts of a row's sites that this DNA's methylation leaves open (#45). */
  readonly cuts: (entry: EnzymeSites) => number[];
  readonly doc: SeqDocument;
  readonly shownEnzymes: ReadonlySet<string>;
}

/**
 * The best double digests, under a list ordered by band separation: the same
 * question asked of pairs, for when no enzyme on its own gives a lane worth
 * running. By default among the enzymes listed; with **Pair** set to one
 * enzyme, its best partners among every enzyme that cuts few enough times,
 * which is the question as it is usually asked — "what do I cut with EcoRI"
 * (item 42). "Tick both" ticks the pair alone, and the gel below then draws
 * their digest beside each single one.
 */
export function DoubleDigests({ listed, pairable, cuts, doc, shownEnzymes }: DoubleDigestsProps) {
  const gel = useGelOptions();
  const [anchorName, setAnchorName] = useState('');
  const anchor =
    anchorName === '' ? undefined : pairable.find((r) => r.members.includes(anchorName));
  // Keyed on the names rather than on `listed`, a new array every render.
  const key = listed
    .filter((g) => {
      const open = cuts(g).length;
      return open > 0 && open <= MAX_PAIR_CUTS;
    })
    .map((g) => g.enzyme.name)
    .join(' ');
  const poolSize = key === '' ? 0 : key.split(' ').length;
  const listedPairs = useMemo(() => {
    if (anchor !== undefined) return [];
    const names = new Set(key.split(' '));
    const pool = listed
      .filter((g) => names.has(g.enzyme.name))
      .sort((a, b) => a.count - b.count)
      .slice(0, MAX_PAIR_CANDIDATES);
    return bestPairs(
      pool.map((g) => ({ name: g.enzyme.name, cuts: cuts(g) })),
      doc.length,
      doc.topology,
      PAIRS_SHOWN,
      gel,
    );
    // `listed` is read only through the names in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, anchor, doc.length, doc.topology, gel]);
  const partnerPairs = useMemo(
    () =>
      anchor === undefined
        ? []
        : bestPartners(
            anchor,
            pairable.filter((r) => r !== anchor),
            doc.length,
            doc.topology,
            PAIRS_SHOWN,
            gel,
          ),
    [anchor, pairable, doc.length, doc.topology, gel],
  );
  const pairs = anchor === undefined ? listedPairs : partnerPairs;
  if (pairable.length < 2) return null;
  // One enzyme ticked is the usual start of "and what do I cut it with".
  const [onlyTicked] = shownEnzymes.size === 1 ? [...shownEnzymes] : [];
  const offer =
    anchor === undefined && onlyTicked !== undefined
      ? pairable.find((r) => r.members.includes(onlyTicked))
      : undefined;

  return (
    <div className="panel__section" data-testid="double-digests">
      <h3 className="panel__heading">Double digests</h3>
      <div className="panel__form">
        <label>
          <span>Pair</span>
          <select
            className="panel__select"
            value={anchor?.name ?? ''}
            data-tip="Pairs among the enzymes listed, or the best partners for one enzyme"
            onChange={(e) => {
              setAnchorName(e.target.value);
            }}
          >
            <option value="">any two listed enzymes</option>
            {pairable.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name} with a partner
              </option>
            ))}
          </select>
        </label>
      </div>
      {offer !== undefined && (
        <p className="panel__note">
          <button
            type="button"
            className="link"
            onClick={() => {
              setAnchorName(offer.name);
            }}
          >
            Find a partner for {offer.name}
          </button>
        </p>
      )}
      {anchor === undefined && poolSize < 2 ? (
        <p className="panel__note">
          Fewer than two of the enzymes listed cut {MAX_PAIR_CUTS} times or fewer.
        </p>
      ) : pairs.length === 0 ? (
        <p className="panel__note">
          {anchor === undefined
            ? 'No pair of the enzymes listed gives a lane that can be read at a glance.'
            : `No enzyme with ${anchor.name} gives a lane that can be read at a glance.`}
        </p>
      ) : (
        <ul className="enzyme-list">
          {pairs.map((pair) => {
            // A pair reads the same whichever way the list happened to be
            // sorted; a partner comes after the enzyme it was found for.
            const [first, second] =
              anchor !== undefined || pair.first.localeCompare(pair.second) <= 0
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
                  data-tip={
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
        {anchor === undefined ? (
          <>
            Pairs of the listed enzymes that cut {MAX_PAIR_CUTS} times or fewer, best separated
            first
            {poolSize > MAX_PAIR_CANDIDATES
              ? ` — the ${MAX_PAIR_CANDIDATES} that cut least of ${poolSize.toLocaleString()}; narrow the list to pair the others`
              : ''}
            .
          </>
        ) : (
          <>
            Partners for {anchor.name} among all {(pairable.length - 1).toLocaleString()} enzymes
            that cut {MAX_PAIR_CUTS} times or fewer, whatever the list shows, best separated first.
          </>
        )}
      </p>
    </div>
  );
}
