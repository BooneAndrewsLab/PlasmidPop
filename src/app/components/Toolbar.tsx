import { type ChangeEvent, type RefObject, useRef, useState } from 'react';

import { type SeqDocument, describeEnds, formatLength, hasTool } from '@/core';

import { analytics } from '../analytics';
import { compareWithFile } from '../compare';
import { EXAMPLES } from '../examples';
import { SEQUENCE_FILE_ACCEPT, openExample, openFile } from '../openFile';
import { persistence } from '../state/persistence';
import { HelpButton } from '../help/HelpButton';
import { CompareChooser } from './CompareChooser';
import { EditsMenu } from './EditsMenu';
import { FileMenu } from './FileMenu';
import { FormatMenu } from './FormatMenu';
import { useAltKey } from './useAltKey';
import { HistoryMenu } from './HistoryMenu';
import { InlineRename } from './InlineRename';
import { Logo } from './Logo';
import { renameNote, topologyNote } from '../editsView';
import { useIdentityChange } from '../state/editDiff';
import { type ViewMode, editorStore, effectiveEditsBaseline } from '../state/editorStore';
import { PHONE_QUERY } from '../state/layout';
import { useEditorState } from '../state/useEditorStore';
import { useMediaQuery } from './useMediaQuery';

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
  const state = useEditorState();
  const { showComplement, showTranslations, showCutSites, view, dirty, front, documents } = state;
  // A rename or a change of topology marks no base, so the toolbar, where the
  // name and the shape are written, is where the edit marks say so (#31).
  const identity = useIdentityChange();
  const comparedName =
    effectiveEditsBaseline(state) === 'compared' ? (state.compared?.name ?? null) : null;
  const nameWas = identity?.nameWas ?? null;
  const topologyWas = identity?.topologyWas ?? null;
  const renamedNote = nameWas === null ? null : renameNote(nameWas, comparedName);
  const shapeNote = topologyWas === null ? null : topologyNote(topologyWas, comparedName);
  const inputRef = useRef<HTMLInputElement>(null);
  const compareRef = useRef<HTMLInputElement>(null);
  /** The picker where it exists, the hidden input where it does not. */
  const pickFile = (
    handle: (file: File) => Promise<unknown>,
    fallback: RefObject<HTMLInputElement | null>,
  ): void => {
    persistence
      .openWithPicker(handle)
      .then((handled) => {
        if (!handled) fallback.current?.click();
      })
      .catch((e: unknown) => {
        editorStore.fail(e instanceof Error ? e.message : String(e));
      });
  };
  const openViaPicker = (): void => {
    pickFile(openFile, inputRef);
  };
  const compareViaPicker = (): void => {
    pickFile(compareWithFile, compareRef);
  };
  // With another tab open there is a choice to make first (#37); with none,
  // the only thing to compare with is a file, and the picker is the question.
  const compare = (): void => {
    if (documents.length > 1) editorStore.requestComparison();
    else compareViaPicker();
  };
  // Alt+K: Compare with…, while there is a document to compare (#34).
  useAltKey(
    'KeyK',
    doc === null
      ? null
      : () => {
          analytics.shortcut('alt+k');
          compare();
        },
  );
  const [renaming, setRenaming] = useState(false);
  // A phone's toolbar is the name and the File menu. The view switcher is
  // the shell's own bar there, and the toggles, Format, Edits and History
  // are for editing, which a phone does not do.
  const phone = useMediaQuery(PHONE_QUERY);

  /** The hidden inputs' handler; `handle` is what to do with the file picked. */
  const onPick =
    (handle: (file: File) => Promise<unknown>) =>
    (e: ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0];
      if (file !== undefined) void handle(file);
      e.target.value = '';
    };

  const example = EXAMPLES[0];

  return (
    <header className="toolbar">
      <h1 className="toolbar__brand">
        {/* Logo as home: back to the file list, like a site's logo goes to its
            front page — from a document and from the Bench alike. On the file
            list it is still a live button, as a site's logo is on its own
            front page; there it simply stays put. */}
        <button
          type="button"
          className="toolbar__home"
          title={
            front === 'files' ? 'PlasmidPop: the file list' : 'Show files (the open tabs stay open)'
          }
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
              className={`toolbar__name${renamedNote === null ? '' : ' toolbar__name--changed'}`}
              title={`${renamedNote === null ? '' : `${renamedNote}\n`}${doc.metadata.description === '' ? '' : `${doc.metadata.description}\n`}Click to rename`}
              onClick={() => {
                setRenaming(true);
              }}
            >
              {doc.name}
              {dirty && (
                <span className="toolbar__dirty" title="Changed since the last download">
                  {' '}
                  •
                </span>
              )}
            </button>
          )}
          <span className="toolbar__meta">
            {formatLength(doc.length, doc.alphabet)},{' '}
            {shapeNote === null ? (
              doc.isProtein ? (
                'protein'
              ) : (
                doc.topology
              )
            ) : (
              <span className="toolbar__changed" title={shapeNote}>
                {doc.topology}
              </span>
            )}
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
            {/* On the Bench, Undo and Redo are the shelf's (item 49). */}
            {front === 'bench' && !phone && <HistoryMenu />}
            <button
              type="button"
              className="button"
              title="Start an empty sequence to type or paste into"
              onClick={() => {
                editorStore.requestNewDocument();
              }}
            >
              New
            </button>
            {example !== undefined && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  openExample(example);
                }}
              >
                Open example
              </button>
            )}
            <button
              type="button"
              className="button"
              title="Fetch GenBank or GenPept records by accession number. Only the accessions are sent, to NCBI."
              onClick={() => {
                editorStore.requestNcbi();
              }}
            >
              From NCBI…
            </button>
            <button type="button" className="button button--primary" onClick={openViaPicker}>
              Open file
            </button>
          </div>
        ) : phone ? (
          <FileMenu doc={doc} onOpenFile={openViaPicker} onCompare={compare} />
        ) : (
          <>
            <FileMenu doc={doc} onOpenFile={openViaPicker} onCompare={compare} />
            <HistoryMenu />
            {/* A protein has no map to show beside its residues (#66). */}
            {hasTool(doc, 'circular') && (
              <div
                className="segmented"
                role="group"
                aria-label="View"
                title="Alt+V steps through the three"
              >
                {VIEWS.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={segmentedClass(view === mode)}
                    aria-pressed={view === mode}
                    onClick={() => {
                      analytics.trackOnce('view', 'mode', mode);
                      editorStore.setView(mode);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* A protein has one strand, no CDS under it and no sites to cut (#66). */}
            {hasTool(doc, 'complement') && (
              <div className="segmented toolbar__show" role="group" aria-label="Show">
                <button
                  type="button"
                  className={segmentedClass(showComplement)}
                  aria-pressed={showComplement}
                  title="Show the complement strand (Alt+C)"
                  onClick={() => {
                    analytics.trackOnce('view', 'toggle', 'complement');
                    editorStore.setShowComplement(!showComplement);
                  }}
                >
                  Complement
                </button>
                <button
                  type="button"
                  className={segmentedClass(showTranslations)}
                  aria-pressed={showTranslations}
                  title="Show amino acids under CDS features (Alt+T)"
                  onClick={() => {
                    analytics.trackOnce('view', 'toggle', 'translations');
                    editorStore.setShowTranslations(!showTranslations);
                  }}
                >
                  Translations
                </button>
                <button
                  type="button"
                  className={segmentedClass(showCutSites)}
                  aria-pressed={showCutSites}
                  title="Show cut sites of the enzymes ticked in the Enzymes tab; hiding them keeps the ticks (Alt+R)"
                  onClick={() => {
                    analytics.trackOnce('view', 'toggle', 'cut-sites');
                    editorStore.setShowCutSites(!showCutSites);
                  }}
                >
                  Cut sites
                </button>
              </div>
            )}
            <FormatMenu />
            <EditsMenu />
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={SEQUENCE_FILE_ACCEPT}
          hidden
          onChange={onPick(openFile)}
        />
        <input
          ref={compareRef}
          type="file"
          accept={SEQUENCE_FILE_ACCEPT}
          aria-label="File to compare with"
          hidden
          onChange={onPick(compareWithFile)}
        />
        {doc !== null && <CompareChooser onPickFile={compareViaPicker} />}
      </div>
      <HelpButton />
    </header>
  );
}
