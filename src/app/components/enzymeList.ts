import { useMemo } from 'react';

import {
  type CutSite,
  type DigestProfile,
  type Enzyme,
  type EnzymeSites,
  type Fragment,
  type GelBand,
  type GelOptions,
  type SeqDocument,
  activeEnzymes,
  bandProblems,
  compareDiagnostic,
  describeBands,
  digestFragments,
  enzymeDigest,
  gelProfile,
  hostStateBits,
  isoschizomerGroups,
  sitesByEnzyme,
} from '@/core';

import { matchesCutCount } from '../state/cutFilter';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { type GelLane } from './Gel';

const NO_SITES: readonly CutSite[] = [];
const NO_MARKS = new Uint8Array(0);
/** The sites of an enzyme that does not cut. */
const NOT_CUT: EnzymeSites = {
  count: 0,
  cuts: NO_MARKS,
  host: NO_MARKS,
  site: () => undefined,
  sites: () => NO_SITES,
};

/** One enzyme of the list, with its sites, their marks, and its lane. */
export interface EnzymeEntry extends EnzymeSites {
  readonly enzyme: Enzyme;
  /** Whether it cuts this sequence at all, so has a lane. */
  readonly cutting: boolean;
  /** Its lane on a gel, null when it does not cut; worked out on the first call. */
  readonly profile: () => DigestProfile | null;
}

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
export const MAX_PAIR_CUTS = 3;

/** "2,181 and 2,180", the pieces hidden under one band. */
function describeBandFragments(band: GelBand): string {
  const shown = band.fragments.slice(0, 3).map((n) => n.toLocaleString());
  const rest = band.fragments.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(' and ');
}

/**
 * What clicking a band of a lane does: selects the piece it is in the views.
 * `pieces` are the fragments the lane was drawn from; `who` prefixes the
 * tooltip, for a lane that is one of several.
 */
export function pickPiece(pieces: readonly Fragment[], who: string) {
  return {
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
  };
}

/** How everything ticked together would read on a gel, in a sentence. */
export function gelSentence(ticked: DigestProfile, gel: GelOptions): string {
  return ticked.misleading
    ? `On a gel: ${describeBands(ticked, 6)} — ${bandProblems(ticked, gel).join('; ')}.`
    : `On a gel: ${ticked.bands.length === 1 ? '1 band' : `${ticked.bands.length} bands`}, ${describeBands(ticked, 6)}.`;
}

/** An enzyme that may go into a double digest: a row of the list, filters aside. */
export interface PairRow {
  /** The name it is offered under, as on its row. */
  readonly name: string;
  /** Every enzyme the row stands for, so a partner chosen by any name is found. */
  readonly members: readonly string[];
  readonly cuts: readonly number[];
}

/**
 * The Enzymes tab's list and what is worked out from it: the sites and
 * their digest, one entry per enzyme, the ticked enzymes' fragments and
 * lanes, the rows the filters leave, the enzymes a double digest may pair.
 * Over the store (the ticks, the cut-count, supplier and order choices) and
 * the search box's text, which is kept by document under `enzymes.filter`
 * (item 133): the panel's list and the Enzyme workspace's table are one
 * list, so they must agree on it, and it survives a switch of tab.
 */
export function useEnzymeList(doc: SeqDocument) {
  const {
    analysis,
    documentId,
    shownEnzymes,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSupplier,
    enzymeSort,
    enzymeGroupIsoschizomers: grouped,
    enzymeSortReversed: reversed,
  } = useEditorState();
  const gel = useGelOptions();
  const [filter, setFilter] = useRemembered('enzymes.filter', documentId, '');
  // The sites, once the restriction scan has answered for this document;
  // the ORFs may still be on their way (#274) and are not waited for.
  // Both are kept as they are when the ORFs land, so the memos below do not
  // run again for them.
  const current = analysis?.doc === doc ? analysis : null;
  const sites = current?.cutSites ?? null;
  const workerDigest = current?.digest ?? null;
  const ready = sites !== null;
  // A supplier is a code out of the table in use. A code stored from another
  // import — or from before "Go back to the bundled table" — names nobody
  // here, and filtering on it would empty the list with no way to see why.
  const supplier = enzymeSetInfo.suppliers.some((s) => s.code === enzymeSupplier)
    ? enzymeSupplier
    : '';

  /**
   * The host methylation inside each site and the fragments each enzyme
   * alone would give: the worker's, taken with the scan (item 98), or taken
   * here for a result carried through an edit, whose sites have moved. At
   * 1 Mb the two were 120 ms of main thread per scan (docs/perf-notes.md).
   */
  const digest = useMemo(
    () =>
      sites === null
        ? null
        : (workerDigest ?? enzymeDigest(sites.all(), doc.sequence.toString(), doc.topology)),
    [sites, workerDigest, doc],
  );

  const groups = useMemo((): EnzymeEntry[] => {
    // Read off the worker's packed answer (#281), or grouped here.
    const byName =
      digest === null || sites === null
        ? null
        : (digest.byEnzyme ?? sitesByEnzyme(sites.all(), digest.host));
    return activeEnzymes().map((enzyme) => {
      const own = byName?.get(enzyme.name);
      const lengths = digest?.lengths.get(enzyme.name);
      // The bands each enzyme alone would give, taken when first asked for
      // (#278): by a row on screen, by a tick, or for every enzyme when the
      // list is ordered by them. Taken for every enzyme up front they were
      // 30-40 ms of the open of a 4.64 Mb sequence, and a copy of each
      // enzyme's lengths kept as long as the tab was.
      let profile: DigestProfile | null | undefined;
      const { count, cuts, host, site, sites: all } = own ?? NOT_CUT;
      return {
        enzyme,
        count,
        cuts,
        host,
        site,
        sites: all,
        cutting: lengths !== undefined,
        profile: () => (profile ??= lengths === undefined ? null : gelProfile(lengths, gel)),
      };
    });
    // The enzymes come from module state, so the memo has to be told to
    // re-run when the set changes; `enzymeSetInfo` is the store's record of
    // which set that is, and the linter cannot see the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, digest, enzymeSetInfo, gel]);

  /**
   * The cuts this DNA's own methylation would block (#45) are left out of a
   * digest. The list still shows them, marked: "blocked in a dam+ strain" is
   * worth knowing whatever this DNA is. Read off each site's marks rather
   * than kept as a set of the blocked sites, which at 4.64 Mb was 42,000
   * entries built on every open (#278).
   */
  const mask = hostStateBits(doc.methylation);
  const cuts = useMemo(
    () =>
      ({ count, cuts: at, host }: EnzymeSites): number[] => {
        const out: number[] = [];
        for (let i = 0; i < count; i++) {
          if (((host[i] ?? 0) & mask) === 0) out.push(at[i] ?? 0);
        }
        return out;
      },
    [mask],
  );

  const shownCuts = useMemo(() => {
    const out: number[] = [];
    for (const g of groups) {
      if (!shownEnzymes.has(g.enzyme.name)) continue;
      // A loop, not a spread: a ticked enzyme can cut a genome 100,000 times.
      for (const c of cuts(g)) out.push(c);
    }
    return out;
  }, [groups, shownEnzymes, cuts]);
  const fragments = useMemo(
    () =>
      shownCuts.length === 0
        ? []
        : digestFragments(shownCuts, doc.length, doc.topology).sort((a, b) => b.length - a.length),
    [shownCuts, doc.length, doc.topology],
  );
  /** How everything ticked together would read on a gel. */
  const ticked = useMemo(
    () =>
      gelProfile(
        fragments.map((f) => f.length),
        gel,
      ),
    [fragments, gel],
  );
  /** The ticked enzymes that cut, each with its own profile. */
  const tickedGroups = useMemo(
    () =>
      groups.flatMap((g) => {
        const profile = shownEnzymes.has(g.enzyme.name) ? g.profile() : null;
        return profile === null ? [] : [{ ...g, name: g.enzyme.name, profile }];
      }),
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
      ...pickPiece(fragments, alone ? `${n === 2 ? 'Both' : `All ${n}`}: ` : ''),
    };
    if (!alone) return [combined];
    return [
      ...tickedGroups.map((g) => ({
        profile: g.profile,
        label: g.name,
        ...pickPiece(digestFragments(cuts(g), doc.length, doc.topology), `${g.name} alone: `),
      })),
      combined,
    ];
  }, [tickedGroups, ticked, fragments, cuts, doc.length, doc.topology]);

  /**
   * What one row of the list stands for: an enzyme, or with isoschizomers
   * grouped, every enzyme that cuts the same site in the same place, best
   * known first. They cut identically, so any member's sites are the row's.
   */
  const units = useMemo(
    () =>
      grouped
        ? isoschizomerGroups(activeEnzymes()).map((g) => g.members)
        : activeEnzymes().map((e) => [e]),
    // Module state again; see `groups`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped, enzymeSetInfo],
  );
  const entryByName = useMemo(() => new Map(groups.map((g) => [g.enzyme.name, g])), [groups]);
  const pairable = useMemo(
    () =>
      units
        .flatMap((all): PairRow[] => {
          const members =
            supplier === '' ? all : all.filter((e) => e.suppliers?.includes(supplier) === true);
          const entry = members[0] === undefined ? undefined : entryByName.get(members[0].name);
          if (entry === undefined) return [];
          // A site this DNA's methylation blocks is not a cut, so an enzyme
          // it silences is no partner for a digest (#45). An enzyme that
          // cuts a 1 Mb sequence thousands of times is out at its fourth
          // open cut, not after a walk down all of them.
          const open: number[] = [];
          for (let i = 0; i < entry.count; i++) {
            if (((entry.host[i] ?? 0) & mask) !== 0) continue;
            open.push(entry.cuts[i] ?? 0);
            if (open.length > MAX_PAIR_CUTS) return [];
          }
          if (open.length === 0) return [];
          const name = (members.find((e) => shownEnzymes.has(e.name)) ?? entry.enzyme).name;
          return [{ name, members: members.map((e) => e.name), cuts: open }];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [units, supplier, entryByName, shownEnzymes, mask],
  );

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    const matching = units.flatMap((all) => {
      // Only what the supplier sells can stand for the row, or the name on it
      // would be one you cannot buy there.
      const members =
        supplier === '' ? all : all.filter((e) => e.suppliers?.includes(supplier) === true);
      const entry = members[0] === undefined ? undefined : entryByName.get(members[0].name);
      if (entry === undefined || !matchesCutCount(enzymeCutFilter, entry.count)) return [];
      const named =
        needle === '' ? [] : members.filter((e) => e.name.toLowerCase().includes(needle));
      if (
        needle !== '' &&
        named.length === 0 &&
        !entry.enzyme.site.toLowerCase().includes(needle)
      ) {
        return [];
      }
      // The name on the row is the one ticked, or the one searched for, so
      // neither disappears behind a better-known isoschizomer.
      const enzyme = members.find((e) => shownEnzymes.has(e.name)) ?? named[0] ?? entry.enzyme;
      return [
        {
          enzyme,
          members,
          count: entry.count,
          cuts: entry.cuts,
          host: entry.host,
          site: entry.site,
          sites: entry.sites,
          cutting: entry.cutting,
          profile: entry.profile,
        },
      ];
    });
    // Ungrouped, `activeEnzymes()` is already in name order; grouped, the name
    // on a row can be any member's. Ties in the other sort keep that order,
    // which is why it is a stable sort.
    const byName = grouped
      ? [...matching].sort((a, b) => a.enzyme.name.localeCompare(b.enzyme.name))
      : matching;
    const ordered =
      enzymeSort === 'bands'
        ? [...byName].sort((a, b) => {
            const pa = a.profile();
            const pb = b.profile();
            return pa === null || pb === null
              ? Number(pa === null) - Number(pb === null)
              : compareDiagnostic(pa, pb, gel);
          })
        : byName;
    if (!reversed) return ordered;
    // Backwards is Z–A, or the lanes that would mislead first — a search
    // for the enzyme whose pieces run together. Enzymes that do not cut have
    // no lane to judge, so they stay at the foot either way.
    if (enzymeSort === 'name') return [...ordered].reverse();
    const cutting = ordered.filter((r) => r.cutting).reverse();
    return [...cutting, ...ordered.filter((r) => !r.cutting)];
  }, [
    units,
    supplier,
    entryByName,
    enzymeCutFilter,
    needle,
    shownEnzymes,
    grouped,
    enzymeSort,
    reversed,
    gel,
  ]);
  const listedEnzymes = rows.reduce((n, r) => n + r.members.length, 0);
  const nonCutters = groups.filter((g) => g.count === 0).length;
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
  const offered = units.flatMap((members) => {
    const first = members[0];
    const count = first === undefined ? undefined : entryByName.get(first.name)?.count;
    return first !== undefined && count !== undefined && matchesCutCount(offerFilter, count)
      ? [first.name]
      : [];
  });

  return {
    filter,
    setFilter,
    needle,
    supplier,
    ready,
    groups,
    cuts,
    fragments,
    ticked,
    tickedGroups,
    lanes,
    pairable,
    rows,
    listedEnzymes,
    cutters,
    nonCutters,
    offerFilter,
    offered,
  };
}

/** What `useEnzymeList` answers with, for the pieces that take it as a prop. */
export type EnzymeList = ReturnType<typeof useEnzymeList>;
