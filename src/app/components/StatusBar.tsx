import { useState } from 'react';

import { type SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument | null;
}

function describeSelection(doc: SeqDocument, selection: { start: number; end: number }): string {
  if (selection.start === selection.end) {
    return `Cursor after base ${selection.start.toLocaleString()}`;
  }
  const length = selection.end - selection.start;
  const from = selection.start + 1;
  const to = ((selection.end - 1) % doc.length) + 1;
  return `${length.toLocaleString()} bp selected, ${from.toLocaleString()} to ${to.toLocaleString()}`;
}

export function StatusBar({ doc }: Props) {
  const { selection, warnings, error, fileName } = useEditorState();
  const [showWarnings, setShowWarnings] = useState(false);

  return (
    <footer className="statusbar">
      {error !== null && (
        <div className="statusbar__error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              editorStore.dismissError();
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {showWarnings && warnings.length > 0 && (
        <ul className="statusbar__warnings">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.line === undefined ? '' : `Line ${w.line}: `}
              {w.message}
            </li>
          ))}
        </ul>
      )}
      <div className="statusbar__row">
        <span className="statusbar__selection">
          {doc === null
            ? 'No sequence open'
            : selection === null
              ? 'Nothing selected'
              : describeSelection(doc, selection)}
        </span>
        <span className="statusbar__spacer" />
        {warnings.length > 0 && (
          <button
            type="button"
            className="button button--quiet"
            aria-expanded={showWarnings}
            onClick={() => {
              setShowWarnings((v) => !v);
            }}
          >
            {warnings.length === 1 ? '1 warning' : `${warnings.length} warnings`} while opening
          </button>
        )}
        {fileName !== null && <span className="statusbar__file">{fileName}</span>}
      </div>
    </footer>
  );
}
