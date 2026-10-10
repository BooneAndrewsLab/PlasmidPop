import { useMemo, useRef, useState } from 'react';

import {
  type GoldenGateOptions,
  type OverhangStandard,
  type PlanProduct,
  type PlanSlot,
  BUNDLED_STANDARDS,
  defaultGoldenGateEnzyme,
  detectPlacement,
  getEnzyme,
  goldenGateEnzymes,
  goldenGateFragments,
  planAssemblies,
  recordGoldenGate,
} from '@/core';

import { analytics } from '../analytics';
import { DESTINATION_TAG, NO_POSITION_TAG } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { FidelityReport } from './FidelityReport';
import { PartsTube } from './PartsTube';
import { type Ingredient, useTube } from './tube';

/** Rows of the plan shown; the rest are counted, since each is a full reaction's worth of text. */
const SHOWN = 50;
/** Most products "Assemble all" opens at once: each is a tab. */
const ASSEMBLE_ALL_MAX = 24;

/** What an ingredient is in the plan: a position, the destination, or nothing. */
type Role =
  | { readonly kind: 'position'; readonly position: string; readonly auto: boolean }
  | {
      readonly kind: 'destination';
      readonly left: string;
      readonly right: string;
      readonly auto: boolean;
    }
  | { readonly kind: 'none'; readonly auto: boolean };

function roleOf(
  ingredient: Ingredient,
  standard: OverhangStandard,
  options: GoldenGateOptions | null,
  tag: string | undefined,
): Role {
  const positionNames = new Set(standard.positions.map((p) => p.name));
  if (tag === NO_POSITION_TAG) return { kind: 'none', auto: false };
  if (options === null) return { kind: 'none', auto: true };
  const detected = detectPlacement(ingredient.document, standard, options);
  if (tag === DESTINATION_TAG) {
    const ends =
      detected?.kind === 'destination'
        ? detected
        : (() => {
            const f = goldenGateFragments(ingredient.document, options)[0];
            return {
              left: f?.left.overhang.toUpperCase() ?? '',
              right: f?.right.overhang.toUpperCase() ?? '',
            };
          })();
    return { kind: 'destination', left: ends.left, right: ends.right, auto: false };
  }
  if (tag !== undefined && positionNames.has(tag)) {
    return { kind: 'position', position: tag, auto: false };
  }
  if (detected?.kind === 'position') {
    return { kind: 'position', position: detected.position, auto: true };
  }
  if (detected?.kind === 'destination') {
    return { kind: 'destination', left: detected.left, right: detected.right, auto: true };
  }
  return { kind: 'none', auto: true };
}

function describeRole(role: Role): string {
  switch (role.kind) {
    case 'position':
      return role.position;
    case 'destination':
      return 'Destination';
    case 'none':
      return role.auto ? 'none found' : 'left out';
  }
}

function ProductRow({
  product,
  onAssemble,
}: {
  readonly product: PlanProduct;
  readonly onAssemble: (p: PlanProduct) => void;
}) {
  return (
    <li className="part">
      <span className="part__text">
        <span className="part__name">{product.name}</span>
        <span className="part__detail">
          {product.assembly === null
            ? product.problem
            : `${product.assembly.product.length.toLocaleString()} bp circle`}
        </span>
      </span>
      {product.assembly !== null && (
        <button
          type="button"
          className="button button--small"
          aria-label={`Assemble ${product.name}`}
          onClick={() => {
            onAssemble(product);
          }}
        >
          Assemble
        </button>
      )}
    </li>
  );
}

/** Import of a standard from a text file, and removal of the ones imported. */
function StandardImport({ custom }: { readonly custom: readonly OverhangStandard[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  return (
    <details className="gg__left-out">
      <summary>Import a standard</summary>
      <p className="panel__note panel__note--quiet">
        A text or CSV file with one position per line: its name, then the overhang it starts with
        and the overhang it ends with, like <code>Promoter,GGAG,TACT</code>. A first line{' '}
        <code># Name, BsmBI</code> names the standard and the enzyme it is cut with. It is read in
        your browser and kept there.
      </p>
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
        aria-label="Standard file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file === undefined) return;
          setError(null);
          setAdded(null);
          persistence
            .importStandardFile(file)
            .then((s) => {
              setAdded(`${s.name}: ${s.positions.length} positions.`);
              editorStore.updateBench('modular', { standard: s.id });
            })
            .catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
        }}
      />
      <button type="button" className="button button--small" onClick={() => input.current?.click()}>
        Choose file…
      </button>
      {error !== null && <p className="panel__note panel__note--error">{error}</p>}
      {added !== null && <p className="panel__note">{added}</p>}
      {custom.length > 0 && (
        <ul className="gg__parts" aria-label="Imported standards">
          {custom.map((s) => (
            <li key={s.id} className="gg__part">
              <span className="gg__name">{s.name}</span>
              <button
                type="button"
                className="link"
                aria-label={`Remove ${s.name}`}
                onClick={() => {
                  void persistence.removeStandard(s.id);
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * Modular cloning (#214): a standard names positions and the overhangs
 * between them; each part in the tube is placed at one, read off its ends or
 * set by hand; and the plan is every way of choosing one part per position,
 * each run as the Golden Gate it is.
 */
export function ModularPanel() {
  const { documents, shelf, bench, enzymeSetInfo, fidelityTable, customStandards } =
    useEditorState();
  const settings = bench.modular;
  const standards = useMemo(() => [...BUNDLED_STANDARDS, ...customStandards], [customStandards]);
  const standard = standards.find((s) => s.id === settings.standard) ?? standards[0];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultEnzyme = useMemo(() => defaultGoldenGateEnzyme(), [enzymeSetInfo]);
  const enzymeName =
    settings.enzyme !== ''
      ? settings.enzyme
      : getEnzyme(standard?.enzyme ?? '') !== undefined
        ? (standard?.enzyme ?? '')
        : (defaultEnzyme?.name ?? '');
  const enzyme = getEnzyme(enzymeName);
  const second = settings.secondEnzyme === '' ? undefined : getEnzyme(settings.secondEnzyme);
  const options = useMemo<GoldenGateOptions | null>(
    () =>
      enzyme === undefined
        ? null
        : second === undefined
          ? { enzyme }
          : { enzyme, secondEnzyme: second },
    [enzyme, second],
  );
  const excluded = useMemo(() => new Set(settings.excluded), [settings.excluded]);
  const { ingredients, used } = useTube(documents, shelf, excluded);

  const roles = useMemo(
    () =>
      standard === undefined
        ? []
        : used.map((i) => ({
            ingredient: i,
            role: roleOf(i, standard, options, settings.tags[i.id]),
          })),
    [used, standard, options, settings.tags],
  );

  const slots = useMemo<PlanSlot[]>(() => {
    if (standard === undefined) return [];
    const out: PlanSlot[] = [];
    const dests = roles.filter((r) => r.role.kind === 'destination');
    const first = dests[0]?.role;
    if (first?.kind === 'destination') {
      out.push({
        label: 'Destination',
        left: first.left,
        right: first.right,
        parts: dests.map((d) => ({ id: d.ingredient.id, document: d.ingredient.document })),
      });
    }
    for (const p of standard.positions) {
      const parts = roles.filter((r) => r.role.kind === 'position' && r.role.position === p.name);
      if (parts.length > 0) {
        out.push({
          label: p.name,
          left: p.left,
          right: p.right,
          parts: parts.map((d) => ({ id: d.ingredient.id, document: d.ingredient.document })),
        });
      }
    }
    return out;
  }, [roles, standard]);

  const plan = useMemo(
    () => (options === null ? null : planAssemblies(slots, options)),
    [slots, options],
  );

  const toggle = (id: string): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    editorStore.updateBench('modular', { excluded: [...next] });
  };
  const setTag = (id: string, value: string): void => {
    const tags = Object.fromEntries(Object.entries(settings.tags).filter(([k]) => k !== id));
    if (value !== '') tags[id] = value;
    editorStore.updateBench('modular', { tags });
  };

  const names =
    enzyme === undefined ? [] : second === undefined ? [enzyme.name] : [enzyme.name, second.name];
  const assemble = (p: PlanProduct): void => {
    if (p.assembly === null) return;
    analytics.track(
      'cloning',
      'modular-assemble',
      standard?.bundled === true ? standard.id : 'custom',
    );
    editorStore.openDocument(recordGoldenGate(p.assembly, names));
    editorStore.setSidebarTab('features');
  };

  if (ingredients.length === 0 || standard === undefined) {
    return (
      <p className="panel__note">
        Open the destination vector and the parts of the standard, or shelve them from a digest in
        the Cloning tab, then choose the standard they were made for.
      </p>
    );
  }

  const formed = plan?.products.filter((p) => p.assembly !== null) ?? [];
  const failed = plan?.products.filter((p) => p.assembly === null) ?? [];
  const firstFormed = formed[0]?.assembly ?? null;
  const unplaced = roles.filter((r) => r.role.kind === 'none');
  // Failures first, since they are what the plan is for finding.
  const rows = [...failed, ...formed];

  return (
    <>
      <div className="panel__controls">
        <label className="panel__field panel__field--row">
          <span>Standard</span>
          <select
            className="panel__select"
            value={standard.id}
            onChange={(e) => {
              editorStore.updateBench('modular', { standard: e.target.value, enzyme: '' });
            }}
          >
            {standards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="panel__field panel__field--row">
          <span>Enzyme</span>
          <select
            className="panel__select"
            aria-label="Enzyme"
            value={enzymeName}
            onChange={(e) => {
              editorStore.updateBench('modular', { enzyme: e.target.value });
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
            value={settings.secondEnzyme}
            onChange={(e) => {
              editorStore.updateBench('modular', { secondEnzyme: e.target.value });
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
      {standard.citation !== '' && (
        <p className="panel__note panel__note--quiet">{standard.citation}</p>
      )}
      <StandardImport custom={customStandards} />

      <PartsTube
        ingredients={ingredients}
        excluded={excluded}
        onToggle={toggle}
        label="Documents in the plan"
      />

      <h4 className="panel__subheading">Positions</h4>
      <ul className="gg__parts" aria-label="Part positions">
        {roles.map(({ ingredient, role }) => (
          <li key={ingredient.id} className="gg__part">
            <span className="gg__name">{ingredient.document.name}</span>
            <select
              className="panel__select"
              aria-label={`Position of ${ingredient.document.name}`}
              value={settings.tags[ingredient.id] ?? ''}
              onChange={(e) => {
                setTag(ingredient.id, e.target.value);
              }}
            >
              <option value="">
                Detected: {describeRole(role.auto ? role : { kind: 'none', auto: true })}
              </option>
              <option value={DESTINATION_TAG}>Destination</option>
              {standard.positions.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} {p.left}-{p.right}
                </option>
              ))}
              <option value={NO_POSITION_TAG}>Leave out</option>
            </select>
          </li>
        ))}
      </ul>
      {unplaced.length > 0 && (
        <p className="panel__note panel__note--quiet">
          Not placed: {unplaced.map((r) => r.ingredient.document.name).join(', ')}. Their ends match
          no position of {standard.name} with {enzymeName}; set one by hand, or leave them out.
        </p>
      )}

      {slots.length === 0 || plan === null ? (
        <p className="panel__note">Place at least a destination and one part.</p>
      ) : (
        <>
          <ul className="gg__parts" aria-label="Plan slots">
            {slots.map((s) => (
              <li key={s.label} className="gg__part">
                <span className="gg__name">{s.label}</span>
                <span className="gg__detail">
                  {s.left}-{s.right} · {s.parts.map((p) => p.document.name).join(', ')}
                </span>
              </li>
            ))}
          </ul>
          {plan.gaps.map((g) => (
            <p key={g} className="panel__note panel__note--warn">
              {g}
            </p>
          ))}
          {plan.tooMany ? (
            <p className="panel__error">
              {plan.total.toLocaleString()} combinations is too many to run; untick parts to get
              under 500.
            </p>
          ) : (
            <>
              <p className="panel__note" aria-label="Plan summary">
                {plan.total === 1 ? '1 combination' : `${plan.total} combinations`}: {formed.length}{' '}
                assemble
                {failed.length > 0 ? `, ${failed.length} cannot form` : ''}.
              </p>
              <ol className="part-list" aria-label="Plan products">
                {rows.slice(0, SHOWN).map((p) => (
                  <ProductRow
                    key={p.parts.map((x) => x.id).join('|')}
                    product={p}
                    onAssemble={assemble}
                  />
                ))}
              </ol>
              {rows.length > SHOWN && (
                <p className="panel__note panel__note--quiet">
                  and {rows.length - SHOWN} more, not listed.
                </p>
              )}
              {formed.length > 1 && (
                <div className="panel__buttons">
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={formed.length > ASSEMBLE_ALL_MAX}
                    title={
                      formed.length > ASSEMBLE_ALL_MAX
                        ? `Each product opens as a tab; up to ${ASSEMBLE_ALL_MAX} at once`
                        : 'Open every product as a new document'
                    }
                    onClick={() => {
                      for (const p of formed) assemble(p);
                    }}
                  >
                    Assemble all {formed.length}
                  </button>
                </div>
              )}
              {firstFormed !== null && (
                <>
                  <AssemblyWarnings texts={firstFormed.warnings.map((w) => w.text)} />
                  <FidelityReport
                    overhangs={firstFormed.order.map((p) => p.fragment.left.overhang)}
                    table={fidelityTable}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
