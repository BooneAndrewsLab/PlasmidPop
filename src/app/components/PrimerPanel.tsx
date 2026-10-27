import { useEffect, useMemo, useRef } from 'react';

import { type Feature, type SeqDocument, featureExtent, formatSpan, isEmptyRange } from '@/core';

import { openPrimerWorkspace, takeFocusRequest } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { usePrimerCollection } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { ProbeBox } from './PrimerCheck';
import {
  goToSite,
  pct,
  siteSpan,
  tm,
  usePrimerDesign,
  usePrimerProbe,
  usePrimersPreview,
} from './primerDesign';

interface Props {
  readonly doc: SeqDocument;
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const DESIGN_BUTTON_ID = 'primers-design-open';

/** A `primer_bind` feature with where it lies, for the On this document list. */
function primerFeatures(
  doc: SeqDocument,
): readonly { readonly f: Feature; readonly start: number; readonly end: number }[] {
  const out: { f: Feature; start: number; end: number }[] = [];
  for (const f of doc.features.all()) {
    if (f.type !== 'primer_bind') continue;
    const extent = featureExtent(f);
    if (extent !== null) out.push({ f, start: extent.start, end: extent.end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The slim Primers tab (item 107): quick actions only. The selection with
 * "Design primers…", which opens the workspace; a quick check of a pasted
 * primer (Tm, where it binds); the primers already on this document; and
 * "My primers…". Settings, results and the full check live in the
 * workspace, so the panel is read at a glance.
 */
export function PrimerPanel({ doc }: Props) {
  const { selection, documentId } = useEditorState();
  const design = usePrimerDesign(doc);
  const probe = usePrimerProbe(doc);
  const collection = usePrimerCollection();
  usePrimersPreview(probe.preview);
  const designButton = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeFocusRequest()) designButton.current?.focus();
  }, []);

  const hasTarget = selection !== null && !isEmptyRange(selection);
  const onDocument = useMemo(() => primerFeatures(doc), [doc]);
  const { report, sites } = probe;
  const { pairs } = design;

  return (
    <div className="panel primers primers--slim">
      <fieldset className="panel__group">
        <legend>Selection</legend>
        <p className={`panel__note${hasTarget ? ' primers__target' : ''}`}>
          {hasTarget
            ? `${formatSpan(selection, doc.length)} · ${(selection.end - selection.start).toLocaleString()} bp`
            : 'Nothing selected'}
        </p>
        <button
          type="button"
          id={DESIGN_BUTTON_ID}
          ref={designButton}
          className="button button--primary primers__open"
          disabled={!hasTarget}
          data-tip="Open the primer workspace on this region"
          onClick={() => {
            openPrimerWorkspace(documentId, 'design');
          }}
        >
          Design primers…
        </button>
        {!hasTarget && (
          <p className="panel__note panel__note--quiet">Select a region or click a feature.</p>
        )}
        {pairs !== null && (
          <button
            type="button"
            className="link primers__last"
            data-tip="Open the last results"
            onClick={() => {
              openPrimerWorkspace(documentId, 'results');
            }}
          >
            Last design · {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} ›
          </button>
        )}
      </fieldset>

      <fieldset className="panel__group">
        <legend>Quick check</legend>
        <ProbeBox probe={probe} />
        {report !== null && report.length > 0 && (
          <>
            <p className="primers__stats primers__stats--slim">
              <span>{report.length} nt</span>
              <span>
                Tm{' '}
                {report.degenerate === 0
                  ? tm(report.tm)
                  : report.tmRange === null
                    ? '–'
                    : `${report.tmRange.min.toFixed(1)}–${report.tmRange.max.toFixed(1)} °C`}
              </span>
              <span>
                GC{' '}
                {report.degenerate === 0
                  ? pct(report.gc)
                  : `${pct(report.gcRange.min)}–${pct(report.gcRange.max)}`}
              </span>
              {report.gcClamp && <span className="primers__ok">clamp</span>}
            </p>
            {report.length >= 8 && sites.length === 0 && (
              <p className="panel__note panel__note--quiet">No binding site in this sequence.</p>
            )}
            {sites.length > 0 && (
              <ul className="primers__sites" aria-label="Binding sites">
                {sites.map((s) => (
                  <li key={`${s.strand}-${s.range.start}`}>
                    <button
                      type="button"
                      className="primers__site"
                      onClick={() => {
                        goToSite(s);
                      }}
                    >
                      <span className="primers__strand">{s.strand === 'forward' ? '→' : '←'}</span>
                      <span className="primers__pos">{siteSpan(s, doc.length)}</span>
                      <span className="primers__fit">
                        {s.mismatches === 0 ? 'exact' : `${s.mismatches} mm`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="link primers__more"
              data-tip="Warnings, dimers, Add sites, Save"
              onClick={() => {
                openPrimerWorkspace(documentId, 'check');
              }}
            >
              Full check ›
            </button>
          </>
        )}
      </fieldset>

      <fieldset className="panel__group">
        <legend>
          On this document
          <span className="panel__heading-note">{onDocument.length}</span>
        </legend>
        {onDocument.length === 0 ? (
          <p className="panel__note panel__note--quiet">No primer_bind features.</p>
        ) : (
          <ul className="primers__sites primers__sites--doc" aria-label="Primers on this document">
            {onDocument.map(({ f, start, end }) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="primers__site"
                  onClick={() => {
                    editorStore.setSelection({ start, end });
                    editorStore.revealPosition(start);
                  }}
                >
                  <span className="primers__strand">{f.strand === 'reverse' ? '←' : '→'}</span>
                  <span className="primers__name">{f.name === '' ? 'primer_bind' : f.name}</span>
                  <span className="primers__pos">{formatSpan({ start, end }, doc.length)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <button
        type="button"
        className="button primers__mine"
        data-tip="Open My primers in the workspace"
        onClick={() => {
          openPrimerWorkspace(documentId, 'mine');
        }}
      >
        My primers…
        {collection.status === 'ready' && (
          <span className="panel__heading-note">{collection.primers.length}</span>
        )}
      </button>
    </div>
  );
}
