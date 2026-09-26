import { useEffect, useState } from 'react';

import {
  type KeyAction,
  KEY_ACTIONS,
  bindingOf,
  bindingProblem,
  formatBinding,
  resolveBindings,
} from '../keyBindings';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * Format ▸ Keyboard shortcuts… (#79): the table as a dialog, so the keys
 * can be changed from where the rest of the view's settings are.
 */
export function KeyBindingsDialog() {
  const { keysDialog } = useEditorState();
  if (!keysDialog) return null;
  const close = (): void => {
    editorStore.showKeysDialog(false);
  };
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-title"
        onKeyDown={(e) => {
          // Escape closes the dialog, unless a row is waiting for a key:
          // there it is the way out of listening, which that handler takes.
          if (e.key === 'Escape' && !e.defaultPrevented) close();
        }}
      >
        <h2 id="keys-title" className="dialog__title">
          Keyboard shortcuts
        </h2>
        <KeyBindings />
        <div className="dialog__buttons">
          <button type="button" className="button button--primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** The groups in the order the table has them. */
function groupsOf(actions: readonly KeyAction[]): string[] {
  return [...new Set(actions.map((a) => a.group))];
}

/**
 * Changing a key binding (#79). One row per action, from the same table the
 * handlers and the tooltips read, so what is listed here is what the app
 * answers. **Change** waits for a key and takes it if it may: a binding
 * needs a modifier (a bare letter types a base in the sequence view), may
 * not be one the browser keeps, and may not be a key another action already
 * has. A few are fixed — Ctrl+S, Ctrl+F, Ctrl+Z and the ranges — and say so.
 */
export function KeyBindings() {
  const { keyBindings } = useEditorState();
  const bound = resolveBindings(keyBindings);
  const [listening, setListening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (listening === null) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        setProblem(null);
        return;
      }
      // A modifier on its own is the user still reaching for the key.
      if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;
      const id = listening;
      const binding = bindingOf(e);
      const wrong = bindingProblem(
        binding,
        id,
        resolveBindings(editorStore.getState().keyBindings),
      );
      if (wrong !== null) {
        setProblem(wrong);
        return;
      }
      editorStore.setKeyBinding(id, binding);
      setListening(null);
      setProblem(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [listening]);

  const changed = Object.keys(keyBindings).length > 0;
  return (
    <div className="keybindings">
      <p className="panel__note">
        Click <strong>Change</strong> and press the keys you want. A shortcut needs Alt or Ctrl: a
        key on its own types a base in the sequence view. Escape leaves it as it was.
      </p>
      {groupsOf(KEY_ACTIONS).map((group) => (
        <section key={group}>
          <h4 className="panel__heading">{group === 'Fixed' ? 'Fixed keys' : group}</h4>
          <ul className="keybindings__list" aria-label={`${group} shortcuts`}>
            {KEY_ACTIONS.filter((a) => a.group === group).map((action) => {
              const binding = bound.get(action.id);
              const waiting = listening === action.id;
              return (
                <li key={action.id} className="keybindings__row">
                  <span className="keybindings__label">
                    {action.label}
                    {action.note === undefined ? '' : ` — ${action.note}`}
                  </span>
                  <kbd className="keybindings__key">
                    {waiting
                      ? 'Press a key…'
                      : binding === undefined
                        ? 'unbound'
                        : formatBinding(binding)}
                  </kbd>
                  {action.fixed === true ? (
                    <span className="keybindings__fixed">fixed</span>
                  ) : (
                    <span className="keybindings__buttons">
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        aria-label={`Change the key for ${action.label}`}
                        onClick={() => {
                          setProblem(null);
                          setListening(waiting ? null : action.id);
                        }}
                      >
                        {waiting ? 'Cancel' : 'Change'}
                      </button>
                      {keyBindings[action.id] !== undefined && (
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          aria-label={`Put ${action.label} back on ${formatBinding(action.defaultBinding)}`}
                          onClick={() => {
                            editorStore.setKeyBinding(action.id, null);
                          }}
                        >
                          Default
                        </button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      <div className="panel__buttons">
        <button
          type="button"
          className="button button--small"
          disabled={!changed}
          onClick={() => {
            editorStore.resetKeyBindings();
            setListening(null);
            setProblem(null);
          }}
        >
          All back to their defaults
        </button>
      </div>
    </div>
  );
}
