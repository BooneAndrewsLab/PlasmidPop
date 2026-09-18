import { useEffect, useRef, useState } from 'react';

import { type SeqDocument, extractRange, isEmptyRange } from '@/core';
import { exportMapSvg } from '@/view/svg';

import { downloadText, fileNameFor, serialize } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

export function ExportMenu({ doc }: Props) {
  const { selection } = useEditorState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasSelection = selection !== null && !isEmptyRange(selection);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => void): void => {
    setOpen(false);
    fn();
  };
  const stem = fileNameFor(doc, 'genbank').replace(/\.gb$/, '');

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Export
      </button>
      {open && (
        <div className="menu__list" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              run(() => {
                downloadText(
                  `${stem}_map.svg`,
                  exportMapSvg(doc, { cutSites: editorStore.visibleCutSites() }),
                );
              });
            }}
          >
            Map as SVG
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => {
              run(() => {
                downloadText(fileNameFor(doc, 'fasta'), serialize(doc, 'fasta'));
              });
            }}
          >
            Sequence as FASTA
          </button>
          <div className="menu__separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={!hasSelection}
            onClick={() => {
              run(() => {
                if (selection === null) return;
                const sub = extractRange(doc, selection);
                downloadText(fileNameFor(sub, 'genbank'), serialize(sub, 'genbank'));
              });
            }}
          >
            Selection as GenBank
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            disabled={!hasSelection}
            onClick={() => {
              run(() => {
                if (selection === null) return;
                const sub = extractRange(doc, selection);
                downloadText(fileNameFor(sub, 'fasta'), serialize(sub, 'fasta'));
              });
            }}
          >
            Selection as FASTA
          </button>
        </div>
      )}
    </div>
  );
}
