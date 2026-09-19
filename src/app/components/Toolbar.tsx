import { type ChangeEvent, useRef, useState } from 'react';

import { type SeqDocument, describeEnds } from '@/core';

import { EXAMPLES } from '../examples';
import { openFile, openText } from '../openFile';
import { persistence } from '../state/persistence';
import { HelpButton } from '../help/HelpButton';
import { EditsMenu } from './EditsMenu';
import { FileMenu } from './FileMenu';
import { FormatMenu } from './FormatMenu';
import { HistoryMenu } from './HistoryMenu';
import { InlineRename } from './InlineRename';
import { Logo } from './Logo';
import { type ViewMode, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument | null;
}

const VIEWS: readonly [ViewMode, string][] = [
  ['sequence', 'Sequence'],
  ['map', 'Map'],
  ['both', 'Both'],
];

function segmentedClass(active: boolean): string {
  return `segmented__button${active ? ' segmented__button--active' : ''}`;
}

export function Toolbar({ doc }: Props) {
  const { showComplement, showTranslations, showCutSites, view, dirty } = useEditorState();
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
        {/* Logo as home: back to the file list, like a site's logo goes to its front page. */}
        <button
          type="button"
          className="toolbar__home"
          title={doc === null ? 'PlasmidPop' : 'Show files (the open tabs stay open)'}
          disabled={doc === null}
          onClick={() => {
            editorStore.showFiles();
          }}
        >
          <Logo />
        </button>
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
            {/* Only a molecule something has cut has ends worth naming. */}
            {doc.ends !== null && (
              <span title={`Ends: ${describeEnds(doc.ends)}`}> · {describeEnds(doc.ends)}</span>
            )}
          </span>
        </div>
      )}
      <div className="toolbar__actions">
        {doc === null ? (
          <div className="toolbar__group">
            <button
              type="button"
              className="button"
              title="Start an empty sequence to type or paste into"
              onClick={() => {
                editorStore.newDocument();
              }}
            >
              New
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
            <button type="button" className="button button--primary" onClick={openViaPicker}>
              Open file
            </button>
          </div>
        ) : (
          <>
            <FileMenu doc={doc} onOpenFile={openViaPicker} />
            <HistoryMenu />
            <div className="segmented" role="group" aria-label="View">
              {VIEWS.map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={segmentedClass(view === mode)}
                  aria-pressed={view === mode}
                  onClick={() => {
                    editorStore.setView(mode);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented toolbar__show" role="group" aria-label="Show">
              <button
                type="button"
                className={segmentedClass(showComplement)}
                aria-pressed={showComplement}
                title="Show the complement strand"
                onClick={() => {
                  editorStore.setShowComplement(!showComplement);
                }}
              >
                Complement
              </button>
              <button
                type="button"
                className={segmentedClass(showTranslations)}
                aria-pressed={showTranslations}
                title="Show amino acids under CDS features"
                onClick={() => {
                  editorStore.setShowTranslations(!showTranslations);
                }}
              >
                Translations
              </button>
              <button
                type="button"
                className={segmentedClass(showCutSites)}
                aria-pressed={showCutSites}
                title="Show cut sites of the enzymes ticked in the Enzymes tab; hiding them keeps the ticks"
                onClick={() => {
                  editorStore.setShowCutSites(!showCutSites);
                }}
              >
                Cut sites
              </button>
            </div>
            <FormatMenu />
            <EditsMenu />
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
      <HelpButton />
    </header>
  );
}
