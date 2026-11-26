import { useEffect, useRef } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * The question a GenBank record that says linear but has features across the
 * end of its sequence puts to the user before it opens (#462, item 157). It
 * names the count and nothing else: no feature name, no sequence. Escape is
 * Cancel; the focus starts on the choice that keeps the features.
 */
export function TopologyDialog() {
  const { topologyPrompt } = useEditorState();
  const circularRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (topologyPrompt === null) return;
    circularRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.answerTopology('cancel');
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [topologyPrompt]);

  if (topologyPrompt === null) return null;
  const n = topologyPrompt.features;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topology-title"
        aria-describedby="topology-body"
      >
        <h2 id="topology-title" className="dialog__title">
          Open as circular or linear?
        </h2>
        <p id="topology-body" className="dialog__body">
          This file says linear, but {n.toLocaleString()}{' '}
          {n === 1 ? 'feature runs' : 'features run'} across the end of the sequence (they only make
          sense on a circular sequence).
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              editorStore.answerTopology('cancel');
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              editorStore.answerTopology('linear');
            }}
          >
            Linear, dropping {n === 1 ? 'it' : 'them'}
          </button>
          <button
            ref={circularRef}
            type="button"
            className="button button--primary"
            onClick={() => {
              editorStore.answerTopology('circular');
            }}
          >
            Circular, keeping {n === 1 ? 'it' : 'them'}
          </button>
        </div>
      </div>
    </div>
  );
}
