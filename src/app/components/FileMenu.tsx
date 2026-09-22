import { analytics } from '../analytics';
import { type ReactNode } from 'react';

import { type SeqDocument, extractRange, isEmptyRange } from '@/core';
import { exportLinearSvg, exportMapSvg } from '@/view/svg';

import { EXAMPLES } from '../examples';
import { openExample } from '../openFile';
import { copyShareLink } from '../share';
import { downloadText, fileNameFor, serialize } from '../saveFile';
import { editDiffOf } from '../state/editDiff';
import { persistence } from '../state/persistence';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { useMenu } from './useMenu';

interface Props {
  readonly doc: SeqDocument;
  /** Opens the file picker (kept in the toolbar, which owns the fallback input). */
  readonly onOpenFile: () => void;
  /** Picks a file to compare this document with, the same way. */
  readonly onCompareFile: () => void;
}

interface ItemProps {
  readonly children: ReactNode;
  readonly shortcut?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

function Item({ children, shortcut, title, disabled, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <span>{children}</span>
      {shortcut !== undefined && <span className="menu__shortcut">{shortcut}</span>}
    </button>
  );
}

/** Every file-level action for the open document, behind one "File" button. */
export function FileMenu({ doc, onOpenFile, onCompareFile }: Props) {
  const {
    selection,
    derived,
    showComplement,
    showTranslations,
    seqBasesPerRow,
    numberComplement,
    colorBases,
  } = useEditorState();
  /**
   * The parts of the sequence view's format the export follows. The text
   * size is not one of them: the file keeps the export's own metric so it
   * comes out the same whatever the screen is set to.
   */
  const format = {
    showComplement,
    showTranslations,
    numberComplement,
    colorBases,
    ...(seqBasesPerRow === null ? {} : { basesPerRow: seqBasesPerRow }),
  };
  const { open, toggle, close, ref } = useMenu();
  const hasSelection = selection !== null && !isEmptyRange(selection);
  const example = EXAMPLES[0];

  const report = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };
  const stem = fileNameFor(doc, 'genbank').replace(/\.gb$/, '');
  /** Runs an export, showing why it could not be written rather than throwing. */
  const attempt = (fn: () => void): void => {
    try {
      fn();
    } catch (e: unknown) {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    }
  };
  const run = (fn: () => void): (() => void) => {
    return () => {
      close();
      fn();
    };
  };

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button"
        aria-label="File"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        File <span className="button__caret">▾</span>
      </button>
      {open && (
        <div className="menu__list menu__list--start" role="menu" aria-label="File">
          <Item
            title="Start an empty sequence to type or paste into"
            onClick={run(() => {
              editorStore.newDocument();
            })}
          >
            New
          </Item>
          <Item onClick={run(onOpenFile)}>Open file…</Item>
          {example !== undefined && (
            <Item
              onClick={run(() => {
                openExample(example);
              })}
            >
              Open example
            </Item>
          )}
          <div className="menu__separator" role="separator" />
          <Item
            shortcut="Ctrl+S"
            title={
              derived
                ? 'Write this copy out as a GenBank file, after a look at what changed'
                : 'Write this document out as a GenBank file'
            }
            onClick={run(() => {
              report(persistence.download());
            })}
          >
            Download GenBank…
          </Item>
          <Item
            shortcut="Alt+L"
            title="A link that carries this document inside it — nothing is uploaded"
            onClick={run(() => {
              report(copyShareLink(doc));
            })}
          >
            Copy share link
          </Item>
          <Item
            title="Show how this document differs from a file on disk. Neither is changed and nothing is opened."
            onClick={run(onCompareFile)}
          >
            Compare with…
          </Item>
          <div className="menu__separator" role="separator" />
          <Item
            onClick={run(() => {
              analytics.track('file', 'export', 'map-svg');
              downloadText(
                `${stem}_map.svg`,
                exportMapSvg(doc, { cutSites: editorStore.visibleCutSites() }),
              );
            })}
          >
            Export map as SVG
          </Item>
          <Item
            title="The sequence rows — ruler, strands, features — as a vector file"
            onClick={run(() => {
              analytics.track('file', 'export', 'sequence-svg');
              attempt(() => {
                downloadText(
                  `${stem}_sequence.svg`,
                  exportLinearSvg(doc, {
                    ...format,
                    cutSites: editorStore.visibleCutSites(),
                    edits: editDiffOf(editorStore.getState()),
                  }),
                );
              });
            })}
          >
            Export sequence view as SVG
          </Item>
          <Item
            disabled={!hasSelection}
            title="The rows holding the selection, with it highlighted"
            onClick={run(() => {
              if (selection === null) return;
              analytics.track('file', 'export', 'selection-svg');
              attempt(() => {
                downloadText(
                  `${stem}_selection.svg`,
                  exportLinearSvg(doc, {
                    ...format,
                    range: selection,
                    selection,
                    cutSites: editorStore.visibleCutSites(),
                    edits: editDiffOf(editorStore.getState()),
                  }),
                );
              });
            })}
          >
            Export selection view as SVG
          </Item>
          <Item
            onClick={run(() => {
              analytics.track('file', 'export', 'fasta');
              downloadText(fileNameFor(doc, 'fasta'), serialize(doc, 'fasta'));
            })}
          >
            Export sequence as FASTA
          </Item>
          <Item
            disabled={!hasSelection}
            onClick={run(() => {
              if (selection === null) return;
              analytics.track('file', 'export', 'selection-genbank');
              const sub = extractRange(doc, selection);
              downloadText(fileNameFor(sub, 'genbank'), serialize(sub, 'genbank'));
            })}
          >
            Export selection as GenBank
          </Item>
          <Item
            disabled={!hasSelection}
            onClick={run(() => {
              if (selection === null) return;
              analytics.track('file', 'export', 'selection-fasta');
              const sub = extractRange(doc, selection);
              downloadText(fileNameFor(sub, 'fasta'), serialize(sub, 'fasta'));
            })}
          >
            Export selection as FASTA
          </Item>
          <div className="menu__separator" role="separator" />
          <Item
            title="Go to the list of files stored in this browser (the open tabs stay open)"
            onClick={run(() => {
              editorStore.showFiles();
            })}
          >
            Show files
          </Item>
          <Item
            title="Close this tab (the document stays stored in this browser)"
            onClick={run(() => {
              editorStore.closeDocument();
            })}
          >
            Close
          </Item>
        </div>
      )}
    </div>
  );
}
