import { useEffect, useRef, useState } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** The last topology chosen, for the next New in the same page load. */
let lastTopology: 'linear' | 'circular' = 'linear';

/**
 * New sequence (#6): the name and whether the molecule is circular, asked
 * before the empty document opens rather than fixed with a rename and a
 * Make circular afterwards. It is one Enter away from what New did before —
 * the name is selected, the topology is the last one chosen — so starting
 * to type a sequence costs a keystroke, not a detour.
 */
export function NewDocumentDialog() {
  const { newDialog } = useEditorState();
  // Mounted afresh each time it opens, so it starts from Untitled and the
  // last topology rather than from what was typed and cancelled last time.
  return newDialog ? <NewDocumentForm /> : null;
}

function NewDocumentForm() {
  const [name, setName] = useState('Untitled');
  const [topology, setTopology] = useState(lastTopology);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Selected, so typing a name replaces it and Enter keeps it.
    nameRef.current?.focus();
    nameRef.current?.select();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissNewDocument();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-document-title"
        onSubmit={(e) => {
          e.preventDefault();
          lastTopology = topology;
          editorStore.dismissNewDocument();
          editorStore.newDocument(topology, name);
        }}
      >
        <h2 id="new-document-title" className="dialog__title">
          New sequence
        </h2>
        <div className="dialog__body new-document">
          <label className="panel__field new-document__name">
            <span>Name</span>
            <input
              ref={nameRef}
              className="panel__search"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <div className="segmented" role="group" aria-label="Topology">
            {(['linear', 'circular'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`segmented__button${topology === t ? ' segmented__button--active' : ''}`}
                aria-pressed={topology === t}
                onClick={() => {
                  setTopology(t);
                }}
              >
                {t === 'linear' ? 'Linear' : 'Circular'}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              editorStore.dismissNewDocument();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
