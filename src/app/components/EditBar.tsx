import { type SeqDocument, isEmptyRange } from '@/core';

import { deleteSelection } from '../editing';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

export function EditBar({ doc }: Props) {
  const { selection } = useEditorState();
  const hasRange = selection !== null && !isEmptyRange(selection);
  const hasCaret = selection !== null;

  return (
    <div className="editbar" role="toolbar" aria-label="Edit">
      <button
        type="button"
        className="button button--small"
        disabled={!hasRange}
        title="Annotate the selected bases as a new feature"
        onClick={() => {
          editorStore.addFeatureFromSelection();
        }}
      >
        Add feature
      </button>
      <button
        type="button"
        className="button button--small"
        disabled={!hasRange}
        onClick={() => {
          if (selection !== null) editorStore.applyPlan(deleteSelection(doc, selection));
        }}
      >
        Delete selection
      </button>
      <span className="editbar__divider" />
      <button
        type="button"
        className="button button--small"
        title="Reverse-complement the whole sequence; features follow"
        onClick={() => {
          editorStore.apply({ type: 'reverseComplement' });
        }}
      >
        Reverse complement
      </button>
      {doc.isCircular && (
        <button
          type="button"
          className="button button--small"
          disabled={!hasCaret}
          title="Make the base after the cursor (or the selection start) base 1"
          onClick={() => {
            if (selection !== null)
              editorStore.apply({ type: 'setOrigin', position: selection.start });
          }}
        >
          Set origin here
        </button>
      )}
      <button
        type="button"
        className="button button--small"
        title={doc.isCircular ? 'Treat the sequence as linear' : 'Treat the sequence as circular'}
        onClick={() => {
          editorStore.apply({
            type: 'setTopology',
            topology: doc.isCircular ? 'linear' : 'circular',
          });
        }}
      >
        {doc.isCircular ? 'Make linear' : 'Make circular'}
      </button>
      <button
        type="button"
        className="button button--small"
        title="Find bases or features (Ctrl+F)"
        onClick={() => {
          editorStore.setFindOpen(true);
        }}
      >
        Find
      </button>
      <span className="editbar__hint">
        Type bases to insert, Backspace to delete. Ctrl+C copies the selection with its features,
        Ctrl+V pastes.
      </span>
    </div>
  );
}
