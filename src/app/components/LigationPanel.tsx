import { Fragment, useCallback, useMemo } from 'react';

import {
  type FragmentEnd,
  type WrongClone,
  assemblyJunctions,
  describeEnd,
  ligate,
  ligationSeed,
  ligationWrongClones,
  recordLigation,
  wrongLanes,
} from '@/core';

import { analytics } from '../analytics';
import {
  cloneCheckFromParts,
  ligationOrientation,
  longestPart,
  openCloneCheck,
} from '../cloneCheck';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { PartsTube } from './PartsTube';
import { BenchProduct } from './BenchProduct';
import { ProductSummary } from './ProductSummary';
import { type Ingredient, shelfIngredients } from './tube';

function JunctionRow({
  from,
  to,
  compatible,
  dephosphorylated,
  closing,
}: {
  readonly from: FragmentEnd;
  readonly to: FragmentEnd;
  readonly compatible: boolean;
  readonly dephosphorylated: boolean;
  readonly closing: boolean;
}) {
  return (
    <li
      className={`junction${compatible ? ' junction--ok' : ' junction--bad'}`}
      aria-label={`${closing ? 'Closing join' : 'Join'}: ${describeEnd(from)} to ${describeEnd(to)}, ${compatible ? 'compatible' : 'incompatible'}`}
    >
      <span className="junction__mark" aria-hidden="true">
        {compatible ? '✓' : '✕'}
      </span>
      <span className="junction__text">
        {closing ? 'closes: ' : ''}
        {describeEnd(from)} ↔ {describeEnd(to)}
        {compatible
          ? ''
          : dephosphorylated
            ? ' — both sides dephosphorylated, so neither strand joins'
            : ' — ends do not match'}
      </span>
    </li>
  );
}

/**
 * Restriction-ligation of the shelf's fragments, in the order and the
 * orientation they stand in on the shelf: unlike the one-pot reactions a
 * ligase does not choose, so the user does, and every junction is checked.
 * The ticks leave a shelf part out, as the one-pot reactions' tubes do, since
 * the shelf also holds pieces meant for them.
 */
export function LigationPanel() {
  const { shelf, bench } = useEditorState();
  const { circular, name } = bench.ligation;
  const excluded = useMemo(() => new Set(bench.ligation.excluded), [bench.ligation.excluded]);
  const setExcluded = (next: ReadonlySet<string>): void => {
    editorStore.updateBench('ligation', { excluded: [...next] });
  };
  const setCircular = (next: boolean): void => {
    editorStore.updateBench('ligation', { circular: next });
  };
  const setName = (next: string): void => {
    editorStore.updateBench('ligation', { name: next });
  };

  const ingredients = useMemo(() => shelfIngredients(shelf), [shelf]);
  const inTube = useMemo(
    () => ingredients.filter((i) => !excluded.has(i.id)),
    [ingredients, excluded],
  );
  const used = useMemo(() => shelf.filter((p) => !excluded.has(p.id)), [shelf, excluded]);
  const parts = useMemo(() => used.map((p) => p.fragment), [used]);
  const junctions = assemblyJunctions(parts, circular);
  const canAssemble = parts.length > 0 && junctions.every((j) => j.compatible);
  const defaultName = `${[...new Set(parts.map((f) => f.source))].join('+')} assembly`;
  // Joining strings and shifting a few features: cheap enough to do on
  // every render, so the product can be described before it is made (#15);
  // memoised all the same, since the wrong clones (item 132) and their
  // digests are worked out from it and should not be on every keystroke.
  const preview = useMemo(
    () => (canAssemble ? ligate(parts, { name: defaultName, circular }) : null),
    [canAssemble, parts, defaultName, circular],
  );
  // The wrong clones a colony may carry instead, for the vector the Bench
  // checks against: the same fragments, joined the other ways their ends
  // allow (item 132).
  const wrongClonesOf = useCallback(
    (vector: Ingredient): readonly WrongClone[] =>
      preview === null || vector.fragment === undefined
        ? []
        : ligationWrongClones(parts, parts.indexOf(vector.fragment), preview),
    [parts, preview],
  );

  if (shelf.length === 0) {
    return (
      <p className="panel__note">
        Put the vector and the insert on the shelf, from the Cloning tab's digest of one file or
        several, then arrange them there.
      </p>
    );
  }

  const names = new Map(ingredients.map((i) => [i.id, i.document.name]));

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  };

  /** Assembles and opens the product; with `check`, on the clone-check page with its context (item 120). */
  const assemble = (check = false, vectorId = ''): void => {
    try {
      analytics.track('cloning', 'ligate');
      // With the parts it was joined from, in order and orientation (#67).
      const product = recordLigation(
        ligate(parts, {
          name: name.trim() === '' ? defaultName : name.trim(),
          circular,
        }),
        used,
        circular,
      );
      // The shelf is left as it is: a vector cut once is often ligated to
      // one insert after another, and the other reactions may want its parts.
      const storage = { scratch: true, shownEnzymes: ligationSeed(parts) };
      if (check) {
        // The vector the Bench's Against picker names, else the longest part (#329).
        const picked = inTube.find((i) => i.id === vectorId);
        const vector = picked ?? longestPart(inTube);
        const at = vector === undefined ? -1 : inTube.indexOf(vector);
        const context =
          vector === undefined
            ? null
            : cloneCheckFromParts(
                product,
                vector,
                inTube.filter((i) => i !== vector),
                'Ligation',
                ligationOrientation(parts, at, circular),
                [],
                picked !== undefined,
                wrongLanes(wrongClonesOf(vector)).shown,
              );
        openCloneCheck(product, context, storage, 'ligation');
      } else {
        editorStore.openDocument(product, null, [], storage);
        editorStore.setSidebarTab('features');
      }
      setName('');
    } catch (e) {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <BenchProduct
        product={preview}
        parts={inTube}
        wrongClonesOf={wrongClonesOf}
        onCheckPrimers={
          canAssemble
            ? (vectorId) => {
                assemble(true, vectorId);
              }
            : undefined
        }
      />
      <PartsTube
        ingredients={ingredients}
        excluded={excluded}
        onToggle={toggle}
        label="Fragments in the ligation"
      />
      {used.length === 0 ? (
        <p className="panel__note">Every fragment is left out.</p>
      ) : (
        <ol className="part-list" aria-label="Ligation order">
          {used.map((part, i) => {
            const join = junctions[i];
            return (
              <Fragment key={part.id}>
                <li className="part">
                  <span className="part__index">{i + 1}</span>
                  <span className="part__text">
                    <span className="part__name">
                      {names.get(part.id) ?? part.fragment.source}
                      {part.flipped ? ' (flipped)' : ''}
                    </span>
                    <span className="part__detail">
                      {part.fragment.sequence.length.toLocaleString()} bp
                    </span>
                  </span>
                </li>
                {join !== undefined && <JunctionRow {...join} closing={i === used.length - 1} />}
              </Fragment>
            );
          })}
        </ol>
      )}
      {preview !== null && <ProductSummary product={preview} />}
      <div className="panel__controls">
        <input
          className="panel__search"
          type="text"
          placeholder={defaultName}
          aria-label="Name of the assembled document"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
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
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--primary button--small"
            disabled={!canAssemble}
            data-tip={
              canAssemble
                ? 'Ligate the fragments into a new document'
                : 'Every join must have matching ends, and a phosphate on at least one side'
            }
            onClick={() => {
              assemble();
            }}
          >
            Assemble
          </button>
        </div>
      </div>
    </>
  );
}
