import { type ChangeEvent, useRef, useState } from 'react';

import { type SeqDocument } from '@/core';

import { EXAMPLES } from '../examples';
import { openFile, openText } from '../openFile';
import { persistence } from '../state/persistence';
import { ExportMenu } from './ExportMenu';
import { HistoryMenu } from './HistoryMenu';
import { InlineRename } from './InlineRename';
import { Logo } from './Logo';
import { type ViewMode, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument | null;
}

export function Toolbar({ doc }: Props) {
  const { showComplement, view, dirty, fileHandle } = useEditorState();
  const report = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };
  const openViaPicker = (): void => {
    persistence
      .openWithPicker(openFile)
      .then((handled) => {
        if (!handled) inputRef.current?.click();
      })
      .catch((e: unknown) => {
        editorStore.fail(e instanceof Error ? e.message : String(e));
      });
  };
  const views: readonly [ViewMode, string][] = [
    ['sequence', 'Sequence'],
    ['map', 'Map'],
    ['both', 'Both'],
  ];
  const inputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file !== undefined) void openFile(file);
    e.target.value = '';
  };

  const example = EXAMPLES[0];

  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">
        <Logo />
      </h1>
      {doc !== null && (
        <div className="toolbar__doc">
          {renaming ? (
            <InlineRename
              value={doc.name}
              label="Document name"
              className="toolbar__rename"
              onCommit={(name) => {
                editorStore.apply({ type: 'rename', name });
              }}
              onDone={() => {
                setRenaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="toolbar__name"
              title={`${doc.metadata.description === '' ? '' : `${doc.metadata.description}\n`}Click to rename`}
              onClick={() => {
                setRenaming(true);
              }}
            >
              {doc.name}
              {dirty && (
                <span className="toolbar__dirty" title="Changes not yet saved to a file">
                  {' '}
                  •
                </span>
              )}
            </button>
          )}
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
        <HistoryMenu />
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
        <button type="button" className="button button--primary" onClick={openViaPicker}>
          Open file
        </button>
        {doc !== null && (
          <>
            <button
              type="button"
              className="button"
              title={
                fileHandle === null
                  ? 'Save as a GenBank file (Ctrl+S)'
                  : 'Save to the opened file (Ctrl+S)'
              }
              onClick={() => {
                report(persistence.save());
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="button"
              title="Save a copy as GenBank (Ctrl+Shift+S)"
              onClick={() => {
                report(persistence.saveAs());
              }}
            >
              Save as
            </button>
            <ExportMenu doc={doc} />
            <button
              type="button"
              className="button button--quiet"
              title="Go to the list of files stored in this browser (this one stays there)"
              onClick={() => {
                editorStore.closeDocument();
              }}
            >
              Show files
            </button>
          </>
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
