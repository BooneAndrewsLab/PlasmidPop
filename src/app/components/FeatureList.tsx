import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import {
  type Feature,
  type SeqDocument,
  type TranslationProblem,
  formatLocation,
  isStaleTranslation,
  translationFor,
} from '@/core';
import { featureColor } from '@/view/featureColors';

import { editorStore } from '../state/editorStore';
import { useTranslationProblems } from '../state/translationProblems';
import { useEditorState } from '../state/useEditorStore';
import { describeTranslationProblem } from '../translationWarnings';
import { DetectFeaturesButton, DetectFeaturesPanel } from './DetectFeatures';
import { FeatureEditor } from './FeatureEditor';

interface Props {
  readonly doc: SeqDocument;
  /**
   * The phone reader's list: rows select, nothing renames, edits or removes.
   * A reader holding a shared plasmid is one stray tap on Remove from having
   * forked a working copy of it, which is an edit nobody made on purpose.
   */
  readonly reader?: boolean;
}

function isSelected(feature: Feature, selection: { start: number; end: number } | null): boolean {
  if (selection === null) return false;
  const first = feature.segments[0];
  const last = feature.segments[feature.segments.length - 1];
  if (first?.kind !== 'range' || last?.kind !== 'range') return false;
  return selection.start === first.start && selection.end === Math.max(last.end, first.end);
}

function RenameField({ feature }: { readonly feature: Feature }) {
  const [value, setValue] = useState(feature.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (): void => {
    const name = value.trim();
    if (name !== '' && name !== feature.name) {
      editorStore.apply({ type: 'updateFeature', id: feature.id, patch: { name } });
    }
    editorStore.finishRename();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') editorStore.finishRename();
  };

  return (
    <input
      ref={inputRef}
      className="feature-row__rename"
      aria-label="Feature name"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  );
}

/**
 * What is wrong with a coding feature's own claims, under its row when it is
 * selected, with the two ways out when the stored `/translation` is what an
 * edit left behind: rewrite it from the bases, or drop it (#2). Each is one
 * edit, so one undo puts it back.
 */
function TranslationNotice({
  doc,
  feature,
  problems,
}: {
  readonly doc: SeqDocument;
  readonly feature: Feature;
  readonly problems: readonly TranslationProblem[];
}) {
  const stale = problems.some(isStaleTranslation);
  const setTranslation = (value: string | null): void => {
    const others = feature.qualifiers.filter((q) => q.name !== 'translation');
    editorStore.apply({
      type: 'updateFeature',
      id: feature.id,
      patch: {
        qualifiers: value === null ? others : [...others, { name: 'translation', value }],
      },
    });
  };
  return (
    <div className="feature-item__notice" role="note">
      {problems.map((p, i) => (
        <p key={i}>
          <span aria-hidden="true">⚠ </span>
          {describeTranslationProblem(p).replace(/^./, (c) => c.toUpperCase())}
        </p>
      ))}
      {stale && (
        <div className="feature-item__actions">
          <button
            type="button"
            className="button button--quiet button--small"
            title="Replace the stored /translation with the protein these bases give"
            onClick={() => {
              setTranslation(translationFor(doc, feature));
            }}
          >
            Update /translation
          </button>
          <button
            type="button"
            className="button button--quiet button--small"
            title="Remove the stored /translation; the protein is still shown from the bases"
            onClick={() => {
              setTranslation(null);
            }}
          >
            Remove /translation
          </button>
        </div>
      )}
    </div>
  );
}

export function FeatureList({ doc, reader = false }: Props) {
  const translation = useTranslationProblems(doc);
  const { documentId, selection, selectedFeatureId, renameRequest, editingFeatureId } =
    useEditorState();
  const features = doc.features.all();
  const renaming =
    renameRequest !== null && doc.features.has(renameRequest.id) ? renameRequest.id : null;
  // A gene and the CDS inside it can cover exactly the same bases, so the
  // selection alone does not say which was clicked. When the store knows —
  // the selection came from a click on a feature, and that feature still
  // covers it — only that row is the selected one.
  const precise =
    selectedFeatureId !== null &&
    features.some((f) => f.id === selectedFeatureId && isSelected(f, selection))
      ? selectedFeatureId
      : null;
  const selectedId = precise ?? features.find((f) => isSelected(f, selection))?.id ?? null;

  // Selecting a feature somewhere else — a click on the map, a find — brings
  // its row into view, as does opening this tab with one already selected.
  // `nearest` leaves a row that is already on screen where it is.
  const selectedRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selectedId === null) return;
    const row = selectedRow.current;
    // Guarded because jsdom, where the app's tests run, has no scrollIntoView.
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <aside className="features" aria-label="Features">
      <div className="features__header">
        <h2 className="features__title">
          Features <span className="features__count">{features.length}</span>
        </h2>
        {!reader && documentId !== null && (
          <DetectFeaturesButton documentId={documentId} doc={doc} />
        )}
      </div>
      {!reader && documentId !== null && <DetectFeaturesPanel documentId={documentId} doc={doc} />}
      {features.length === 0 ? (
        <p className="features__empty">
          {reader
            ? 'No features yet. Select some bases and choose Add feature.'
            : 'No features yet. Select some bases and choose Add feature, or let Detect features find the common ones.'}
        </p>
      ) : (
        <ul className="features__list">
          {features.map((f) => {
            const selected = precise === null ? isSelected(f, selection) : f.id === precise;
            return (
              <li
                key={f.id}
                ref={f.id === selectedId ? selectedRow : undefined}
                className={`feature-item${selected ? ' feature-item--selected' : ''}`}
              >
                {!reader && renaming === f.id ? (
                  <div className="feature-row">
                    <span
                      className="feature-row__swatch"
                      style={{ background: featureColor(f) }}
                      aria-hidden="true"
                    />
                    <RenameField key={renameRequest?.nonce} feature={f} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="feature-row"
                    onClick={() => {
                      editorStore.selectFeature(f.id);
                    }}
                    onDoubleClick={
                      reader
                        ? undefined
                        : () => {
                            editorStore.requestRename(f.id);
                          }
                    }
                  >
                    <span
                      className="feature-row__swatch"
                      style={{ background: featureColor(f) }}
                      aria-hidden="true"
                    />
                    <span className="feature-row__text">
                      <span className="feature-row__name">
                        {f.name === '' ? f.type : f.name}
                        {translation.has(f.id) && (
                          <span
                            className="feature-row__warn"
                            title={(translation.get(f.id) ?? [])
                              .map(describeTranslationProblem)
                              .join('\n')}
                          >
                            {' '}
                            ⚠
                          </span>
                        )}
                      </span>
                      <span className="feature-row__detail">
                        {f.name === '' ? null : <span>{f.type} </span>}
                        <span className="feature-row__location">
                          {formatLocation(f, doc.length, doc.topology)}
                        </span>
                      </span>
                    </span>
                  </button>
                )}
                {!reader && editingFeatureId === f.id && (
                  <FeatureEditor key={f.id} doc={doc} feature={f} />
                )}
                {!reader && selected && editingFeatureId !== f.id && translation.has(f.id) && (
                  <TranslationNotice doc={doc} feature={f} problems={translation.get(f.id) ?? []} />
                )}
                {!reader && selected && renaming !== f.id && editingFeatureId !== f.id && (
                  <div className="feature-item__actions">
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={() => {
                        editorStore.requestRename(f.id);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={() => {
                        editorStore.editFeature(f.id);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      onClick={() => {
                        editorStore.apply({ type: 'removeFeature', id: f.id });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
