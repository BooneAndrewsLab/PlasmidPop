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

export function FeatureList({ doc }: Props) {
  const { selection } = useEditorState();
  const features = doc.features.all();

  return (
    <aside className="features" aria-label="Features">
      <h2 className="features__title">
        Features <span className="features__count">{features.length}</span>
      </h2>
      {features.length === 0 ? (
        <p className="features__empty">This sequence has no annotated features.</p>
      ) : (
        <ul className="features__list">
          {features.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className={`feature-row${isSelected(f, selection) ? ' feature-row--selected' : ''}`}
                onClick={() => {
                  editorStore.selectFeature(f.id);
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
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
