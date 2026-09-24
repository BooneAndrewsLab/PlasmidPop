import { useMemo } from 'react';

import {
  type OverlapKit,
  type OverlapPrimer,
  type SeqDocument,
  KIT_NAMES,
  KIT_OVERLAP,
  designOverlapPrimers,
  isEmptyRange,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { ProductSummary } from './ProductSummary';

const KITS: readonly OverlapKit[] = ['in-fusion', 'nebuilder'];

function PrimerLine({ label, primer }: { readonly label: string; readonly primer: OverlapPrimer }) {
  return (
    <li className="pair">
      <div className="pair__row pair__row--wide">
        <span className="pair__length">{label}</span>
        <span className="pair__meta">
          {primer.sequence.length} nt: {primer.tail.length} of vector, {primer.annealLength}{' '}
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
 */
export function OverlapPrimerDesign() {
  const { documents, bench } = useEditorState();
  const { kit, vectorId, templateId } = bench.overlap;
  const setKit = (next: OverlapKit): void => {
    editorStore.updateBench('overlap', { kit: next });
  };
  const setVectorId = (next: string): void => {
    editorStore.updateBench('overlap', { vectorId: next });
  };
  const setTemplateId = (next: string): void => {
    editorStore.updateBench('overlap', { templateId: next });
  };

  const tabs = useMemo(
    () =>
      documents.map((d) => ({
        id: d.documentId,
        doc: d.history.present,
        selection: d.selection,
      })),
    [documents],
  );
  const vector = tabs.find((t) => t.id === vectorId);
  const template = tabs.find((t) => t.id === templateId);
  const region =
    template?.selection !== null &&
    template?.selection !== undefined &&
    !isEmptyRange(template.selection)
      ? template.selection
      : null;

  const design = useMemo(
    () =>
      vector === undefined || template === undefined || region === null || vector === template
        ? null
        : designOverlapPrimers(vector.doc, template.doc, region, kit),
    [vector, template, region, kit],
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
    editorStore.openDocument(product);
    editorStore.setSidebarTab('features');
  };

  return (
    <details className="gg__left-out">
      <summary>Design insert primers (In-Fusion, NEBuilder)</summary>
      <div className="panel__controls">
        <div className="segmented" role="group" aria-label="Kit">
          {KITS.map((k) => (
            <button
              key={k}
              type="button"
              className={`segmented__button${kit === k ? ' segmented__button--active' : ''}`}
              aria-pressed={kit === k}
              title={`${KIT_NAMES[k]}: ${KIT_OVERLAP[k]} bases of homology`}
              onClick={() => {
                setKit(k);
              }}
            >
              {KIT_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="panel__controls">
        {picker('Linearised vector', vectorId, setVectorId)}
        {picker('Insert from', templateId, setTemplateId)}
      </div>
      {template !== undefined && region === null ? (
        <p className="panel__note">
          Select the insert in {template.doc.name}: its own tab keeps its selection, so switch to
          it, select, and come back.
        </p>
      ) : design === null ? (
        <p className="panel__note">
          Choose the linearised vector and the tab to amplify the insert from, with the insert
          selected there. The primers get {KIT_OVERLAP[kit]} bases of the vector&rsquo;s ends on
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
                    title="Open the circle the amplicon and the vector would make"
                    onClick={() => {
                      if (design.product !== null) open(design.product);
                    }}
                  >
                    Open product
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
