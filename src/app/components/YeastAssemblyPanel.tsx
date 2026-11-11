import { useMemo, useState } from 'react';

import {
  type GibsonJoin,
  YEAST_GC,
  YEAST_OVERLAP,
  clampYeastOverlap,
  gcPercent,
  recordGibson,
  yeastAssembly,
} from '@/core';

import { analytics } from '../analytics';
import { FIXED_BY, cloneCheckFromParts, longestPart, openCloneCheck } from '../cloneCheck';
import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyOrder, DroppedParts, type JunctionVerdict } from './AssemblyOrder';
import { BenchProduct } from './BenchProduct';
import { OverlapPrimerDesign } from './OverlapPrimerDesign';
import { PartsTube } from './PartsTube';
import { useTube } from './tube';

/**
 * The homology a junction is made of: its length and its GC, never its Tm,
 * because the cell recombines it at 30 °C in a nucleus and not at 50 °C in a
 * tube. Marked when it is under the 30 bp the warnings give or outside the
 * GC they give.
 */
const judgeJoin = (join: GibsonJoin): JunctionVerdict => {
  const gc = gcPercent(join.overlap);
  return {
    weak: join.length < YEAST_OVERLAP.floor || gc < YEAST_GC.low || gc > YEAST_GC.high,
    detail: `${gc.toFixed(0)}% GC`,
  };
};

/**
 * Assembly in yeast by homologous recombination (#411): TAR cloning, gap
 * repair into a linearised vector. The reaction is Gibson's, which part ends
 * in which, so the panel is Gibson's with what the cell asks instead of what
 * an enzyme mix does: a vector named, 20 to 80 bp of homology (40 by default),
 * junctions judged by length and GC, and the warnings of `yeastWarnings`.
 */
export function YeastAssemblyPanel() {
  const { documents, shelf, bench } = useEditorState();
  const { minOverlap, circular, name, vectorId } = bench.yeast;
  const excluded = useMemo(() => new Set(bench.yeast.excluded), [bench.yeast.excluded]);
  const setExcluded = (next: ReadonlySet<string>): void => {
    editorStore.updateBench('yeast', { excluded: [...next] });
  };
  const setMinOverlap = (next: number): void => {
    editorStore.updateBench('yeast', { minOverlap: next });
  };
  const setCircular = (next: boolean): void => {
    editorStore.updateBench('yeast', { circular: next });
  };
  const setName = (next: string): void => {
    editorStore.updateBench('yeast', { name: next });
  };
  const setVectorId = (next: string): void => {
    editorStore.updateBench('yeast', { vectorId: next });
  };
  // What is being typed in the overlap field, until it is left or Enter is
  // pressed: holding every keystroke to 20–80 would make 25 impossible to
  // type, since the 2 on its way is already under the floor.
  const [pending, setPending] = useState<string | null>(null);
  const commitOverlap = (): void => {
    const n = Number.parseInt(pending ?? '', 10);
    if (Number.isFinite(n)) setMinOverlap(clampYeastOverlap(n));
    setPending(null);
  };

  const { ingredients, used, docs } = useTube(documents, shelf, excluded);
  // The vector is one of the parts in the tube; one that is left out, or no
  // longer open, is no vector, and every part is an insert (plain TAR).
  const vectorPart = used.find((i) => i.id === vectorId);
  const vector = vectorPart?.document ?? null;
  const result = useMemo(
    () => (docs.length === 0 ? null : yeastAssembly(docs, { minOverlap, circular, vector })),
    [docs, minOverlap, circular, vector],
  );

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  /** Assembles and opens the product; with `check`, on the clone-check page with its context (item 120). */
  const assemble = (check = false): void => {
    const trimmed = name.trim();
    const run = yeastAssembly(docs, {
      minOverlap,
      circular,
      vector,
      ...(trimmed === '' ? {} : { name: trimmed }),
    });
    if (run.assembly === null) {
      editorStore.fail(run.problem ?? 'The parts do not assemble.');
      return;
    }
    analytics.track('cloning', 'yeast');
    const product = recordGibson(run.assembly, {
      kit: 'yeast',
      circular,
      overlap: minOverlap,
    });
    if (check) {
      const backbone = vectorPart ?? longestPart(used);
      const context =
        backbone === undefined
          ? null
          : cloneCheckFromParts(
              product,
              backbone,
              used.filter((i) => i !== backbone),
              'Yeast assembly',
              { open: false, note: FIXED_BY.homology },
            );
      openCloneCheck(product, context, { scratch: true }, 'yeast');
    } else {
      editorStore.openDocument(product, null, [], { scratch: true });
      editorStore.setSidebarTab('features');
    }
    setName('');
  };

  if (ingredients.length === 0) {
    return (
      <p className="panel__note">
        Open the linearised vector and the inserts, each ending in the bases the next one starts
        with, or shelve the pieces from a digest in the Cloning tab.
      </p>
    );
  }

  const assembly = result?.assembly ?? null;

  return (
    <>
      <BenchProduct
        product={assembly?.product ?? null}
        parts={used}
        onCheckPrimers={
          assembly === null || !circular
            ? undefined
            : () => {
                assemble(true);
              }
        }
      />
      <p className="panel__note panel__note--quiet">
        Linearise the vector first: digest it and shelve the piece, or amplify it by inverse PCR.{' '}
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            openGuide('12-cloning#yeast-assembly');
          }}
        >
          What this means
        </button>
      </p>
      <div className="panel__controls">
        <label className="panel__field">
          <span>Vector</span>
          <select
            className="panel__select"
            value={vectorPart === undefined ? '' : vectorPart.id}
            data-tip="The linearised vector, whose two ends the homology closes; the other parts are inserts"
            onChange={(e) => {
              setVectorId(e.target.value);
            }}
          >
            <option value="">none (all parts are inserts)</option>
            {used.map((i) => (
              <option key={i.id} value={i.id}>
                {i.document.name}
              </option>
            ))}
          </select>
        </label>
        <label className="panel__field">
          <span>Overlap</span>
          <input
            className="panel__number"
            type="number"
            min={YEAST_OVERLAP.min}
            max={YEAST_OVERLAP.max}
            value={pending ?? String(minOverlap)}
            data-tip={`The shortest homology to accept at a junction, ${YEAST_OVERLAP.min} to ${YEAST_OVERLAP.max} bp`}
            onChange={(e) => {
              setPending(e.target.value);
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= YEAST_OVERLAP.min && n <= YEAST_OVERLAP.max) {
                setMinOverlap(n);
              }
            }}
            onBlur={commitOverlap}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitOverlap();
            }}
          />
          bp or more
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

      <PartsTube
        ingredients={ingredients}
        excluded={excluded}
        onToggle={toggle}
        label="Documents in the yeast assembly"
      />

      {docs.length === 0 ? (
        <p className="panel__note">Tick the documents to put in the tube.</p>
      ) : assembly !== null ? (
        <AssemblyOrder
          assembly={assembly}
          circular={circular}
          label="Yeast assembly order"
          vectorIndex={assembly.vectorIndex}
          judge={judgeJoin}
        />
      ) : (
        <>
          <p className="panel__error">{result?.problem}</p>
          {/* Only the dead-end errors: "Nothing to assemble" is also what a
              circular vector gets, and the designer refuses that too. */}
          {result?.problem?.startsWith('Nothing follows') === true && (
            <p className="panel__note panel__note--quiet">
              An insert without the homology yet gets it from Design insert primers, below.
            </p>
          )}
        </>
      )}

      {result !== null && result.dropped.length > 0 && (
        <DroppedParts dropped={result.dropped} minOverlap={minOverlap} />
      )}

      {assembly !== null && (
        <div className="panel__controls">
          <input
            className="panel__search"
            type="text"
            placeholder={assembly.product.name}
            aria-label="Name of the yeast assembly product"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--primary button--small"
              aria-label="Assemble in yeast"
              data-tip="Open the product as a new document"
              onClick={() => {
                assemble();
              }}
            >
              Assemble
            </button>
          </div>
        </div>
      )}

      {/* The tails that make an amplicon recombine into a linearised vector,
          at the 40 bp a yeast assembly takes (#411). */}
      <OverlapPrimerDesign fixedKit="yeast" />
    </>
  );
}
