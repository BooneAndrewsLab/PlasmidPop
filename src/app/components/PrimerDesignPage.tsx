import { useMemo } from 'react';

import {
  type Feature,
  type Range,
  type SeqDocument,
  featureExtent,
  formatSpan,
  isEmptyRange,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { type PrimerDesign } from './primerDesign';
import { PrimerSettings } from './PrimerSettings';

/**
 * How the target is being chosen (item 107). The target itself is always
 * the selection, so the map stays live: Feature is a second way of setting
 * it, and a click on the map takes over.
 */
type TargetMode = 'selection' | 'feature';

function sameRange(a: Range, b: Range): boolean {
  return a.start === b.start && a.end === b.end;
}

/** The feature whose extent the selection is, if it is one's: what the target line names. */
function featureAt(doc: SeqDocument, selection: Range): Feature | null {
  for (const f of doc.features.all()) {
    const extent = featureExtent(f);
    if (extent !== null && sameRange(extent, selection)) return f;
  }
  return null;
}

interface Props {
  readonly doc: SeqDocument;
  readonly design: PrimerDesign;
  /** The results are shown once a design was made. */
  readonly onDesigned: () => void;
  /** The last-design line's link. */
  readonly onResults: () => void;
}

/**
 * The workspace's Design page (item 107): the target chooser, the settings
 * as a closed disclosure, one primary button and the last-design line.
 */
export function PrimerDesignPage({ doc, design, onDesigned, onResults }: Props) {
  const { selection, primerCriteria, documentId } = useEditorState();
  const [mode, setMode] = useRemembered<TargetMode>('primers.targetMode', documentId, 'selection');
  const hasTarget = selection !== null && !isEmptyRange(selection);
  const feature = hasTarget ? featureAt(doc, selection) : null;
  const features = useMemo(
    () =>
      doc.features
        .all()
        .map((f) => ({ f, extent: featureExtent(f) }))
        .filter((x): x is { f: Feature; extent: Range } => x.extent !== null),
    [doc],
  );
  const { pairs, designedFor } = design;

  const chooser = (which: TargetMode, label: string, tip: string) => (
    <button
      type="button"
      className={`segmented__button${mode === which ? ' segmented__button--active' : ''}`}
      aria-pressed={mode === which}
      data-tip={tip}
      onClick={() => {
        setMode(which);
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="ws__target">
        <span className="ws__target-label" id="ws-target-label">
          Target
        </span>
        <div className="segmented segmented--small" role="group" aria-labelledby="ws-target-label">
          {chooser('selection', 'Selection', 'The current selection, live')}
          {chooser('feature', 'Feature', 'Pick a feature of this document')}
        </div>
        {mode === 'feature' && (
          <select
            className="panel__select ws__feature"
            aria-label="Feature to design for"
            value={feature?.id ?? ''}
            onChange={(e) => {
              const chosen = features.find((x) => x.f.id === e.target.value);
              if (chosen === undefined) return;
              editorStore.setSelection(chosen.extent);
              editorStore.revealPosition(chosen.extent.start);
            }}
          >
            <option value="">Choose a feature…</option>
            {features.map(({ f, extent }) => (
              <option key={f.id} value={f.id}>
                {f.name === '' ? f.type : f.name} · {formatSpan(extent, doc.length)}
              </option>
            ))}
          </select>
        )}
        <p className={`ws__target-value${hasTarget ? '' : ' ws__target-value--none'}`}>
          {hasTarget ? (
            <>
              {feature !== null && <span className="ws__feature-name">{feature.name} </span>}
              <span className="panel__mono">{formatSpan(selection, doc.length)}</span> ·{' '}
              {(selection.end - selection.start).toLocaleString()} bp
              {feature?.strand === 'reverse' ? ' · reverse strand' : ''}
            </>
          ) : (
            'Nothing selected. Select a region on the map or in the sequence, or pick a feature.'
          )}
        </p>
      </div>
      <PrimerSettings criteria={primerCriteria} />
      <div className="ws__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!hasTarget}
          aria-describedby={hasTarget ? undefined : 'ws-design-why'}
          data-tip="Design up to ten pairs for the target"
          onClick={() => {
            if (!hasTarget) return;
            design.design(selection);
            onDesigned();
          }}
        >
          Design primers
        </button>
        {!hasTarget && (
          <span className="ws__actions-why" id="ws-design-why">
            Select a region or pick a feature
          </span>
        )}
      </div>
      {pairs !== null && (
        <p className="ws__last">
          Last design · {pairs.length} {pairs.length === 1 ? 'pair' : 'pairs'} for {designedFor}{' '}
          <button type="button" className="link" onClick={onResults}>
            Results ›
          </button>
        </p>
      )}
    </>
  );
}
