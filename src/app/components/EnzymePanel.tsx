import { useEffect, useId, useMemo, useState } from 'react';

import {
  type CutSite,
  type DigestProfile,
  type Enzyme,
  type EnzymeSites,
  type Fragment,
  type GelBand,
  type SeqDocument,
  activeEnzymes,
  bandProblems,
  bestPairs,
  bestPartners,
  cutLabel,
  compareDiagnostic,
  describeBands,
  digestFragments,
  enzymeDigest,
  formatInt,
  gelProfile,
  getEnzyme,
  type HostMethylationState,
  describeHost,
  hostMarksFromBits,
  hostStateBits,
  isHostMethylationSensitive,
  isDoubleCutter,
  isoschizomerGroups,
  overhangKind,
  sitesByEnzyme,
} from '@/core';

import {
  CUT_COUNT_OPTIONS,
  cutCountPhrase,
  isCutCountFilter,
  matchesCutCount,
} from '../state/cutFilter';
import { ENZYME_SORT_OPTIONS, isEnzymeSort } from '../state/enzymeSort';
import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { CustomEnzymeForm } from './CustomEnzymeForm';
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

const NO_SITES: readonly CutSite[] = [];

/** How many of a row's sites carry a Dam or Dcm mark. */
function countMarked(marks: Iterable<number>): number {
  let n = 0;
  for (const bits of marks) if (bits !== 0) n++;
  return n;
}
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
interface EnzymeEntry extends EnzymeSites {
  readonly enzyme: Enzyme;
  /** Whether it cuts this sequence at all, so has a lane. */
  readonly cutting: boolean;
  /** Its lane on a gel, null when it does not cut; worked out on the first call. */
  readonly profile: () => DigestProfile | null;
}

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

/**
 * The bands this enzyme alone would give, which is what a diagnostic digest
 * is actually chosen by: a cut count says nothing about whether the pieces
 * can be told apart. Bands that would run together, or off the end of the
 * gel, are said rather than left to be worked out from the numbers.
 */
function BandLine({ profile }: { readonly profile: DigestProfile | null }) {
  if (profile === null) return null;
  return <BandLineOf profile={profile} />;
}

function BandLineOf({ profile }: { readonly profile: DigestProfile }) {
  const problems = bandProblems(profile, useGelOptions());
  // A single cutter gives one band and no warning: it linearises the
  // plasmid, which is what it is for. The mark is for a lane that hides
  // something, not for one with nothing to say.
  const clear = !profile.misleading;
  return (
    <span
      className={`enzyme-row__bands${clear ? '' : ' enzyme-row__bands--muddy'}`}
      data-tip={
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

/** An enzyme that may go into a double digest: a row of the list, filters aside. */
interface PairRow {
  /** The name it is offered under, as on its row. */
  readonly name: string;
  /** Every enzyme the row stands for, so a partner chosen by any name is found. */
  readonly members: readonly string[];
  readonly cuts: readonly number[];
}

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
function DoubleDigests({ listed, pairable, cuts, doc, shownEnzymes }: DoubleDigestsProps) {
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

export function EnzymePanel({ doc }: Props) {
  const {
    analysis,
    shownEnzymes,
    showCutSites,
    enzymeSetInfo,
    enzymeCutFilter,
    enzymeSupplier,
    enzymeSort,
    enzymeGroupIsoschizomers: grouped,
    enzymeSortReversed: reversed,
  } = useEditorState();
  const gel = useGelOptions();
  const orderId = useId();
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
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
        ...pick(digestFragments(cuts(g), doc.length, doc.topology), `${g.name} alone: `),
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
          <label data-tip="Where the DNA was grown. An ordinary laboratory strain methylates GATC (Dam) and CCWGG (Dcm), which blocks some enzymes; DNA made by PCR carries neither">
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
      {!ready ? (
        <p className="panel__note">Scanning for restriction sites…</p>
      ) : (
        <>
          <div className="enzyme-list__scroll" ref={attachScroller}>
            <ul className="enzyme-list" style={{ paddingTop: padTop, paddingBottom: padBottom }}>
              {rows
                .slice(first, end)
                .map(({ enzyme, members, count, site, host: marks, profile }) => (
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
          {enzymeSort === 'bands' && (
            <DoubleDigests
              listed={rows}
              pairable={pairable}
              cuts={cuts}
              doc={doc}
              shownEnzymes={shownEnzymes}
            />
          )}
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
                  ? `On a gel: ${describeBands(ticked, 6)} — ${bandProblems(ticked, gel).join('; ')}.`
                  : `On a gel: ${ticked.bands.length === 1 ? '1 band' : `${ticked.bands.length} bands`}, ${describeBands(ticked, 6)}.`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
