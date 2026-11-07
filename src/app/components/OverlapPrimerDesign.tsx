import { useMemo, useState } from 'react';

import {
  type AssemblyInsert,
  type JunctionSplit,
  type OverlapKit,
  type OverlapPrimer,
  type SeqDocument,
  KIT_NAMES,
  KIT_OVERLAP,
  YEAST_OVERLAP,
  designMultiOverlapPrimers,
  designOverlapPrimers,
  recordOverlapDesign,
} from '@/core';

import { analytics } from '../analytics';
import { FIXED_BY, cloneCheckFromParts, openCloneCheck } from '../cloneCheck';
import { copyText } from '../clipboard';
import { OVERLAP_MAX_INSERTS, type OverlapSlot } from '../state/benchSettings';
import { cloningDocuments, editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { type InsertChoice, insertChoices } from './insertChoices';
import { ProductSummary } from './ProductSummary';

const KITS: readonly OverlapKit[] = ['in-fusion', 'nebuilder', 'yeast'];

const SPLITS: readonly { readonly value: JunctionSplit; readonly label: string }[] = [
  { value: 'both', label: 'Half on each primer' },
  { value: 'forward', label: 'On the next insert’s forward primer' },
  { value: 'reverse', label: 'On the previous insert’s reverse primer' },
];

function PrimerLine({
  label,
  primer,
  tailOf = 'vector',
}: {
  readonly label: string;
  readonly primer: OverlapPrimer;
  /** What the 5′ tail is taken from: the vector's end, or (several inserts) a mix with the neighbour. */
  readonly tailOf?: string;
}) {
  return (
    <li className="pair">
      <div className="pair__row pair__row--wide">
        <span className="pair__length">{label}</span>
        <span className="pair__meta">
          {primer.sequence.length} nt: {primer.tail.length} of {tailOf}, {primer.annealLength}{' '}
          annealing at {primer.tm.toFixed(0)} °C
        </span>
      </div>
      <div className="pair__foot">
        <code className="mutagenesis__oligo">{primer.sequence}</code>
        <span className="pair__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label={`Copy the ${label.toLowerCase()} primer`}
            onClick={() => {
              copyText(primer.sequence);
            }}
          >
            Copy
          </button>
        </span>
      </div>
    </li>
  );
}

/**
 * In-Fusion and NEBuilder HiFi (#63): the primer tails that make an
 * amplicon join a linearised vector. The reaction is the Gibson above, so
 * this sits inside that panel and designs the oligos it would need.
 *
 * Yeast assembly (#411) is the same design with longer tails. Its panel
 * passes `fixedKit`, so the design is for that kit whatever the Gibson panel's
 * buttons were left at, and the buttons are not shown.
 */
export function OverlapPrimerDesign({ fixedKit }: { readonly fixedKit?: OverlapKit } = {}) {
  const { documents, bench } = useEditorState();
  const { vectorId, templateId, insert, reverse, more, split, overlap } = bench.overlap;
  const kit = fixedKit ?? bench.overlap.kit;
  const [saved, setSaved] = useState('');
  const setKit = (next: OverlapKit): void => {
    editorStore.updateBench('overlap', { kit: next });
  };
  const setVectorId = (next: string): void => {
    editorStore.updateBench('overlap', { vectorId: next });
  };
  const setTemplateId = (next: string): void => {
    // Another template's features are not this one's: start from its selection.
    editorStore.updateBench('overlap', { templateId: next, insert: '' });
  };
  const setInsert = (next: string): void => {
    editorStore.updateBench('overlap', { insert: next });
  };
  const setMore = (next: readonly OverlapSlot[]): void => {
    editorStore.updateBench('overlap', { more: next });
  };
  const setSlot = (n: number, patch: Partial<OverlapSlot>): void => {
    setMore(more.map((m, i) => (i === n ? { ...m, ...patch } : m)));
  };

  const tabs = useMemo(
    () =>
      cloningDocuments(documents).map((d) => ({
        id: d.documentId,
        doc: d.history.present,
        selection: d.selection,
      })),
    [documents],
  );
  const vector = tabs.find((t) => t.id === vectorId);
  const template = tabs.find((t) => t.id === templateId);
  // The insert is picked here rather than by going to the template's tab to
  // select it (item 49): its selection there, one of its features, or the
  // whole of a linear template.
  const choices = useMemo(() => insertChoices(template), [template]);
  const region = (choices.find((c) => c.value === insert) ?? choices[0])?.range ?? null;

  const design = useMemo(
    () =>
      more.length > 0 ||
      vector === undefined ||
      template === undefined ||
      region === null ||
      vector === template
        ? null
        : designOverlapPrimers(vector.doc, template.doc, region, kit),
    [more.length, vector, template, region, kit],
  );

  // Two or more inserts (#413): each further one is a tab and a part of it,
  // like the first, and the design is run on the whole assembly.
  const further = useMemo(
    () =>
      more.map((m) => {
        const tab = tabs.find((t) => t.id === m.templateId);
        const options = insertChoices(tab);
        const picked = options.find((c) => c.value === m.insert) ?? options[0];
        return { tab, options, value: picked?.value ?? '', range: picked?.range ?? null };
      }),
    [more, tabs],
  );
  const assemblyInserts = useMemo((): readonly AssemblyInsert[] | null => {
    if (more.length === 0 || template === undefined || region === null) return null;
    const out: AssemblyInsert[] = [{ template: template.doc, region, reverse }];
    for (const [n, f] of further.entries()) {
      if (f.tab === undefined || f.range === null) return null;
      out.push({ template: f.tab.doc, region: f.range, reverse: more[n]?.reverse ?? false });
    }
    return out;
  }, [more, further, template, region, reverse]);
  const multi = useMemo(
    () =>
      assemblyInserts === null || vector === undefined
        ? null
        : designMultiOverlapPrimers(vector.doc, assemblyInserts, kit, {
            split,
            overlap,
          }),
    [assemblyInserts, vector, kit, split, overlap],
  );

  const picker = (label: string, value: string, set: (id: string) => void): React.ReactElement => (
    <label className="panel__field panel__field--row">
      <span>{label}</span>
      <select
        className="panel__select"
        aria-label={label}
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      >
        <option value="">choose a tab</option>
        {tabs.map((t) => (
          <option key={t.id} value={t.id}>
            {t.doc.name}
          </option>
        ))}
      </select>
    </label>
  );

  const open = (product: SeqDocument): void => {
    analytics.track('cloning', 'overlap-primers', KIT_NAMES[kit]);
    editorStore.openDocument(product, null, [], { scratch: true });
    editorStore.setSidebarTab('features');
  };

  /** The two tail primers, in My primers as `<template>-YA-F` and `-R` (#411). */
  const save = (): void => {
    if (design === null || template === undefined) return;
    analytics.track('cloning', 'yeast-oligos');
    const drafts = [
      {
        name: `${template.doc.name}-YA-F`,
        sequence: design.forward.sequence,
        notes: `Yeast assembly, forward tail primer for ${template.doc.name}`,
      },
      {
        name: `${template.doc.name}-YA-R`,
        sequence: design.reverse.sequence,
        notes: `Yeast assembly, reverse tail primer for ${template.doc.name}`,
      },
    ];
    void savePrimers(drafts, 'design').then((r) => {
      setSaved(
        r.added.length === 0
          ? 'Already in My primers.'
          : `Saved ${r.added.length.toLocaleString()} ${r.added.length === 1 ? 'primer' : 'primers'} to My primers.`,
      );
    });
  };

  /** Every insert's two primers, as `<template>-YA<n>-F` and `-R` (#413). */
  const saveMulti = (): void => {
    if (multi === null || assemblyInserts === null) return;
    analytics.track('cloning', 'yeast-oligos');
    const drafts = multi.inserts.flatMap((m, n) => {
      const name = `${assemblyInserts[n]?.template.name ?? 'insert'}-YA${n + 1}`;
      const notes = `Yeast assembly, insert ${n + 1} of ${multi.inserts.length}`;
      return [
        { name: `${name}-F`, sequence: m.forward.sequence, notes: `${notes}, forward tail primer` },
        { name: `${name}-R`, sequence: m.reverse.sequence, notes: `${notes}, reverse tail primer` },
      ];
    });
    void savePrimers(drafts, 'design').then((r) => {
      setSaved(
        r.added.length === 0
          ? 'Already in My primers.'
          : `Saved ${r.added.length.toLocaleString()} ${r.added.length === 1 ? 'primer' : 'primers'} to My primers.`,
      );
    });
  };

  return (
    <details className="gg__left-out">
      <summary>
        {fixedKit === undefined
          ? 'Design insert primers (In-Fusion, NEBuilder)'
          : `Design insert primers (${KIT_NAMES[fixedKit]})`}
      </summary>
      {fixedKit === undefined && (
        <div className="panel__controls">
          <div className="segmented" role="group" aria-label="Kit">
            {KITS.map((k) => (
              <button
                key={k}
                type="button"
                className={`segmented__button${kit === k ? ' segmented__button--active' : ''}`}
                aria-pressed={kit === k}
                data-tip={`${KIT_NAMES[k]}: ${KIT_OVERLAP[k]} bases of homology`}
                onClick={() => {
                  setKit(k);
                }}
              >
                {KIT_NAMES[k]}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="panel__controls">
        {picker('Linearised vector', vectorId, setVectorId)}
        {picker('Insert from', templateId, setTemplateId)}
        {template !== undefined && choices.length > 0 && (
          <label className="panel__field panel__field--row">
            <span>Insert</span>
            <select
              className="panel__select"
              aria-label="Insert"
              value={choices.some((c) => c.value === insert) ? insert : (choices[0]?.value ?? '')}
              onChange={(e) => {
                setInsert(e.target.value);
              }}
            >
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {more.length > 0 && (
          <label className="panel__field panel__field--row">
            <input
              type="checkbox"
              aria-label="Insert 1 reverse strand"
              checked={reverse}
              onChange={(e) => {
                editorStore.updateBench('overlap', { reverse: e.target.checked });
              }}
            />
            <span>Insert 1 on the reverse strand</span>
          </label>
        )}
        {more.map((m, n) => (
          <div key={n} className="panel__controls" role="group" aria-label={`Insert ${n + 2}`}>
            <label className="panel__field panel__field--row">
              <span>{`Insert ${n + 2} from`}</span>
              <select
                className="panel__select"
                aria-label={`Insert ${n + 2} from`}
                value={m.templateId}
                onChange={(e) => {
                  setSlot(n, { templateId: e.target.value, insert: '' });
                }}
              >
                <option value="">choose a tab</option>
                {tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.doc.name}
                  </option>
                ))}
              </select>
            </label>
            {(further[n]?.options.length ?? 0) > 0 && (
              <label className="panel__field panel__field--row">
                <span>{`Insert ${n + 2}`}</span>
                <select
                  className="panel__select"
                  aria-label={`Insert ${n + 2}`}
                  value={further[n]?.value ?? ''}
                  onChange={(e) => {
                    setSlot(n, { insert: e.target.value });
                  }}
                >
                  {(further[n]?.options ?? []).map((c: InsertChoice) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="panel__field panel__field--row">
              <input
                type="checkbox"
                aria-label={`Insert ${n + 2} reverse strand`}
                checked={m.reverse}
                onChange={(e) => {
                  setSlot(n, { reverse: e.target.checked });
                }}
              />
              <span>{`Insert ${n + 2} on the reverse strand`}</span>
            </label>
            <button
              type="button"
              className="button button--quiet button--small"
              aria-label={`Remove insert ${n + 2}`}
              onClick={() => {
                setMore(more.filter((_, i) => i !== n));
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--small"
            disabled={more.length + 1 >= OVERLAP_MAX_INSERTS}
            data-tip="Add another PCR product after the last insert, with the homology between them in the tails"
            onClick={() => {
              setMore([...more, { templateId, insert: '', reverse: false }]);
            }}
          >
            Add another insert
          </button>
        </div>
        {more.length > 0 && (
          <>
            <label className="panel__field panel__field--row">
              <span>Homology between inserts</span>
              <select
                className="panel__select"
                aria-label="Homology between inserts"
                value={split}
                onChange={(e) => {
                  const v = e.target.value;
                  editorStore.updateBench('overlap', {
                    split: v === 'forward' || v === 'reverse' ? v : 'both',
                  });
                }}
              >
                {SPLITS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {kit === 'yeast' && (
              <label className="panel__field panel__field--row">
                <span>Homology (bp)</span>
                <input
                  className="panel__input"
                  type="number"
                  aria-label="Homology in bp"
                  min={YEAST_OVERLAP.min}
                  max={YEAST_OVERLAP.max}
                  value={overlap}
                  onChange={(e) => {
                    editorStore.updateBench('overlap', { overlap: Number(e.target.value) });
                  }}
                />
              </label>
            )}
          </>
        )}
      </div>
      {more.length > 0 ? (
        multi === null ? (
          <p className="panel__note">
            Choose the linearised vector and, for each insert, the tab to amplify it from and which
            part of it. The inserts join in the order listed.
          </p>
        ) : multi.problem !== null ? (
          <p className="panel__error">{multi.problem}</p>
        ) : (
          <>
            <ol className="pair-list" aria-label="Insert primers">
              {multi.inserts.map((m, n) => (
                <li key={n}>
                  <ol className="pair-list" aria-label={`Insert ${n + 1} primers`}>
                    <PrimerLine
                      label={`Insert ${n + 1} forward`}
                      primer={m.forward}
                      tailOf={n === 0 ? 'vector' : 'homology'}
                    />
                    <PrimerLine
                      label={`Insert ${n + 1} reverse`}
                      primer={m.reverse}
                      tailOf={n === multi.inserts.length - 1 ? 'vector' : 'homology'}
                    />
                  </ol>
                </li>
              ))}
            </ol>
            <p className="panel__note panel__note--quiet">
              Upper case is the tail, the vector&rsquo;s end or homology to the neighbouring insert;
              the rest anneals to the template.
            </p>
            {multi.product !== null && (
              <>
                <ProductSummary product={multi.product} />
                <AssemblyWarnings texts={multi.warnings} />
                <div className="panel__controls">
                  <div className="panel__buttons">
                    <button
                      type="button"
                      className="button button--primary button--small"
                      data-tip="Open the circle the amplicons and the vector would make"
                      onClick={() => {
                        if (multi.product !== null) open(multi.product);
                      }}
                    >
                      Open product
                    </button>
                    {kit === 'yeast' && (
                      <button
                        type="button"
                        className="button button--small"
                        data-tip="Keep these primers in My primers, in this browser"
                        onClick={saveMulti}
                      >
                        Save primers
                      </button>
                    )}
                  </div>
                </div>
                {saved !== '' && (
                  <p className="panel__note panel__note--quiet" role="status">
                    {saved}
                  </p>
                )}
              </>
            )}
          </>
        )
      ) : template !== undefined && region === null ? (
        <p className="panel__note">
          {template.doc.name} has nothing selected and no features to amplify. Select the insert in
          its tab, or annotate it.
        </p>
      ) : design === null ? (
        <p className="panel__note">
          Choose the linearised vector and the tab to amplify the insert from, then which part of it
          is the insert. The primers get {KIT_OVERLAP[kit]} bases of the vector&rsquo;s ends on
          their 5′ tails, which is what {KIT_NAMES[kit]} asks for.
        </p>
      ) : design.problem !== null ? (
        <p className="panel__error">{design.problem}</p>
      ) : (
        <>
          <ol className="pair-list" aria-label="Insert primers">
            <PrimerLine label="Forward" primer={design.forward} />
            <PrimerLine label="Reverse" primer={design.reverse} />
          </ol>
          <p className="panel__note panel__note--quiet">
            Upper case is the vector&rsquo;s end; the rest anneals to the template.
          </p>
          {design.product !== null && (
            <>
              <ProductSummary product={design.product} />
              <AssemblyWarnings texts={design.warnings} />
              <div className="panel__controls">
                <div className="panel__buttons">
                  <button
                    type="button"
                    className="button button--primary button--small"
                    data-tip="Open the circle the amplicon and the vector would make"
                    onClick={() => {
                      // The circle with the vector and the amplicon it was made of, and the
                      // amplicon with its template and primers (#67).
                      const made =
                        vector === undefined || template === undefined
                          ? design.product
                          : recordOverlapDesign(design, vector.doc, template.doc, kit);
                      if (made !== null) open(made);
                    }}
                  >
                    Open product
                  </button>
                  <button
                    type="button"
                    className="button button--small"
                    data-tip="Open the circle and design colony-PCR primers for it, the uncut vector being the empty vector"
                    onClick={() => {
                      const amplicon = design.amplicon;
                      if (vector === undefined || template === undefined || amplicon === null) {
                        return;
                      }
                      const made = recordOverlapDesign(design, vector.doc, template.doc, kit);
                      if (made === null) return;
                      analytics.track('cloning', 'overlap-primers', KIT_NAMES[kit]);
                      openCloneCheck(
                        made,
                        cloneCheckFromParts(
                          made,
                          { document: vector.doc },
                          [{ document: amplicon }],
                          KIT_NAMES[kit],
                          { open: false, note: FIXED_BY.homology },
                          [
                            { name: 'Forward', sequence: design.forward.sequence },
                            { name: 'Reverse', sequence: design.reverse.sequence },
                          ],
                        ),
                        { scratch: true },
                        'overlap-primers',
                      );
                    }}
                  >
                    Check primers…
                  </button>
                  {kit === 'yeast' && (
                    <button
                      type="button"
                      className="button button--small"
                      data-tip="Keep these primers in My primers, in this browser"
                      onClick={save}
                    >
                      Save primers
                    </button>
                  )}
                </div>
              </div>
              {saved !== '' && (
                <p className="panel__note panel__note--quiet" role="status">
                  {saved}
                </p>
              )}
            </>
          )}
        </>
      )}
    </details>
  );
}
