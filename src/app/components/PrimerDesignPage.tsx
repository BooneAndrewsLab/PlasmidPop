import { type ReactNode, useMemo } from 'react';

import {
  type Feature,
  type Range,
  type SeqDocument,
  featureExtent,
  formatSpan,
  isEmptyRange,
} from '@/core';

import { type DesignMode, type WorkspaceLayout } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CloningDesign } from './CloningDesign';
import { type CloningDesignState } from './cloningDesign';
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

/**
 * Selection / Feature: the two ways of setting the selection the target
 * (plain mode) or the vector region (cloning mode) follows. The feature
 * list sets the selection and reveals it; a later click on the map takes
 * over without the chooser having to be reset.
 */
function TargetChooser({ doc, label }: { readonly doc: SeqDocument; readonly label: string }) {
  const { selection, documentId } = useEditorState();
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
  const chooser = (which: TargetMode, text: string, tip: string) => (
    <button
      type="button"
      className={`segmented__button${mode === which ? ' segmented__button--active' : ''}`}
      aria-pressed={mode === which}
      data-tip={tip}
      onClick={() => {
        setMode(which);
      }}
    >
      {text}
    </button>
  );
  return (
    <>
      <div className="segmented segmented--small" role="group" aria-label={label}>
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
    </>
  );
}

interface Props {
  readonly doc: SeqDocument;
  readonly design: PrimerDesign;
  readonly cloning: CloningDesignState;
  readonly mode: DesignMode;
  readonly setMode: (mode: DesignMode) => void;
  readonly layout: WorkspaceLayout;
  /** The results are shown once a design was made. */
  readonly onDesigned: () => void;
  /** The last-design line's link. */
  readonly onResults: () => void;
}

/**
 * The workspace's Design page (item 107): the mode switch (#303), then in
 * the plain mode the target chooser, the settings as a closed disclosure,
 * one primary button and the last-design line; in the cloning mode the
 * four steps of `CloningDesign`.
 */
export function PrimerDesignPage({
  doc,
  design,
  cloning,
  mode,
  setMode,
  layout,
  onDesigned,
  onResults,
}: Props) {
  const { selection, primerCriteria } = useEditorState();
  const hasTarget = selection !== null && !isEmptyRange(selection);
  const feature = hasTarget ? featureAt(doc, selection) : null;
  const { pairs, designedFor } = design;

  const modeButton = (which: DesignMode, text: string, tip: string): ReactNode => (
    <button
      type="button"
      className={`segmented__button${mode === which ? ' segmented__button--active' : ''}`}
      aria-pressed={mode === which}
      data-tip={tip}
      onClick={() => {
        setMode(which);
      }}
    >
      {text}
    </button>
  );
  const switcher = (
    <div className="mode">
      <span className="ws__target-label" id="ws-mode-label">
        Mode
      </span>
      <div className="segmented segmented--small" role="group" aria-labelledby="ws-mode-label">
        {modeButton(
          'plain',
          'Primers on this sequence',
          'Design a pair that amplifies the selection, up to ten pairs',
        )}
        {modeButton(
          'cloning',
          'Clone an insert into this plasmid',
          'Design primers for an insert from another tab, with two restriction sites or a Golden Gate end on their tails',
        )}
      </div>
    </div>
  );

  if (mode === 'cloning') {
    return (
      <>
        {switcher}
        <CloningDesign
          doc={doc}
          cloning={cloning}
          layout={layout}
          chooser={<TargetChooser doc={doc} label="Where on the vector" />}
          onDesigned={onDesigned}
          onResults={onResults}
        />
      </>
    );
  }

  return (
    <>
      {switcher}
      <div className="ws__target">
        <span className="ws__target-label" id="ws-target-label">
          Target
        </span>
        <TargetChooser doc={doc} label="Target" />
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
