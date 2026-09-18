import { analytics } from '../analytics';
import { type ReactNode } from 'react';

import { type SeqDocument, extractRange, isEmptyRange } from '@/core';
import { exportMapSvg } from '@/view/svg';

import { EXAMPLES } from '../examples';
import { openText } from '../openFile';
import { downloadText, fileNameFor, serialize } from '../saveFile';
import { persistence, writeBackTarget } from '../state/persistence';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { useMenu } from './useMenu';

interface Props {
  readonly doc: SeqDocument;
  /** Opens the file picker (kept in the toolbar, which owns the fallback input). */
  readonly onOpenFile: () => void;
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
export function FileMenu({ doc, onOpenFile }: Props) {
  const { selection, fileHandle, fileName } = useEditorState();
  const { open, toggle, close, ref } = useMenu();
  const hasSelection = selection !== null && !isEmptyRange(selection);
  const example = EXAMPLES[0];
  // Where Save writes without asking; null when it will open a picker instead.
  const target = writeBackTarget(fileHandle, fileName);

  const report = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };
  const stem = fileNameFor(doc, 'genbank').replace(/\.gb$/, '');
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
                openText(example.text, example.fileName);
              })}
            >
              Open example
            </Item>
          )}
          <div className="menu__separator" role="separator" />
          <Item
            shortcut="Ctrl+S"
            title={
              target === null
                ? 'Save as a GenBank file'
                : 'Write the sequence back to the opened file'
            }
            onClick={run(() => {
              report(persistence.save());
            })}
          >
            {target === null ? 'Save…' : `Save to ${target}`}
          </Item>
          {target !== null && (
            // When Save itself asks where to write, one item is enough.
            <Item
              shortcut="Ctrl+Shift+S"
              title="Save a copy as GenBank"
              onClick={run(() => {
                report(persistence.saveAs());
              })}
            >
              Save as…
            </Item>
          )}
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
            title="Go to the list of files stored in this browser (this one stays there)"
            onClick={run(() => {
              editorStore.closeDocument();
            })}
          >
            Show files
          </Item>
        </div>
      )}
    </div>
  );
}
