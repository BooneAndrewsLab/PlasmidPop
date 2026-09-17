import { type ChangeEvent, useRef } from 'react';

import { type SeqDocument } from '@/core';

import { EXAMPLES } from '../examples';
import { openFile, openText } from '../openFile';
import { saveDocument } from '../saveFile';
import { type ViewMode, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument | null;
}

export function Toolbar({ doc }: Props) {
  const { history, showComplement, view } = useEditorState();
  const views: readonly [ViewMode, string][] = [
    ['sequence', 'Sequence'],
    ['map', 'Map'],
    ['both', 'Both'],
  ];
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file !== undefined) void openFile(file);
    e.target.value = '';
  };

  const example = EXAMPLES[0];

  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">PlasmidPop</h1>
      {doc !== null && (
        <div className="toolbar__doc">
          <span className="toolbar__name" title={doc.metadata.description}>
            {doc.name}
          </span>
          <span className="toolbar__meta">
            {doc.length.toLocaleString()} bp, {doc.topology}
          </span>
        </div>
      )}
      <div className="toolbar__actions">
        {doc !== null && (
          <div className="segmented" role="group" aria-label="View">
            {views.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`segmented__button${view === mode ? ' segmented__button--active' : ''}`}
                aria-pressed={view === mode}
                onClick={() => {
                  editorStore.setView(mode);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {doc !== null && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={showComplement}
              onChange={(e) => {
                editorStore.setShowComplement(e.target.checked);
              }}
            />
            Complement strand
          </label>
        )}
        <button
          type="button"
          className="button"
          disabled={history?.canUndo !== true}
          title={history?.undoLabel === undefined ? 'Undo' : `Undo ${history.undoLabel}`}
          onClick={() => {
            editorStore.undo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          className="button"
          disabled={history?.canRedo !== true}
          title={history?.redoLabel === undefined ? 'Redo' : `Redo ${history.redoLabel}`}
          onClick={() => {
            editorStore.redo();
          }}
        >
          Redo
        </button>
        {example !== undefined && (
          <button
            type="button"
            className="button"
            onClick={() => {
              openText(example.text, example.fileName);
            }}
          >
            Open example
          </button>
        )}
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Open file
        </button>
        {doc !== null && (
          <button
            type="button"
            className="button"
            title="Download the sequence with its features as a GenBank file"
            onClick={() => {
              saveDocument(doc, 'genbank');
            }}
          >
            Save GenBank
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".gb,.gbk,.genbank,.gbff,.ape,.fa,.fasta,.fna,.seq,.txt,.dna"
          hidden
          onChange={onPick}
        />
      </div>
    </header>
  );
}
