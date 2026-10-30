import { type ReactNode, useState } from 'react';

import {
  type CheckPair,
  type PrimerReport,
  type Range,
  type SeqDocument,
  formatSpan,
  gelProfile,
} from '@/core';

import { copyText } from '../clipboard';
import { type WorkspaceLayout } from '../primerWorkspace';
import { openPcr, sendToPcr } from '../primerToPcr';
import { addFeaturesAsOneStep } from '../state/featureSteps';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { useGelOptions } from '../state/useGel';
import { type CloneCheckState, checkPairNames, junctionLabel } from './cloneCheck';
import { Gel, type GelLane } from './Gel';
import { pct, primerFeature, tm } from './primerDesign';
import { PrimerSettings } from './PrimerSettings';

/** "45–66", a site 1-based and inclusive, the end wrapped onto a circle. */
function span(r: Range, seqLength: number): string {
  return `${(r.start + 1).toLocaleString()}–${(((r.end - 1) % Math.max(1, seqLength)) + 1).toLocaleString()}`;
}

/** "612" or "—" for no band, "612 + 1,430" for two. */
function bandText(bands: readonly number[] | null): string {
  if (bands === null) return 'n/a';
  if (bands.length === 0) return '—';
  return bands.map((n) => n.toLocaleString()).join(' + ');
}

function OligoRow({
  strand,
  primer,
  site,
  seqLength,
  reused,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: PrimerReport;
  readonly site: Range;
  readonly seqLength: number;
  readonly reused: boolean;
}) {
  return (
    <tr>
      <th scope="row">{strand === 'forward' ? '→ Forward' : '← Reverse'}</th>
      <td className="panel__mono dt__seq">{primer.sequence}</td>
      <td className="wst__n">{primer.length} nt</td>
      <td className="wst__n" data-tip={reused ? 'Tm of the annealing part' : 'Melting temperature'}>
        Tm {primer.tm.toFixed(1)}
      </td>
      <td className="wst__n" data-tip="GC content">
        GC {pct(primer.gc)}
      </td>
      <td className="wst__n" data-tip="Where it anneals">
        {span(site, seqLength)}
      </td>
      <td className={reused ? 'dt__ok' : primer.gcClamp ? 'dt__ok' : 'dt__warn'}>
        {reused ? 'reused' : primer.gcClamp ? 'clamp' : 'no clamp'}
      </td>
    </tr>
  );
}

interface DetailProps {
  readonly doc: SeqDocument;
  readonly state: CloneCheckState;
  readonly pair: CheckPair;
  readonly rank: number;
  readonly onSaid: (note: string) => void;
}

/**
 * The selected pair in full: both primers, the three lanes a colony PCR
 * can give (the empty vector, the clone, the clone with its insert the
 * other way round), what the pair tells, and the actions.
 */
function PairDetail({ doc, state, pair, rank, onSaid }: DetailProps) {
  const { documentId } = useEditorState();
  const gel = useGelOptions();
  const record = state.record;
  const junctions = record?.junctions.length ?? 2;
  const names = checkPairNames(pair, rank);
  const lanes: GelLane[] = [];
  if (pair.bands.empty !== null) {
    lanes.push({ profile: gelProfile(pair.bands.empty, gel), label: 'Empty' });
  }
  lanes.push({ profile: gelProfile(pair.bands.clone, gel), label: 'Clone' });
  if (pair.bands.flipped !== null) {
    lanes.push({ profile: gelProfile(pair.bands.flipped, gel), label: 'Flipped' });
  }
  const tells =
    pair.kind === 'flank'
      ? 'Tells the insert’s presence and size: one band with it, another without, either way round.'
      : pair.bands.flipped === null
        ? 'Tells the insert’s presence: a band only when the insert is there.'
        : 'Tells the insert’s presence and orientation: a band only when the insert is there, this way round.';
  const addBoth = (): void => {
    addFeaturesAsOneStep(
      [
        primerFeature(names.forward, pair.forwardSite, 'forward', pair.forward.sequence),
        primerFeature(names.reverse, pair.reverseSite, 'reverse', pair.reverse.sequence),
      ],
      pair.reverseSite,
    );
  };
  const saveBoth = (): void => {
    const note = (p: PrimerReport, which: string): string =>
      `Colony PCR check of ${doc.name}, ${junctionLabel(pair, junctions).toLowerCase()}, ${which}; band ${pair.productLength.toLocaleString()} bp; Tm ${tm(p.tm)}, GC ${pct(p.gc)}`;
    void savePrimers(
      [
        {
          name: names.forward,
          sequence: pair.forward.sequence,
          notes: note(pair.forward, 'forward'),
        },
        {
          name: names.reverse,
          sequence: pair.reverse.sequence,
          notes: note(pair.reverse, 'reverse'),
        },
      ],
      'design',
    ).then((r) => {
      onSaid(
        r.added.length === 0
          ? 'Already in My primers.'
          : `Saved ${r.added.map((q) => q.name).join(' and ')} to My primers.`,
      );
    });
  };
  const toPcr = (): void => {
    sendToPcr(documentId, 'forward', { name: names.forward, sequence: pair.forward.sequence });
    sendToPcr(documentId, 'reverse', { name: names.reverse, sequence: pair.reverse.sequence });
    openPcr();
  };
  return (
    <aside className="detail detail--ccheck" aria-label={`Pair ${rank.toString()}`}>
      <div className="detail__main">
        <div className="detail__head">
          <strong>
            {junctionLabel(pair, junctions)} · pair {rank}
          </strong>
          <span className="dnote">
            band {pair.productLength.toLocaleString()} bp · ΔTm {pair.tmDifference.toFixed(1)} °C
          </span>
        </div>
        <table className="dt">
          <tbody>
            <OligoRow
              strand="forward"
              primer={pair.forward}
              site={pair.forwardSite}
              seqLength={doc.length}
              reused={pair.fixed === 'forward'}
            />
            <OligoRow
              strand="reverse"
              primer={pair.reverse}
              site={pair.reverseSite}
              seqLength={doc.length}
              reused={pair.fixed === 'reverse'}
            />
          </tbody>
        </table>
        <p className="ccheck__tells">{tells}</p>
        <dl className="ccheck__bands" aria-label="Expected bands">
          <dt>Clone</dt>
          <dd>{bandText(pair.bands.clone)} bp</dd>
          <dt>Empty vector</dt>
          <dd>
            {pair.bands.empty === null ? (
              <span className="panel__note--quiet">no empty vector</span>
            ) : (
              `${bandText(pair.bands.empty)}${pair.bands.empty.length === 0 ? '' : ' bp'}`
            )}
          </dd>
          <dt>Wrong orientation</dt>
          <dd>
            {pair.bands.flipped === null ? (
              <span className="panel__note--quiet">fixed by the method</span>
            ) : (
              `${bandText(pair.bands.flipped)}${pair.bands.flipped.length === 0 ? '' : ' bp'}`
            )}
          </dd>
        </dl>
        {pair.problems.length > 0 && (
          <ul className="warns" aria-label="Problems">
            {pair.problems.map((p) => (
              <li key={p} className="warns__warn">
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button
            type="button"
            className="button button--small"
            aria-label="Add both as features"
            data-tip="Annotate both sites as primer_bind features, one undo step"
            onClick={addBoth}
          >
            Add both
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip="Keep both primers in My primers, in this browser"
            onClick={saveBoth}
          >
            Save both
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip="Copy both oligos, 5′ to 3′, name and bases a line each"
            onClick={() => {
              copyText(
                `${names.forward}\t${pair.forward.sequence}\n${names.reverse}\t${pair.reverse.sequence}\n`,
              );
              onSaid('Copied both primers.');
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip="Put both primers in the PCR panel, on this product"
            onClick={toPcr}
          >
            Use in PCR
          </button>
        </div>
      </div>
      <div className="ccheck__gel">
        <Gel lanes={lanes} />
      </div>
    </aside>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly state: CloneCheckState;
  readonly layout: WorkspaceLayout;
}

/**
 * The workspace's clone-check page (item 120, #311): the product in front,
 * where its insert is and what the empty vector is (from the reaction that
 * made it, or the selection and a chosen tab), one primer to reuse or
 * none, the band's size window, the primer settings, then the pairs
 * designed, one set across each junction and one flanking the insert,
 * with the bands each gives on the clone, the empty vector and the clone
 * with its insert the other way round.
 */
export function CloneCheckPage({ doc, state, layout }: Props) {
  const { primerCriteria } = useEditorState();
  const [said, setSaid] = useState<string | null>(null);
  const {
    context,
    insert,
    geometry,
    empty,
    record,
    settings,
    setSettings,
    reusable,
    reuseKey,
    setReuseKey,
    designing,
    error,
    selected,
    select,
  } = state;
  const L = doc.length;
  const insertLength = insert === null ? 0 : insert.end - insert.start;
  const number = (
    key: keyof typeof settings,
    label: string,
    tip: string,
    min: number,
    max: number,
  ): ReactNode => (
    <label className="panel__field panel__field--row">
      <span>{label}</span>
      <input
        type="number"
        className="panel__number panel__number--short"
        min={min}
        max={max}
        step={10}
        value={settings[key]}
        data-tip={tip}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) setSettings({ [key]: n });
        }}
      />
    </label>
  );
  const groupLabel = { reaction: 'This design', record: 'From the record', mine: 'My primers' };
  const groups = (['reaction', 'record', 'mine'] as const).filter((g) =>
    reusable.some((r) => r.group === g),
  );
  const pairs = record?.design.pairs ?? [];
  const selectedPair = selected === null ? undefined : pairs[selected];
  const junctions = record?.junctions.length ?? geometry?.junctions.length ?? 2;

  return (
    <>
      <div className="ws__target">
        <span className="ws__target-label">Product</span>
        <p className="ws__target-value">
          {doc.name} · {L.toLocaleString()} bp · {doc.topology}
          {context !== null ? ` · from ${context.method}` : ''}
        </p>
        <span className="ws__target-label">Insert</span>
        <p className={`ws__target-value${insert === null ? ' ws__target-value--none' : ''}`}>
          {insert === null ? (
            'Select the insert on the map or in the sequence. A product opened by Simulate or Assemble knows where its insert is.'
          ) : (
            <>
              <span className="panel__mono">{formatSpan(insert, L)}</span> ·{' '}
              {insertLength.toLocaleString()} bp
              {context === null
                ? ' · the selection'
                : geometry !== null && geometry.junctions.length > 2
                  ? ` · ${(geometry.junctions.length - 2).toLocaleString()} ${geometry.junctions.length === 3 ? 'junction' : 'junctions'} inside it`
                  : ''}
            </>
          )}
        </p>
        {context === null && (
          <>
            <span className="ws__target-label">Context</span>
            <p className="ws__target-value ws__target-value--none">
              No cloning context is kept for this document, so the selection is the insert. A
              product made here keeps its insert and junctions while its bases stay as they were;
              one edited since, or made elsewhere, does not.
            </p>
          </>
        )}
        {context?.vector != null && (
          <>
            <span className="ws__target-label">Vector</span>
            <p className="ws__target-value">
              {context.vector.name} ·{' '}
              {context.vector.chosen
                ? 'chosen under Against on the Bench'
                : 'the longest part in the tube'}
            </p>
          </>
        )}
        <span className="ws__target-label">Empty vector</span>
        {context !== null ? (
          <p className={`ws__target-value${empty === null ? ' ws__target-value--none' : ''}`}>
            {empty === null
              ? (context.emptyNote ?? 'None.')
              : `${empty.name} · ${empty.length.toLocaleString()} bp`}
          </p>
        ) : (
          <select
            className="panel__select ws__feature"
            aria-label="Empty vector"
            value={state.emptyChoice}
            onChange={(e) => {
              state.setEmptyChoice(e.target.value);
            }}
          >
            <option value="">None: the pairs are checked on the product alone</option>
            {state.emptyChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.doc.name} · {c.doc.length.toLocaleString()} bp
              </option>
            ))}
          </select>
        )}
        <span className="ws__target-label">Orientation</span>
        <p className="ws__target-value panel__note--quiet">{state.orientationNote}</p>
      </div>
      <div className="panel__controls ccheck__form">
        <label className="panel__field panel__field--row">
          <span>Reuse</span>
          <select
            className="panel__select"
            aria-label="Primer to reuse"
            value={reuseKey}
            onChange={(e) => {
              setReuseKey(e.target.value);
            }}
          >
            <option value="">Design both primers</option>
            {groups.map((g) => (
              <optgroup key={g} label={groupLabel[g]}>
                {reusable
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.primer.name} · {r.primer.sequence.length} nt
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {number('minProduct', 'Band from', 'Shortest band to design for, bp', 50, 20_000)}
        {number('maxProduct', 'to', 'Longest band to design for, bp', 50, 20_000)}
        {number(
          'minDistance',
          'From the junction',
          'How far from the junction either primer must be, bp',
          0,
          5_000,
        )}
      </div>
      <PrimerSettings criteria={primerCriteria} />
      <div className="ws__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={geometry === null || designing}
          aria-describedby={geometry === null ? 'ws-check-why' : undefined}
          data-tip="Design a pair across each junction and one flanking the insert, and simulate each on the clone, the empty vector and the reversed clone"
          onClick={state.design}
        >
          {designing ? 'Designing…' : 'Design check primers'}
        </button>
        {geometry === null && (
          <span className="ws__actions-why" id="ws-check-why">
            Select the insert first
          </span>
        )}
        {designing && (
          <span className="ws__actions-why" role="status">
            Designing in the background…
          </span>
        )}
      </div>
      {error !== null && <p className="panel__error">{error}</p>}
      {record !== null && (
        <>
          <p className="ws__last">
            {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} for {record.designedFor}
            {record.emptyName !== null ? `, checked against ${record.emptyName}` : ''}
            {record.reused !== null ? `, reusing ${record.reused.name}` : ''}
          </p>
          {record.design.notes.length > 0 && (
            <ul className="warns" aria-label="Notes">
              {record.design.notes.map((n) => (
                <li key={n} className="warns__warn">
                  {n}
                </li>
              ))}
            </ul>
          )}
          {pairs.length > 0 && (
            <table className="wst ccheck__table" aria-label="Check primer pairs">
              <thead>
                <tr>
                  <th scope="col">Spans</th>
                  <th scope="col">Forward</th>
                  <th scope="col">Reverse</th>
                  <th scope="col" className="wst__n">
                    Clone
                  </th>
                  <th scope="col" className="wst__n">
                    Empty
                  </th>
                  <th scope="col" className="wst__n">
                    Reversed
                  </th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair, i) => (
                  <tr
                    key={`${pair.forwardSite.start}-${pair.reverseSite.end}`}
                    className={`cand${i === selected ? ' is-selected' : ''}${pair.problems.length > 0 ? ' ccheck__row--problem' : ''}`}
                    aria-selected={i === selected}
                    tabIndex={i === (selected ?? 0) ? 0 : -1}
                    data-row={i}
                    onClick={() => {
                      select(i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        select(i);
                      }
                    }}
                  >
                    <td>{junctionLabel(pair, junctions)}</td>
                    <td className="panel__mono wst__seq">{pair.forward.sequence}</td>
                    <td className="panel__mono wst__seq">{pair.reverse.sequence}</td>
                    <td className="wst__n">{bandText(pair.bands.clone)}</td>
                    <td className="wst__n">{bandText(pair.bands.empty)}</td>
                    <td className="wst__n">{bandText(pair.bands.flipped)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {selectedPair !== undefined && selected !== null && (
            <PairDetail
              doc={doc}
              state={state}
              pair={selectedPair}
              rank={selected + 1}
              onSaid={setSaid}
            />
          )}
          {said !== null && (
            <p className="panel__note" role="status">
              {said}
            </p>
          )}
        </>
      )}
      {layout === 'phone' && pairs.length > 0 && (
        <p className="panel__note panel__note--quiet">Tap a pair for its lanes and actions.</p>
      )}
    </>
  );
}
