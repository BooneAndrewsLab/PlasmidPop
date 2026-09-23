import { useMemo, useState } from 'react';

import {
  type AssembledPart,
  type DroppedFragment,
  type Enzyme,
  goldenGateEnzymes,
  defaultGoldenGateEnzyme,
  describeDropped,
  getEnzyme,
  goldenGate,
} from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { PartsTube } from './PartsTube';
import { useTube } from './tube';

const DEFAULT_ENZYME = defaultGoldenGateEnzyme();

/** One part in the order the reaction puts them, with the overhang it joins on. */
function OrderRow({ part, index }: { readonly part: AssembledPart; readonly index: number }) {
  const { fragment, flipped } = part;
  return (
    <li className="part">
      <span className="part__index">{index + 1}</span>
      <span className="part__text">
        <span className="part__name">
          {fragment.source}
          {flipped ? ' (flipped)' : ''}
        </span>
        <span className="part__detail">{fragment.sequence.length.toLocaleString()} bp</span>
      </span>
      <span className="end__overhang" title="The overhang this part joins on">
        {fragment.left.overhang.toUpperCase()}
      </span>
    </li>
  );
}

function DroppedRow({
  dropped,
  enzyme,
}: {
  readonly dropped: DroppedFragment;
  readonly enzyme: Enzyme;
}) {
  return (
    <li className="gg__dropped">
      <span className="gg__dropped-size">
        {dropped.fragment.sequence.length.toLocaleString()} bp
      </span>{' '}
      of {dropped.fragment.source} {describeDropped(dropped, enzyme)}.
    </li>
  );
}

/**
 * Golden Gate: one Type IIS enzyme, every part in one tube, and the order
 * decided by the overhangs rather than by the user. The panel is a picker
 * for the enzyme and the parts, and then a report of what the reaction
 * would do.
 */
export function GoldenGatePanel() {
  const { documents, shelf } = useEditorState();
  const [enzymeName, setEnzymeName] = useState(DEFAULT_ENZYME?.name ?? '');
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState('');

  const enzyme = getEnzyme(enzymeName);
  // The shelf is in the tube as well as the open tabs. A piece already cut
  // out of a plasmid is a part like any other: the reaction digests it with
  // the Type IIS enzyme like everything else, and if it carries no site it
  // survives whole, joining on the sticky ends it already has.
  const { ingredients, docs } = useTube(documents, shelf, excluded);

  // Digesting every part and working out the order is done here rather than
  // in a worker: it is one enzyme over a few plasmids, and the panel has to
  // answer while the user is ticking boxes. See docs/perf-notes.md.
  const result = useMemo(
    () => (enzyme === undefined || docs.length === 0 ? null : goldenGate(docs, { enzyme })),
    [docs, enzyme],
  );

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  const assemble = (): void => {
    if (enzyme === undefined) return;
    const trimmed = name.trim();
    const run = goldenGate(docs, trimmed === '' ? { enzyme } : { enzyme, name: trimmed });
    if (run.assembly === null) {
      editorStore.fail(run.problem ?? 'The parts do not assemble.');
      return;
    }
    analytics.track('cloning', 'golden-gate', enzyme.name);
    editorStore.openDocument(run.assembly.product);
    editorStore.setSidebarTab('features');
    setName('');
  };

  if (ingredients.length === 0) {
    return (
      <p className="panel__note">
        Open the destination vector and the parts to put in it, or collect them from a digest above,
        then choose the enzyme they were designed for.
      </p>
    );
  }

  const assembly = result?.assembly ?? null;

  return (
    <>
      <div className="panel__controls">
        <label className="panel__field">
          Enzyme
          <select
            className="panel__select"
            value={enzymeName}
            onChange={(e) => {
              setEnzymeName(e.target.value);
            }}
          >
            {goldenGateEnzymes().map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} {e.site}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PartsTube
        ingredients={ingredients}
        excluded={excluded}
        onToggle={toggle}
        label="Documents in the Golden Gate"
      />

      {enzyme === undefined ? (
        <p className="panel__note">Choose a Type IIS enzyme.</p>
      ) : docs.length === 0 ? (
        <p className="panel__note">Tick the documents to put in the tube.</p>
      ) : assembly !== null ? (
        <>
          <p className="panel__note">
            {assembly.order.length === 1
              ? '1 part closes on itself'
              : `${assembly.order.length} parts join`}{' '}
            into a {assembly.product.length.toLocaleString()} bp circle, in this order:
          </p>
          <ol className="part-list" aria-label="Assembly order">
            {assembly.order.map((p, i) => (
              <OrderRow
                key={`${p.fragment.source}-${p.fragment.range.start}-${i}`}
                part={p}
                index={i}
              />
            ))}
          </ol>
        </>
      ) : (
        <p className="panel__error">{result?.problem}</p>
      )}

      {result !== null && result.dropped.length > 0 && enzyme !== undefined && (
        <details className="gg__left-out">
          <summary>
            {result.dropped.length === 1
              ? '1 piece left out'
              : `${result.dropped.length} pieces left out`}
          </summary>
          <ul>
            {result.dropped.map((d, i) => (
              <DroppedRow key={`${d.fragment.source}-${i}`} dropped={d} enzyme={enzyme} />
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
            aria-label="Name of the Golden Gate product"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--primary button--small"
              aria-label="Assemble by Golden Gate"
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
