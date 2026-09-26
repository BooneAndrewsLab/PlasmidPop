import { useMemo } from 'react';

import {
  type AssembledPart,
  type DroppedFragment,
  type GoldenGateOptions,
  goldenGateEnzymes,
  defaultGoldenGateEnzyme,
  describeDropped,
  getEnzyme,
  goldenGate,
  recordGoldenGate,
} from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { PartsTube } from './PartsTube';
import { BenchProduct } from './BenchProduct';
import { FidelityReport } from './FidelityReport';
import { ProductSummary } from './ProductSummary';
import { useTube } from './tube';

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

function DroppedRow({ dropped }: { readonly dropped: DroppedFragment }) {
  return (
    <li className="gg__dropped">
      <span className="gg__dropped-size">
        {dropped.fragment.sequence.length.toLocaleString()} bp
      </span>{' '}
      of {dropped.fragment.source} {describeDropped(dropped)}.
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
  const { documents, shelf, bench, enzymeSetInfo, fidelityTable } = useEditorState();
  const settings = bench.goldenGate;
  // The default comes from the enzyme set in use, so it follows an imported
  // REBASE table; worked out once at import it stayed the bundled table's.
  // The table itself lives outside React; `enzymeSetInfo` is the store
  // saying it changed, which is exactly when the default has to be found again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultEnzyme = useMemo(() => defaultGoldenGateEnzyme(), [enzymeSetInfo]);
  const enzymeName = settings.enzyme === '' ? (defaultEnzyme?.name ?? '') : settings.enzyme;
  // Empty for none: most reactions have one enzyme (#11).
  const { secondEnzyme: secondName, name } = settings;
  const excluded = useMemo(() => new Set(settings.excluded), [settings.excluded]);
  const setEnzymeName = (next: string): void => {
    editorStore.updateBench('goldenGate', { enzyme: next });
  };
  const setSecondName = (next: string): void => {
    editorStore.updateBench('goldenGate', { secondEnzyme: next });
  };
  const setExcluded = (next: ReadonlySet<string>): void => {
    editorStore.updateBench('goldenGate', { excluded: [...next] });
  };
  const setName = (next: string): void => {
    editorStore.updateBench('goldenGate', { name: next });
  };

  const enzyme = getEnzyme(enzymeName);
  const second = secondName === '' ? undefined : getEnzyme(secondName);
  const options = useMemo<GoldenGateOptions | null>(
    () =>
      enzyme === undefined
        ? null
        : second === undefined
          ? { enzyme }
          : { enzyme, secondEnzyme: second },
    [enzyme, second],
  );
  // The shelf is in the tube as well as the open tabs. A piece already cut
  // out of a plasmid is a part like any other: the reaction digests it with
  // the Type IIS enzyme like everything else, and if it carries no site it
  // survives whole, joining on the sticky ends it already has.
  const { ingredients, used, docs } = useTube(documents, shelf, excluded);

  // Digesting every part and working out the order is done here rather than
  // in a worker: it is one enzyme over a few plasmids, and the panel has to
  // answer while the user is ticking boxes. See docs/perf-notes.md.
  const result = useMemo(
    () => (options === null || docs.length === 0 ? null : goldenGate(docs, options)),
    [docs, options],
  );

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  const assemble = (): void => {
    if (options === null || enzyme === undefined) return;
    const trimmed = name.trim();
    const run = goldenGate(docs, trimmed === '' ? options : { ...options, name: trimmed });
    if (run.assembly === null) {
      editorStore.fail(run.problem ?? 'The parts do not assemble.');
      return;
    }
    analytics.track('cloning', 'golden-gate', enzyme.name);
    editorStore.openDocument(
      recordGoldenGate(
        run.assembly,
        second === undefined ? [enzyme.name] : [enzyme.name, second.name],
      ),
    );
    editorStore.setSidebarTab('features');
    setName('');
  };

  if (ingredients.length === 0) {
    return (
      <p className="panel__note">
        Open the destination vector and the parts to put in it, or shelve them from a digest in the
        Cloning tab, then choose the enzyme they were designed for.
      </p>
    );
  }

  const assembly = result?.assembly ?? null;

  return (
    <>
      <BenchProduct product={assembly?.product ?? null} parts={used} />
      <div className="panel__controls">
        <label className="panel__field panel__field--row">
          <span>Enzyme</span>
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
        <label className="panel__field panel__field--row">
          <span>and</span>
          <select
            className="panel__select"
            aria-label="Second enzyme"
            value={secondName}
            onChange={(e) => {
              setSecondName(e.target.value);
            }}
          >
            <option value="">no other</option>
            {goldenGateEnzymes()
              .filter((e) => e.name !== enzymeName)
              .map((e) => (
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
          <ProductSummary product={assembly.product} />
          <AssemblyWarnings texts={assembly.warnings.map((w) => w.text)} />
          {/* What a measured end-joining table says about the same
              junctions (#68), beside the design rules above. */}
          <FidelityReport
            overhangs={assembly.order.map((p) => p.fragment.left.overhang)}
            table={fidelityTable}
          />
        </>
      ) : (
        <p className="panel__error">{result?.problem}</p>
      )}

      {result !== null && result.dropped.length > 0 && (
        <details className="gg__left-out">
          <summary>
            {result.dropped.length === 1
              ? '1 piece left out'
              : `${result.dropped.length} pieces left out`}
          </summary>
          <ul>
            {result.dropped.map((d, i) => (
              <DroppedRow key={`${d.fragment.source}-${i}`} dropped={d} />
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
