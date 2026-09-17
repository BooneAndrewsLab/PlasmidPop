import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { type Feature, type SeqDocument } from '@/core';
import { formatLocation } from '@/io';
import { featureColor } from '@/view/featureColors';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
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

export function FeatureList({ doc }: Props) {
  const { selection, renameRequest } = useEditorState();
  const features = doc.features.all();
  const renaming =
    renameRequest !== null && doc.features.has(renameRequest.id) ? renameRequest.id : null;

  return (
    <aside className="features" aria-label="Features">
      <h2 className="features__title">
        Features <span className="features__count">{features.length}</span>
      </h2>
      {features.length === 0 ? (
        <p className="features__empty">
          No features yet. Select some bases and choose Add feature.
        </p>
      ) : (
        <ul className="features__list">
          {features.map((f) => {
            const selected = isSelected(f, selection);
            return (
              <li key={f.id} className={`feature-item${selected ? ' feature-item--selected' : ''}`}>
                {renaming === f.id ? (
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
                    onDoubleClick={() => {
                      editorStore.requestRename(f.id);
                    }}
                  >
                    <span
                      className="feature-row__swatch"
                      style={{ background: featureColor(f) }}
                      aria-hidden="true"
                    />
                    <span className="feature-row__text">
                      <span className="feature-row__name">{f.name === '' ? f.type : f.name}</span>
                      <span className="feature-row__detail">
                        {f.name === '' ? null : <span>{f.type} </span>}
                        <span className="feature-row__location">
                          {formatLocation(f, doc.length, doc.topology)}
                        </span>
                      </span>
                    </span>
                  </button>
                )}
                {selected && renaming !== f.id && (
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
