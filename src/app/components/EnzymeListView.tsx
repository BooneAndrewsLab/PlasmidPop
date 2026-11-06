import { useState } from 'react';

import {
  type SeqDocument,
  describeBands,
  type HostMethylationState,
  describeHost,
  hostMarksFromBits,
  isHostMethylationSensitive,
} from '@/core';

import { cutCountPhrase } from '../state/cutFilter';
import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { BandLine } from './BandLine';
import { CustomEnzymeForm } from './CustomEnzymeForm';
import { type EnzymeList, gelSentence } from './enzymeList';
import {
  MAX_SHOW_LISTED,
  MAX_SITES_SHOWN,
  countMarked,
  describeEnzyme,
  describeOthers,
  describeSite,
  firstSites,
  selectCutSite,
  tickRow,
} from './enzymeRows';
import { EnzymeImport } from './EnzymeImport';
import { Gel } from './Gel';

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
 * The two notes a hidden or empty tick state needs: cut sites are hidden in
 * the views, and nothing is ticked, with the way to tick what a digest
 * wants. The slim panel shows them too, over its few rows.
 */
export function EnzymeNotes({ list }: { readonly list: EnzymeList }) {
  const { showCutSites, shownEnzymes } = useEditorState();
  const { ready, cutters, offerFilter, offered } = list;
  return (
    <>
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

/** One enzyme's row: ticked or not, its site, where it cuts, and the bands it would give. */
export function EnzymeRow({
  row: { enzyme, members, count, site, host: marks, profile },
  doc,
  shownEnzymes,
  liRef,
}: {
  readonly row: EnzymeList['rows'][number];
  readonly doc: SeqDocument;
  readonly shownEnzymes: ReadonlySet<string>;
  readonly liRef?: (el: HTMLElement | null) => void;
}) {
  return (
    <li className="enzyme-row" ref={liRef}>
      <label
        className="enzyme-row__toggle"
        data-tip="Tick to draw this enzyme's cut sites and to digest with it"
      >
        <input
          type="checkbox"
          checked={members.some((e) => shownEnzymes.has(e.name))}
          onChange={(e) => {
            tickRow(enzyme, members, shownEnzymes, e.target.checked);
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
                selectCutSite(s);
              }}
            >
              {describeSite(s, doc)}
              {host.length > 0 && <sup>m</sup>}
            </button>
          );
        })}
        {count > MAX_SITES_SHOWN && (
          <span className="enzyme-row__more" data-tip={`${enzyme.name} cuts ${count} times in all`}>
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
        {gelSentence(ticked, gel)}
      </p>
    </div>
  );
}
