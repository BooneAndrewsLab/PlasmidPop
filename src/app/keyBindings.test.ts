import shortcutsPage from '../../docs/guide/14-shortcuts.md?raw';

import {
  KEY_ACTIONS,
  bindingOf,
  bindingProblem,
  formatBinding,
  keyAction,
  matchesBinding,
  resolveBindings,
} from './keyBindings';

/** A key event as the browser would send it. */
function press(code: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    code,
    key: code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

describe('the table of key bindings (#79)', () => {
  it('gives every action an id, a label and a default of its own', () => {
    const ids = new Set<string>();
    const bindings = new Map<string, string>();
    for (const action of KEY_ACTIONS) {
      expect(ids.has(action.id), action.id).toBe(false);
      ids.add(action.id);
      expect(action.label.length, action.id).toBeGreaterThan(0);
      expect(action.defaultBinding.split('+').length, action.id).toBeGreaterThan(1);
      // Two actions may not start on one key.
      const taken = bindings.get(action.defaultBinding);
      expect(taken, `${action.id} and ${taken ?? ''}`).toBeUndefined();
      bindings.set(action.defaultBinding, action.id);
    }
  });

  it('writes a binding as the key was pressed, and reads it back', () => {
    expect(bindingOf(press('KeyC', { altKey: true }))).toBe('alt+KeyC');
    expect(bindingOf(press('PageUp', { altKey: true, shiftKey: true }))).toBe('alt+shift+PageUp');
    expect(bindingOf(press('KeyZ', { ctrlKey: true }))).toBe('ctrl+KeyZ');
    expect(matchesBinding(press('KeyC', { altKey: true }), 'alt+KeyC')).toBe(true);
    // Another modifier is another binding, so Alt+Shift+C is not Alt+C.
    expect(matchesBinding(press('KeyC', { altKey: true, shiftKey: true }), 'alt+KeyC')).toBe(false);
  });

  it('prints a binding the way the keyboard has it', () => {
    expect(formatBinding('alt+KeyC')).toBe('Alt+C');
    expect(formatBinding('alt+Digit0')).toBe('Alt+0');
    expect(formatBinding('alt+BracketLeft')).toBe('Alt+[');
    expect(formatBinding('alt+shift+PageUp')).toBe('Alt+Shift+Page Up');
    expect(formatBinding('ctrl+shift+ArrowRight')).toBe('Ctrl+Shift+→');
  });
});

describe('what a binding may be', () => {
  const bound = resolveBindings();

  it('refuses a key with no modifier: a bare letter types a base', () => {
    expect(bindingProblem('KeyG', 'toggle-sidebar', bound)).toMatch(/needs Alt or Ctrl/);
    expect(bindingProblem('', 'toggle-sidebar', bound)).toMatch(/needs Alt or Ctrl/);
  });

  it('refuses a modifier pressed on its own', () => {
    expect(bindingProblem('alt+AltLeft', 'toggle-sidebar', bound)).toMatch(/modifier on its own/);
  });

  it('refuses a key the browser keeps, naming it', () => {
    expect(bindingProblem('ctrl+KeyT', 'toggle-sidebar', bound)).toMatch(
      /Ctrl\+T belongs to the browser/,
    );
    expect(bindingProblem('alt+KeyD', 'toggle-sidebar', bound)).toMatch(/belongs to the browser/);
  });

  it('refuses a key another action holds, and says which', () => {
    const complement = keyAction('toggle-complement');
    expect(bindingProblem(complement?.defaultBinding ?? '', 'toggle-sidebar', bound)).toBe(
      'Alt+C is already complement.',
    );
    // Its own key is not a conflict with itself.
    expect(bindingProblem('alt+KeyC', 'toggle-complement', bound)).toBeNull();
  });

  it('takes a free key', () => {
    expect(bindingProblem('alt+KeyG', 'toggle-sidebar', bound)).toBeNull();
    expect(bindingProblem('ctrl+alt+KeyG', 'toggle-sidebar', bound)).toBeNull();
  });
});

describe('resolveBindings', () => {
  it('is the defaults when nothing was changed', () => {
    const bound = resolveBindings();
    expect(bound.get('toggle-sidebar')).toBe('alt+KeyS');
    expect(bound.size).toBe(KEY_ACTIONS.length);
  });

  it('puts a change over its default', () => {
    const bound = resolveBindings({ 'toggle-sidebar': 'alt+KeyG' });
    expect(bound.get('toggle-sidebar')).toBe('alt+KeyG');
    expect(bound.get('toggle-complement')).toBe('alt+KeyC');
  });

  it('drops a change that is not one, or that names an action or a key we do not have', () => {
    const bound = resolveBindings({
      'toggle-sidebar': 'KeyG', // no modifier
      'no-such-action': 'alt+KeyG',
      undo: 'alt+KeyG', // fixed
    });
    expect(bound.get('toggle-sidebar')).toBe('alt+KeyS');
    expect(bound.has('no-such-action')).toBe(false);
    expect(bound.get('undo')).toBe('ctrl+KeyZ');
  });

  it('leaves the other action unbound when a change takes its key', () => {
    // The sidebar moved onto the complement's key: the complement is left
    // without one rather than both firing.
    const bound = resolveBindings({ 'toggle-sidebar': 'alt+KeyC' });
    expect(bound.get('toggle-sidebar')).toBe('alt+KeyC');
    expect(bound.has('toggle-complement')).toBe(false);
  });
});

describe('the shortcuts page', () => {
  it('names every binding of the table, with the key it is on', () => {
    // The page writes a key name as one word (`Alt+Shift+PageUp`), the
    // settings page with the space the keyboard has; neither is wrong, so
    // the spaces are ignored here.
    const page = shortcutsPage.replace(/ /g, '');
    for (const action of KEY_ACTIONS) {
      const key = formatBinding(action.defaultBinding);
      // Alt+1..9 and the ranges are written as ranges on the page.
      const written = (action.id === 'nth-document' ? 'Alt+1' : key).replace(/ /g, '');
      expect(page, `${action.id} (${key})`).toContain(written);
    }
  });

  it('says where the keys can be changed', () => {
    expect(shortcutsPage).toMatch(/Keyboard shortcuts…/);
  });
});
