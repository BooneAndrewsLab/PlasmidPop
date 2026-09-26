import { useEffect, useRef } from 'react';

import { type CaseMode, type Range, isEmptyRange } from '@/core';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useAltKey, useBindingLabel } from './useAltKey';
import { useMenu } from './useMenu';

const MODES: readonly (readonly [CaseMode, string, string])[] = [
  ['upper', 'UPPERCASE', 'Write the selected bases in capitals'],
  ['lower', 'lowercase', 'Write the selected bases in small letters'],
  ['toggle', 'tOGGLE cASE', 'Swap the case of each selected base'],
];

interface Props {
  readonly selection: Range | null;
  /** Which way the list opens; down, under the button, unless there is no room. */
  readonly opens?: 'up' | 'down';
  /** Whether this copy of the menu answers Alt+U; only one may. */
  readonly shortcut?: boolean;
}

/**
 * Upper, lower or swapped case for the selected bases (#90). The letters
 * change and the bases do not, so nothing else about the document moves,
 * and the edit marks see no change. Each choice is one undo step.
 */
export function CaseMenu({ selection, opens = 'down', shortcut = true }: Props) {
  const hasRange = selection !== null && !isEmptyRange(selection);
  const { open, toggle, close, ref } = useMenu();
  useEffect(() => {
    if (!hasRange) close();
  }, [hasRange, close]);
  // Alt+U ("upper") opens it with its first item focused.
  const focusFirst = useRef(false);
  const key = useBindingLabel('case-menu');
  useAltKey(
    'case-menu',
    shortcut
      ? () => {
          if (!hasRange) return;
          analytics.shortcut('alt+u');
          focusFirst.current = !open;
          toggle();
        }
      : null,
  );
  useEffect(() => {
    if (!open || !focusFirst.current) return;
    focusFirst.current = false;
    ref.current?.querySelector<HTMLElement>('[role="menu"] button')?.focus();
  }, [open, ref]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="button button--small"
        disabled={!hasRange}
        aria-keyshortcuts={shortcut ? key : undefined}
        title={`Upper, lower or swapped case for the selected bases${shortcut ? ` (${key})` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        Case <span className="button__caret">▾</span>
      </button>
      {open && hasRange && (
        <div
          className={`menu__list menu__list--start${opens === 'up' ? ' menu__list--up' : ''}`}
          role="menu"
          aria-label="Case of the bases"
        >
          {MODES.map(([mode, label, title]) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className="menu__item"
              title={title}
              onClick={() => {
                editorStore.apply({ type: 'changeCase', range: selection, mode }, selection);
                close();
              }}
            >
              <span className="case-menu__label">{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
