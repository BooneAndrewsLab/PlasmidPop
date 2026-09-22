import { Fragment, useMemo, useState } from 'react';

import {
  type DroppedPart,
  type GibsonJoin,
  type GibsonPart,
  GIBSON_DEFAULTS,
  describeGibsonDropped,
  gibson,
} from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** Overlaps a designer would ask for; NEB's protocol wants 15 or more. */
const OVERLAPS = [12, 15, 20, 25, 30, 40];

/**
 * Below this a junction anneals poorly at the 50 °C the reaction is held at.
 * It is a warning, not a refusal: the homology is there, and whether it
 * works is a bench question.
 */
const WEAK_TM = 48;

function PartRow({ part, index }: { readonly part: GibsonPart; readonly index: number }) {
  return (
    <li className="part">
      <span className="part__index">{index + 1}</span>
      <span className="part__text">
        <span className="part__name">
          {part.document.name}
          {part.flipped ? ' (flipped)' : ''}
        </span>
        <span className="part__detail">{part.document.length.toLocaleString()} bp</span>
      </span>
    </li>
  );
}

/** The homology a junction is made of, which is the thing to check. */
function JoinRow({ join, closing }: { readonly join: GibsonJoin; readonly closing: boolean }) {
  const weak = join.tm < WEAK_TM;
  return (
    <li
      className={`junction${weak ? ' junction--weak' : ' junction--ok'}`}
      title={`Shared: ${join.overlap.toUpperCase()}`}
    >
      <span className="junction__mark" aria-hidden="true">
        {weak ? '!' : '✓'}
      </span>
      <span className="junction__text">
        {closing ? 'closes: ' : ''}
        {join.length} bp overlap, Tm {join.tm.toFixed(0)} °C
        {weak ? ` — under ${WEAK_TM} °C, so it may not anneal` : ''}
      </span>
    </li>
  );
}

/**
 * Gibson assembly: no enzyme, no site, no scar. Each piece is made to end in
 * the bases the next one starts with, and the reaction joins them in the one
 * order that homology allows. So the panel asks only which documents are in
 * the tube and how much homology to insist on, and then reports the order it
 * found and what each junction is made of.
 */
export function GibsonPanel() {
  const { documents } = useEditorState();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [minOverlap, setMinOverlap] = useState<number>(GIBSON_DEFAULTS.minOverlap);
  const [circular, setCircular] = useState(true);
  const [name, setName] = useState('');

  const docs = useMemo(
    () => documents.filter((d) => !excluded.has(d.documentId)).map((d) => d.history.present),
    [documents, excluded],
  );
  // Finding the junctions is a handful of string comparisons per pair of
  // ends, so it is done here rather than in a worker, like the Golden Gate
  // above it (docs/perf-notes.md).
  const result = useMemo(
    () => (docs.length === 0 ? null : gibson(docs, { minOverlap, circular })),
    [docs, minOverlap, circular],
  );

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  const assemble = (): void => {
    const trimmed = name.trim();
    const run = gibson(docs, {
      minOverlap,
      circular,
      ...(trimmed === '' ? {} : { name: trimmed }),
    });
    if (run.assembly === null) {
      editorStore.fail(run.problem ?? 'The parts do not assemble.');
      return;
    }
    analytics.track('cloning', 'gibson');
    editorStore.openDocument(run.assembly.product);
    editorStore.setSidebarTab('features');
    setName('');
  };

  if (documents.length === 0) {
    return (
      <p className="panel__note">
        Open the linearised vector and the inserts, each ending in the bases the next one starts
        with.
      </p>
    );
  }

  const assembly = result?.assembly ?? null;

  return (
    <>
      <div className="panel__controls">
        <label className="panel__field">
          <span>Overlap</span>
          <select
            className="panel__select"
            value={minOverlap}
            title="The shortest homology to accept at a junction"
            onChange={(e) => {
              setMinOverlap(Number(e.target.value));
            }}
          >
            {OVERLAPS.map((n) => (
              <option key={n} value={n}>
                {n} bp or more
              </option>
            ))}
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={circular}
            onChange={(e) => {
              setCircular(e.target.checked);
            }}
          />
          Circular product
        </label>
      </div>

      <ul className="gg__parts" aria-label="Documents in the Gibson">
        {documents.map((d) => (
          <li key={d.documentId}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={!excluded.has(d.documentId)}
                onChange={() => {
                  toggle(d.documentId);
                }}
              />
              {d.history.present.name}
            </label>
          </li>
        ))}
      </ul>

      {docs.length === 0 ? (
        <p className="panel__note">Tick the documents to put in the tube.</p>
      ) : assembly !== null ? (
        <>
          <p className="panel__note">
            {assembly.order.length === 1
              ? '1 part closes on itself'
              : `${assembly.order.length} parts join`}{' '}
            into a {assembly.product.length.toLocaleString()} bp {circular ? 'circle' : 'molecule'},
            in this order:
          </p>
          <ol className="part-list" aria-label="Gibson assembly order">
            {assembly.order.map((p, i) => {
              const join = assembly.joins[i];
              return (
                <Fragment key={`${p.document.name}-${i}`}>
                  <PartRow part={p} index={i} />
                  {join !== undefined && (
                    <JoinRow join={join} closing={i === assembly.order.length - 1} />
                  )}
                </Fragment>
              );
            })}
          </ol>
        </>
      ) : (
        <p className="panel__error">{result?.problem}</p>
      )}

      {result !== null && result.dropped.length > 0 && (
        <details className="gg__left-out">
          <summary>
            {result.dropped.length === 1
              ? '1 document left out'
              : `${result.dropped.length} documents left out`}
          </summary>
          <ul>
            {result.dropped.map((d: DroppedPart, i) => (
              <li key={`${d.document.name}-${i}`} className="gg__dropped">
                <span className="gg__dropped-size">{d.document.name}</span>{' '}
                {describeGibsonDropped(d, minOverlap)}.
              </li>
            ))}
          </ul>
        </details>
      )}

      {assembly !== null && (
        <div className="panel__controls">
          <input
            className="panel__search"
            type="text"
            placeholder={assembly.product.name}
            aria-label="Name of the Gibson product"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--primary button--small"
              aria-label="Assemble by Gibson"
              title="Open the product as a new document"
              onClick={assemble}
            >
              Assemble
            </button>
          </div>
        </div>
      )}
    </>
  );
}
