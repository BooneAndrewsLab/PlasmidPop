import { useState } from 'react';

import { type SeqDocument, hasOverhang, hasTool, isEmptyRange, unitName } from '@/core';

import { deleteSelection } from '../editing';
import { BaseStyleMenu } from './BaseStyleMenu';
import { CaseMenu } from './CaseMenu';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

function FindIcon() {
  return (
    <svg className="editbar__icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10 10l4.5 4.5" />
    </svg>
  );
}

function BinIcon() {
  return (
    <svg className="editbar__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" />
    </svg>
  );
}

interface Props {
  readonly doc: SeqDocument;
}

export function EditBar({ doc }: Props) {
  const { selection } = useEditorState();
  const hasRange = selection !== null && !isEmptyRange(selection);
  const hasCaret = selection !== null;
  // The less-used controls sit behind More on a narrow bar (container query
  // in styles.css); on a wide one the group is not there to see (#292).
  const [more, setMore] = useState(false);

  return (
    <div className="editbar" role="toolbar" aria-label="Edit">
      <button
        type="button"
        className="button button--small"
        disabled={!hasRange}
        data-tip={`Annotate the selected ${unitName(doc.alphabet, true)} as a new feature`}
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
        aria-label="Delete selection"
        data-tip="Delete selection"
        onClick={() => {
          if (selection !== null) editorStore.applyPlan(deleteSelection(doc, selection));
        }}
      >
        <BinIcon />
      </button>
      <span className="editbar__divider" />
      {hasTool(doc, 'reverseComplement') && (
        <button
          type="button"
          className="button button--small"
          data-tip="Reverse-complement the whole sequence; features follow"
          onClick={() => {
            editorStore.apply({ type: 'reverseComplement' });
          }}
        >
          Reverse complement
        </button>
      )}
      {/* Only a sticky-ended linear molecule has anything to blunt (#8). */}
      {hasOverhang(doc.ends) && (
        <>
          <button
            type="button"
            className="button button--small"
            data-tip="Klenow or T4 DNA polymerase: fill 5′ overhangs in, chew 3′ ones back"
            onClick={() => {
              editorStore.apply({ type: 'bluntEnds', method: 'fill' });
            }}
          >
            Blunt (fill in)
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip="Mung bean nuclease: remove every overhang, 5′ or 3′"
            onClick={() => {
              editorStore.apply({ type: 'bluntEnds', method: 'trim' });
            }}
          >
            Blunt (trim)
          </button>
        </>
      )}
      <div className={`editbar__more${more ? ' editbar__more--open' : ''}`}>
        <button
          type="button"
          className="button button--small editbar__more-toggle"
          aria-haspopup="true"
          aria-expanded={more}
          onClick={() => {
            setMore(!more);
          }}
        >
          More <span className="button__caret">▾</span>
        </button>
        <div className="editbar__more-items">
          <BaseStyleMenu doc={doc} selection={selection} />
          <CaseMenu selection={selection} />
          {/* A protein is linear, and has one strand (#66). */}
          {hasTool(doc, 'circular') && (
            <>
              {doc.isCircular && (
                <button
                  type="button"
                  className="button button--small"
                  disabled={!hasCaret}
                  data-tip="Make the base after the cursor (or the selection start) base 1"
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
                data-tip={
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
        </div>
      </div>
      <button
        type="button"
        className="button button--small"
        aria-label="Find…"
        data-tip={`Find ${unitName(doc.alphabet, true)} or features (Ctrl+F)`}
        onClick={() => {
          editorStore.setFindOpen(true);
        }}
      >
        <FindIcon />
      </button>
      <span
        className="editbar__hint"
        data-tip={`Type ${unitName(doc.alphabet, true)} to insert, Backspace to delete. Ctrl+C copies the selection with its features, Ctrl+V pastes.`}
      >
        Insert {unitName(doc.alphabet, true)}…
      </span>
    </div>
  );
}
