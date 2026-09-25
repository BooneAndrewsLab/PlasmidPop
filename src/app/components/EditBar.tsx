import { type SeqDocument, hasOverhang, hasTool, isEmptyRange, unitName } from '@/core';

import { deleteSelection } from '../editing';
import { BaseStyleMenu } from './BaseStyleMenu';
import { CaseMenu } from './CaseMenu';
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
        title={`Annotate the selected ${unitName(doc.alphabet, true)} as a new feature`}
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
      <BaseStyleMenu doc={doc} selection={selection} />
      <CaseMenu selection={selection} />
      <span className="editbar__divider" />
      {hasTool(doc, 'reverseComplement') && (
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
      )}
      {/* A protein is linear, and has one strand (#66). */}
      {hasTool(doc, 'circular') && (
        <>
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
            title={
              doc.isCircular ? 'Treat the sequence as linear' : 'Treat the sequence as circular'
            }
            onClick={() => {
              editorStore.apply({
                type: 'setTopology',
                topology: doc.isCircular ? 'linear' : 'circular',
              });
            }}
          >
            {doc.isCircular ? 'Make linear' : 'Make circular'}
          </button>
        </>
      )}
      {/* Only a sticky-ended linear molecule has anything to blunt (#8). */}
      {hasOverhang(doc.ends) && (
        <>
          <button
            type="button"
            className="button button--small"
            title="Klenow or T4 DNA polymerase: fill 5′ overhangs in, chew 3′ ones back"
            onClick={() => {
              editorStore.apply({ type: 'bluntEnds', method: 'fill' });
            }}
          >
            Blunt (fill in)
          </button>
          <button
            type="button"
            className="button button--small"
            title="Mung bean nuclease: remove every overhang, 5′ or 3′"
            onClick={() => {
              editorStore.apply({ type: 'bluntEnds', method: 'trim' });
            }}
          >
            Blunt (trim)
          </button>
        </>
      )}
      <button
        type="button"
        className="button button--small"
        title={`Find ${unitName(doc.alphabet, true)} or features (Ctrl+F)`}
        onClick={() => {
          editorStore.setFindOpen(true);
        }}
      >
        Find
      </button>
      <span className="editbar__hint">
        Type {unitName(doc.alphabet, true)} to insert, Backspace to delete. Ctrl+C copies the
        selection with its features, Ctrl+V pastes.
      </span>
    </div>
  );
}
