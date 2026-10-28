import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';

import {
  type EnzymePairReport,
  type PairIssue,
  type SeqDocument,
  describePairIssue,
  formatSpan,
  insertSequence,
} from '@/core';

import { openFetched } from '../openFromNcbi';
import { type WorkspaceLayout } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import {
  type CloningDesignState,
  type EnzymePick,
  cutAt,
  endText,
  fetchedInsertRef,
  insertChoiceValue,
  insertChoices,
  internalSites,
  pairLabel,
  vectorEnzymes,
} from './cloningDesign';
import { NcbiSearch } from './NcbiSearch';
import { PrimerSettings } from './PrimerSettings';
import { nextRowIndex } from './tableKeys';

/** Excluded pairs shown before the fold; the rest wait behind "N more". */
const SHOWN_EXCLUDED = 4;

function pickOf(p: EnzymePairReport): EnzymePick {
  return { forward: p.forward.enzyme, reverse: p.reverse.enzyme };
}

function samePair(p: EnzymePairReport, pick: EnzymePick | null): boolean {
  return pick !== null && p.forward.enzyme === pick.forward && p.reverse.enzyme === pick.reverse;
}

function issuesOf(p: EnzymePairReport, kinds: readonly PairIssue['kind'][]): PairIssue[] {
  return p.issues.filter((i) => kinds.includes(i.kind));
}

/** The Insert column: where the pair's enzymes cut the insert, or that they do not. */
function insertCell(p: EnzymePairReport): ReactNode {
  const cuts = issuesOf(p, ['cutsInsert']);
  if (cuts.length === 0) return 'no site';
  return (
    <span className="ez__bad">
      ✗{' '}
      {cuts
        .map((i) =>
          i.kind === 'cutsInsert'
            ? `${i.enzyme} ${i.positions.map((x) => x.toLocaleString()).join(', ')}`
            : '',
        )
        .join(' · ')}
    </span>
  );
}

function hostCell(p: EnzymePairReport): ReactNode {
  const blocked = issuesOf(p, ['methylation']);
  if (blocked.length === 0) return 'ok';
  return (
    <span className="ez__bad">
      ✗{' '}
      {blocked
        .map((i) => (i.kind === 'methylation' ? `${i.enzyme} ${i.marks.join('/')}` : ''))
        .join(' · ')}
    </span>
  );
}

function directionalCell(p: EnzymePairReport): ReactNode {
  const not = issuesOf(p, ['sameEnzyme', 'compatibleEnds', 'blunt']);
  if (not.length === 0) return '✓';
  const why = not.some((i) => i.kind === 'blunt')
    ? 'blunt'
    : not.some((i) => i.kind === 'sameEnzyme')
      ? 'same site twice'
      : 'ends ligate to each other';
  return <span className="ez__bad">✗ {why}</span>;
}

interface Props {
  readonly doc: SeqDocument;
  readonly cloning: CloningDesignState;
  readonly layout: WorkspaceLayout;
  /** The region chooser (Selection / Feature), the plain page's. */
  readonly chooser: ReactNode;
  readonly onDesigned: () => void;
  readonly onResults: () => void;
}

/**
 * The Design page in cloning mode (#303, item 108): four numbered steps —
 * where on the vector, what to insert, the enzyme pairs suggested for both,
 * and Design — above the shared settings. The region is the selection, live,
 * as in the plain mode; the insert a feature or selection of another tab,
 * or a gene fetched from NCBI into a tab of its own; the pairs a dense
 * table, usable ones first and the excluded ones greyed with their reason,
 * with "Any two enzymes…" to override. Design is off with its reason until
 * an insert and two enzymes are set.
 */
export function CloningDesign({ doc, cloning, layout, chooser, onDesigned, onResults }: Props) {
  const { documentId, documents, primerCriteria } = useEditorState();
  const {
    region,
    insertRef,
    insert,
    setInsert,
    flipped,
    setFlipped,
    scans,
    scanning,
    suggestions,
    picked,
    setPicked,
    settings,
    setSettings,
    blocked,
    record,
  } = cloning;
  const [ncbiOpen, setNcbiOpen] = useRemembered('primers.cloning.ncbiOpen', documentId, false);
  const [overrideOpen, setOverrideOpen] = useRemembered(
    'primers.cloning.override',
    documentId,
    false,
  );
  const [unfolded, setUnfolded] = useState(false);
  /** What the last fetch came to, said under the search. */
  const [fetchedNote, setFetchedNote] = useState<string | null>(null);
  const rowsEl = useRef<HTMLTableSectionElement>(null);

  const groups = useMemo(() => insertChoices(documents, documentId), [documents, documentId]);
  const insertValue = insertRef === null ? '' : insertChoiceValue(insertRef);
  const insertListed = groups.some((g) => g.choices.some((c) => c.value === insertValue));

  const candidates = useMemo(() => suggestions?.candidates ?? [], [suggestions]);
  const internal = useMemo(
    () => (scans === null ? [] : internalSites(scans, candidates)),
    [scans, candidates],
  );
  const enzymes = useMemo(() => (scans === null ? [] : vectorEnzymes(scans)), [scans]);

  const pairs = useMemo(() => suggestions?.pairs ?? [], [suggestions]);
  // Each candidate's one cut inside the region, as the pair reports hold it.
  const regionCuts = useMemo(() => {
    const cuts = new Map<string, number>();
    for (const p of pairs) {
      for (const end of [p.forward, p.reverse]) {
        const at = cutAt(end.site, doc);
        if (at !== null && !cuts.has(end.enzyme)) cuts.set(end.enzyme, at);
      }
    }
    return cuts;
  }, [pairs, doc]);
  const usable = pairs.filter((p) => p.usable);
  const excluded = pairs.filter((p) => !p.usable);
  const shownExcluded = unfolded ? excluded : excluded.slice(0, SHOWN_EXCLUDED);
  const rows = [...usable, ...shownExcluded];
  const folded = excluded.length - shownExcluded.length;
  // The pick, judged again on what the page holds now (decision 8): kept,
  // and said to be no longer usable with its reasons when it is not.
  const pickedReport = suggestions?.picked ?? null;
  const pickedListed = rows.some((p) => samePair(p, picked));

  const bases = insert === null ? '' : insertSequence(insert);
  const ends = (): string => {
    if (bases.length < 6) return bases;
    return `${bases.slice(0, 3).toUpperCase()}…${bases.slice(-3).toUpperCase()}`;
  };
  const lowerEnd = flipped ? 'reverse' : 'forward';
  const orientation = (): string => {
    const head = bases.slice(0, 3).toUpperCase();
    const tail = bases.slice(-3).toUpperCase();
    const at = (which: 'forward' | 'reverse'): string =>
      picked === null
        ? which === lowerEnd
          ? 'the lower cut'
          : 'the higher cut'
        : `the ${which === 'forward' ? picked.forward : picked.reverse} end`;
    return `${head} at ${at('forward')} → ${tail} at ${at('reverse')}`;
  };

  const stop = rows.findIndex((p) => samePair(p, picked));
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = nextRowIndex(e.key, stop < 0 ? null : stop, rows.length);
    if (to === null) return;
    e.preventDefault();
    const next = rows[to];
    if (next === undefined) return;
    setPicked(pickOf(next));
    rowsEl.current?.querySelector<HTMLElement>(`[data-row="${to.toString()}"]`)?.focus();
  };

  const overrideSelect = (slot: 'forward' | 'reverse', label: string) => (
    <select
      className="panel__select"
      aria-label={label}
      value={picked?.[slot] ?? ''}
      onChange={(e) => {
        const name = e.target.value;
        if (name === '') return;
        // One of two chosen: held as the same enzyme twice until the other
        // arrives, which the table says is not directional.
        const other = (slot === 'forward' ? picked?.reverse : picked?.forward) ?? name;
        setPicked(
          slot === 'forward'
            ? { forward: name, reverse: other }
            : { forward: other, reverse: name },
        );
      }}
    >
      <option value="">Choose…</option>
      {enzymes.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );

  const step = (n: number, title: string, note: ReactNode, body: ReactNode) => (
    <section className="step" aria-labelledby={`ws-step-${n.toString()}`}>
      <span className="step__n" aria-hidden="true">
        {n}
      </span>
      <div className="step__b">
        <div className="step__t">
          <h3 className="step__h" id={`ws-step-${n.toString()}`}>
            {title}
          </h3>
          {note !== null && <span className="dnote">{note}</span>}
        </div>
        {body}
      </div>
    </section>
  );

  return (
    <div className={`cloning cloning--${layout}`}>
      {step(
        1,
        'Where on the vector',
        region.source === 'given'
          ? 'the selection, live — click the map or pick a feature'
          : region.source === 'mcs'
            ? `the ${region.feature?.name ?? 'MCS'} feature — select a region to change it`
            : 'the whole plasmid — select a region to narrow',
        <>
          <p className="ws__target-value">
            {region.feature !== null && (
              <span className="ws__feature-name">{region.feature.name} </span>
            )}
            <span className="panel__mono">{formatSpan(region.range, doc.length)}</span> ·{' '}
            {(region.range.end - region.range.start).toLocaleString()} bp
            {region.source === 'whole' && (
              <span className="dnote"> · enzymes that cut the plasmid once, anywhere</span>
            )}
          </p>
          {chooser}
          {candidates.length > 0 && (
            <p className="dnote cloning__sites">
              Cuts in the region:{' '}
              {candidates.map((name, i) => {
                const cut = regionCuts.get(name) ?? null;
                const on = picked !== null && (picked.forward === name || picked.reverse === name);
                return (
                  <span
                    key={name}
                    className={on ? 'cloning__site cloning__site--on' : 'cloning__site'}
                  >
                    {i > 0 && ' · '}
                    {name}
                    {cut !== null && ` ${cut.toLocaleString()}`}
                  </span>
                );
              })}
            </p>
          )}
        </>,
      )}
      {step(
        2,
        'What to insert',
        null,
        <>
          <div className="cloning__insert-row">
            <select
              className="panel__select ws__feature"
              aria-label="Insert: a feature or selection of another tab"
              value={insertListed ? insertValue : ''}
              onChange={(e) => {
                const value = e.target.value;
                const found = groups.flatMap((g) => g.choices).find((c) => c.value === value);
                setInsert(found === undefined ? null : found.ref);
              }}
            >
              <option value="">
                {groups.length === 0 ? 'No other DNA tab is open' : 'Feature in another tab…'}
              </option>
              {groups.map((g) => (
                <optgroup key={g.documentId} label={g.tab}>
                  {g.choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className={`button button--small${ncbiOpen ? ' button--toggle-on' : ''}`}
              aria-expanded={ncbiOpen}
              aria-controls="ws-cloning-ncbi"
              data-tip="Fetch a gene from NCBI into a tab of its own and use its CDS as the insert"
              onClick={() => {
                setNcbiOpen(!ncbiOpen);
              }}
            >
              Gene from NCBI…
            </button>
          </div>
          {ncbiOpen && (
            <div
              className="cloning__ncbi"
              id="ws-cloning-ncbi"
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                // Escape here folds the search; the workspace must not shut on it too.
                if (e.key === 'Escape') e.preventDefault();
              }}
            >
              <NcbiSearch
                initialMode="gene"
                onFetched={(fetched) => {
                  const vectorId = documentId;
                  const ids = openFetched(fetched);
                  const first = fetched.documents[0];
                  const id = ids[0];
                  // The record is a tab of its own (it is the PCR template),
                  // but the workspace stays on the vector: come back to it.
                  if (vectorId !== null) editorStore.activateDocument(vectorId);
                  if (first === undefined || id === undefined) return;
                  const ref = fetchedInsertRef(first, id);
                  setInsert(ref);
                  setFetchedNote(
                    `Fetched ${first.name} and opened it as a tab; ${ref.featureId === null ? 'the whole record' : `its ${ref.name} feature`} is the insert.`,
                  );
                }}
                onOpened={() => {
                  setNcbiOpen(false);
                }}
                onCancel={() => {
                  setNcbiOpen(false);
                }}
              />
            </div>
          )}
          {fetchedNote !== null && (
            <p className="panel__note panel__note--quiet" role="status">
              {fetchedNote}
            </p>
          )}
          {insert === null ? (
            <p className="ws__target-value ws__target-value--none">
              {insertRef !== null
                ? "The insert's tab was closed. Pick a feature of another open tab, or a gene from NCBI."
                : 'No insert yet — pick a feature of another open tab, or a gene from NCBI.'}
            </p>
          ) : (
            <>
              <p className="ws__target-value">
                <span className="ws__feature-name">{insert.name}</span> in {insert.document.name} ·{' '}
                <span className="panel__mono">
                  {formatSpan(insert.range, insert.document.length)}
                </span>{' '}
                · {bases.length.toLocaleString()} bp
                {insert.strand === 'reverse' ? ' · reverse strand' : ''} ·{' '}
                <span className="panel__mono">{ends()}</span>
              </p>
              <p className="dnote">
                {scanning || scans === null
                  ? 'Scanning for cut sites…'
                  : internal.length === 0
                    ? "Internal sites: none of the region's enzymes cut the insert"
                    : `Internal sites: ${internal
                        .map(
                          (s) =>
                            `${s.enzyme} ${s.positions.map((x) => x.toLocaleString()).join(', ')}`,
                        )
                        .join(' · ')} (greys those pairs below)`}
              </p>
              <p className="orient">
                <span className="dnote">Orientation</span>
                <span className="panel__mono">{orientation()}</span>
                <button
                  type="button"
                  className="button button--small"
                  aria-pressed={flipped}
                  data-tip="Swap the two sites between the primers, so the insert reads the other way on the vector"
                  onClick={() => {
                    setFlipped(!flipped);
                  }}
                >
                  Flip
                </button>
              </p>
            </>
          )}
        </>,
      )}
      {step(
        3,
        'Enzymes',
        'suggested: cut the vector once in the region, not the insert, past dam/dcm, directional',
        suggestions === null ? (
          <p className="ws__target-value ws__target-value--none">
            {insert === null
              ? 'Pairs are suggested once an insert is chosen: each must cut the vector once, inside the region, not inside the insert, past the host’s methylation, and give a directional insert.'
              : 'Scanning the vector and the insert for cut sites…'}
          </p>
        ) : (
          <>
            {pairs.length === 0 ? (
              <p className="ws__target-value ws__target-value--none">
                No enzyme cuts inside the region. Select a wider region, or choose any two enzymes
                below.
              </p>
            ) : (
              <div className="tablewrap">
                <table className="wst cands ez" role="grid" aria-label="Enzyme pairs">
                  <thead>
                    <tr>
                      <th className="wst__th">Enzymes</th>
                      <th
                        className="wst__th wst__n"
                        data-tip="Top-strand cut positions on the vector"
                      >
                        Cuts at
                      </th>
                      <th className="wst__th" data-tip="The overhang each enzyme leaves">
                        Ends
                      </th>
                      <th className="wst__th" data-tip="The insert can go in one way only">
                        Directional
                      </th>
                      <th className="wst__th" data-tip="Sites inside the insert">
                        Insert
                      </th>
                      <th className="wst__th" data-tip="Blocked by the vector's dam/dcm">
                        Host
                      </th>
                      <th className="wst__th">Why excluded</th>
                    </tr>
                  </thead>
                  <tbody ref={rowsEl} onKeyDown={onRowsKeyDown}>
                    {rows.map((p, i) => {
                      const on = samePair(p, picked);
                      return (
                        <tr
                          key={`${p.forward.enzyme}-${p.reverse.enzyme}`}
                          className={`cand${on ? ' is-selected' : ''}${p.usable ? '' : ' ez--off'}`}
                          data-row={i}
                          tabIndex={i === (stop < 0 ? 0 : stop) ? 0 : -1}
                          aria-selected={on}
                          onClick={() => {
                            setPicked(pickOf(p));
                          }}
                        >
                          <td>
                            <span className="ez__radio" aria-hidden="true">
                              {on ? '◉' : '○'}
                            </span>{' '}
                            {pairLabel(pickOf(p))}
                          </td>
                          <td className="wst__n">
                            {cutAt(p.forward.site, doc)?.toLocaleString() ?? '—'} ·{' '}
                            {cutAt(p.reverse.site, doc)?.toLocaleString() ?? '—'}
                          </td>
                          <td className="panel__mono">
                            {endText(p.forward.end)} · {endText(p.reverse.end)}
                          </td>
                          <td>{directionalCell(p)}</td>
                          <td>{insertCell(p)}</td>
                          <td>{hostCell(p)}</td>
                          <td className="ez__why">
                            {p.usable ? '—' : p.issues.map(describePairIssue).join(' ')}
                          </td>
                        </tr>
                      );
                    })}
                    {folded > 0 && (
                      <tr className="ez--more">
                        <td colSpan={7}>
                          <button
                            type="button"
                            className="link"
                            aria-expanded={false}
                            onClick={() => {
                              setUnfolded(true);
                            }}
                          >
                            {folded.toLocaleString()} more excluded{' '}
                            {folded === 1 ? 'pair' : 'pairs'} ›
                          </button>{' '}
                          <span className="dnote">
                            same site twice, cuts the insert, not directional
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {picked !== null && pickedReport !== null && !pickedListed && (
              <p className="dnote" role="status">
                Picked {pairLabel(picked)}
                {pickedReport.usable
                  ? ''
                  : `, no longer usable: ${pickedReport.issues.map(describePairIssue).join(' ')} Design will warn.`}
              </p>
            )}
            {picked !== null && pickedReport !== null && pickedListed && !pickedReport.usable && (
              <p className="dnote" role="status">
                Picked {pairLabel(picked)} is excluded:{' '}
                {pickedReport.issues.map(describePairIssue).join(' ')} Design will warn, and
                Simulate shows what the digest makes.
              </p>
            )}
            <div className="override">
              <button
                type="button"
                className="link"
                aria-expanded={overrideOpen}
                aria-controls="ws-cloning-override"
                onClick={() => {
                  setOverrideOpen(!overrideOpen);
                }}
              >
                Any two enzymes…
              </button>
              {overrideOpen && (
                <span className="override__body" id="ws-cloning-override">
                  {overrideSelect('forward', 'Enzyme at the insert’s 5′ end')}
                  <span className="dnote">5′ end ·</span>
                  {overrideSelect('reverse', 'Enzyme at the insert’s 3′ end')}
                  <span className="dnote">
                    3′ end, from every enzyme that cuts the vector, excluded pairs included — Design
                    then warns
                  </span>
                </span>
              )}
            </div>
          </>
        ),
      )}
      <PrimerSettings
        criteria={primerCriteria}
        cloning={{
          padding: settings.padding,
          avoidJunctionSites: settings.avoidJunctionSites,
          onChange: setSettings,
        }}
      />
      <div className="ws__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={blocked !== null}
          aria-describedby={blocked === null ? undefined : 'ws-design-why'}
          data-tip="Design both primers: padding, site and an annealing part on the insert's end"
          onClick={() => {
            if (cloning.design() !== null) onDesigned();
          }}
        >
          Design primers
          {blocked === null && insert !== null && picked !== null && (
            <span className="ws__button-for">
              {' '}
              for {insert.name} into {doc.name} at {pairLabel(picked)}
            </span>
          )}
        </button>
        {blocked !== null && (
          <span className="ws__actions-why" id="ws-design-why">
            {blocked}
          </span>
        )}
      </div>
      {record !== null && (
        <p className="ws__last">
          Last design · {record.designedFor} at {pairLabel(record.key.picked)}{' '}
          <button type="button" className="link" onClick={onResults}>
            Results ›
          </button>
        </p>
      )}
    </div>
  );
}
