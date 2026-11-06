import { useMemo, useState } from 'react';

import {
  type Enzyme,
  type EnzymeSites,
  type SeqDocument,
  bestPairs,
  bestPartners,
  digestFragments,
  gelProfile,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { useGelOptions } from '../state/useGel';
import { BandLine } from './BandLine';
import { MAX_PAIR_CUTS, type PairRow, pickPiece } from './enzymeList';
import { Gel, type GelLane } from './Gel';
import { useRowCursor } from './useRowCursor';

/**
 * How many of them are paired, fewest cuts first. Every pair is a digest,
 * so this is quadratic: 120 is 7,140 pairs and about 13 ms, and a REBASE
 * table can list several hundred (docs/perf-notes.md).
 */
const MAX_PAIR_CANDIDATES = 120;
/** Pairs listed, best first: the page has room for a table of them. */
const PAIRS_SHOWN = 20;

/** The gel under the table is drawn this much larger than the panel's. */
const GEL_SCALE = 1.5;

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
 * The Double page (item 133, E5): the best double digests, the same question
 * the Enzymes page asks of single enzymes, for when none gives a lane worth
 * running. By default among the enzymes listed; with **Pair** set to one
 * enzyme, its best partners among every enzyme that cuts few enough times,
 * which is the question as it is usually asked — "what do I cut with EcoRI"
 * (item 42). A table of the pairs, each with the bands it gives; a click on
 * one draws its three lanes under the table, the digest beside each enzyme
 * alone, without touching the ticks. **Tick both** ticks the pair alone, so
 * the map and the Digest page follow.
 */
export function DoubleDigests({ listed, pairable, cuts, doc, shownEnzymes }: DoubleDigestsProps) {
  const gel = useGelOptions();
  const { documentId } = useEditorState();
  // Remembered: the Enzymes page's **Find a partner ›** sets it before the page is shown.
  const [anchorName, setAnchorName] = useRemembered('enzymes.anchor', documentId, '');
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
  const found = anchor === undefined ? listedPairs : partnerPairs;
  // A pair reads the same whichever way the list happened to be sorted; a
  // partner comes after the enzyme it was found for.
  const pairs = useMemo(
    () =>
      found.map((pair) => {
        const [first, second] =
          anchor !== undefined || pair.first.localeCompare(pair.second) <= 0
            ? [pair.first, pair.second]
            : [pair.second, pair.first];
        return { first, second, profile: pair.profile, id: `${first}+${second}` };
      }),
    [found, anchor],
  );

  // The row clicked draws its lanes; before one is, the best pair's.
  const [pickedId, setPicked] = useState<string | null>(null);
  const picked = pairs.find((p) => p.id === pickedId) ?? pairs[0];
  const { body, cursor, setCursor, onKeyDown } = useRowCursor(pairs.length);
  const lanes = useMemo((): GelLane[] => {
    if (picked === undefined) return [];
    const open = (name: string): number[] => [
      ...(pairable.find((r) => r.members.includes(name))?.cuts ?? []),
    ];
    const [a, b] = [open(picked.first), open(picked.second)];
    const alone = (name: string, at: number[]): GelLane => {
      const pieces = digestFragments(at, doc.length, doc.topology);
      return {
        profile: gelProfile(
          pieces.map((f) => f.length),
          gel,
        ),
        label: name,
        ...pickPiece(pieces, `${name} alone: `),
      };
    };
    return [
      alone(picked.first, a),
      alone(picked.second, b),
      {
        profile: picked.profile,
        label: 'Both',
        ...pickPiece(digestFragments([...a, ...b], doc.length, doc.topology), 'Both: '),
      },
    ];
  }, [picked, pairable, doc.length, doc.topology, gel]);

  if (pairable.length < 2) {
    return (
      <p className="panel__note" data-testid="double-digests">
        Fewer than two enzymes cut {doc.name} {MAX_PAIR_CUTS} times or fewer, so there is nothing to
        pair. Methylation can leave fewer: see Grown in above.
      </p>
    );
  }
  // One enzyme ticked is the usual start of "and what do I cut it with".
  const [onlyTicked] = shownEnzymes.size === 1 ? [...shownEnzymes] : [];
  const offer =
    anchor === undefined && onlyTicked !== undefined
      ? pairable.find((r) => r.members.includes(onlyTicked))
      : undefined;

  return (
    <div className="pairs-ws" data-testid="double-digests">
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
        <>
          <div className="tablewrap pairs-ws__scroll">
            <table className="wst dt" role="grid" aria-label="Double digests">
              <thead>
                <tr>
                  <th className="wst__th">Enzyme 1</th>
                  <th className="wst__th">Enzyme 2</th>
                  <th
                    className="wst__th"
                    data-tip="The bands the digest with both would give, best separated first; a ⚠ is a lane that hides something"
                  >
                    Bands
                  </th>
                  <th className="wst__th" aria-label="Tick" />
                </tr>
              </thead>
              <tbody ref={body} onKeyDown={onKeyDown}>
                {pairs.map((pair, i) => {
                  const { first, second, id } = pair;
                  const on = pair === picked;
                  const both =
                    shownEnzymes.size === 2 && shownEnzymes.has(first) && shownEnzymes.has(second);
                  return (
                    <tr
                      key={id}
                      className={`cand${on ? ' is-selected' : ''}`}
                      data-row={i}
                      tabIndex={i === cursor ? 0 : -1}
                      aria-selected={on}
                      onFocus={() => {
                        setCursor(i);
                      }}
                      onClick={(e) => {
                        if (e.target instanceof Element && e.target.closest('button') !== null) {
                          return;
                        }
                        setPicked(id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) {
                          e.preventDefault();
                          setPicked(id);
                        }
                      }}
                    >
                      <td className="enzyme-row__pair">{first}</td>
                      <td className="enzyme-row__pair">{second}</td>
                      <td>
                        <BandLine profile={pair.profile} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          disabled={both}
                          data-tip={
                            both
                              ? 'These two are what is ticked; the Digest page is their digest'
                              : `Tick ${first} and ${second} alone, to see their digest on the Digest page`
                          }
                          onClick={() => {
                            editorStore.setShownEnzymes([first, second]);
                          }}
                        >
                          {both ? 'Ticked' : 'Tick both'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {picked !== undefined && (
            <div className="pairs-ws__gel">
              <Gel lanes={lanes} scale={GEL_SCALE} />
              <p className="panel__note panel__note--quiet">
                {picked.first} + {picked.second}, beside each enzyme alone. Select another pair to
                draw its lanes; the ticks are not changed.
              </p>
            </div>
          )}
        </>
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
