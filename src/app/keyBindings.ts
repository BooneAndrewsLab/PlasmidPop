import { type Shortcut } from './analytics';

/**
 * Every key binding in one table (#79), and the rules for changing one.
 *
 * Until 1.8 the bindings were written out where they were handled — in
 * `useViewShortcuts`, in each `useAltKey` caller, in the sequence view — and
 * again by hand in the guide. That is fine while they are fixed and awkward
 * the moment they are not: a change has to reach the handler, every tooltip
 * and menu that names the key, and the guide. So there is one table, keyed
 * by what the binding *does*; the handlers ask it what key they are on, the
 * labels ask it what to print, and the user may put an action on another key.
 *
 * A binding is written as its modifiers and the physical key code, lower
 * case, in a fixed order: `alt+KeyC`, `alt+shift+PageUp`,
 * `ctrl+shift+ArrowLeft`. The code rather than the character because on
 * macOS `Alt` composes — `Alt+C` arrives as `ç` — and a shortcut that works
 * on one keyboard and not another is worse than none.
 */

export interface KeyAction {
  readonly id: string;
  /** What the settings page and the guide call it. */
  readonly label: string;
  /** Which part of the app it belongs to, for the listing. */
  readonly group: string;
  readonly defaultBinding: string;
  /**
   * How it is reported in the usage statistics; several actions may share
   * one (the nine document keys are one line).
   */
  readonly shortcut: Shortcut;
  /**
   * That the key cannot be changed: the ones the rest of the app and the
   * browser already spend (Ctrl+S, Ctrl+F, Ctrl+Z), and the ones that are a
   * range rather than a key (Alt+1..9).
   */
  readonly fixed?: boolean;
  /** A word on what it does where the label is not enough. */
  readonly note?: string;
}

/**
 * The bindings, in the order the guide lists them. Changing a default here
 * changes the handler, the tooltips and the guide together.
 */
export const KEY_ACTIONS: readonly KeyAction[] = [
  {
    id: 'toggle-complement',
    label: 'Complement',
    group: 'View',
    defaultBinding: 'alt+KeyC',
    shortcut: 'alt+c',
  },
  {
    id: 'toggle-translations',
    label: 'Translations',
    group: 'View',
    defaultBinding: 'alt+KeyT',
    shortcut: 'alt+t',
  },
  {
    id: 'toggle-cut-sites',
    label: 'Cut sites',
    group: 'View',
    defaultBinding: 'alt+KeyR',
    shortcut: 'alt+r',
  },
  {
    id: 'cycle-view',
    label: 'The next of the views: Sequence, Map, Both',
    group: 'View',
    defaultBinding: 'alt+KeyV',
    shortcut: 'alt+v',
  },
  {
    id: 'toggle-edits',
    label: 'Edit marks off, and back to the baseline chosen',
    group: 'View',
    defaultBinding: 'alt+KeyE',
    shortcut: 'alt+e',
  },
  {
    id: 'next-change',
    label: 'The next marked change (with Shift, the previous)',
    group: 'View',
    defaultBinding: 'alt+KeyN',
    shortcut: 'alt+n',
  },
  {
    id: 'toggle-sidebar',
    label: 'The sidebar, away and back',
    group: 'View',
    defaultBinding: 'alt+KeyS',
    shortcut: 'alt+s',
  },
  {
    id: 'sidebar-previous',
    label: 'The sidebar tab above',
    group: 'View',
    defaultBinding: 'alt+BracketLeft',
    shortcut: 'alt+bracket',
  },
  {
    id: 'sidebar-next',
    label: 'The sidebar tab below',
    group: 'View',
    defaultBinding: 'alt+BracketRight',
    shortcut: 'alt+bracket',
  },
  {
    id: 'text-larger',
    label: 'Larger text in the sequence view',
    group: 'View',
    defaultBinding: 'alt+Equal',
    shortcut: 'alt+size',
  },
  {
    id: 'text-smaller',
    label: 'Smaller text in the sequence view',
    group: 'View',
    defaultBinding: 'alt+Minus',
    shortcut: 'alt+size',
  },
  {
    id: 'format-menu',
    label: 'The Format menu',
    group: 'Menus',
    defaultBinding: 'alt+KeyO',
    shortcut: 'alt+o',
  },
  {
    id: 'case-menu',
    label: 'The Case menu',
    group: 'Menus',
    defaultBinding: 'alt+KeyU',
    shortcut: 'alt+u',
  },
  {
    id: 'style-menu',
    label: 'The Style menu',
    group: 'Menus',
    defaultBinding: 'alt+KeyY',
    shortcut: 'alt+y',
  },
  {
    id: 'compare-with',
    label: 'Compare with…',
    group: 'Menus',
    defaultBinding: 'alt+KeyK',
    shortcut: 'alt+k',
  },
  {
    id: 'share-link',
    label: 'Copy a share link',
    group: 'Document',
    defaultBinding: 'alt+KeyL',
    shortcut: 'alt+l',
  },
  {
    id: 'close-tab',
    label: 'Close the tab in front',
    group: 'Document',
    defaultBinding: 'alt+KeyW',
    shortcut: 'alt+w',
    note: 'Ctrl+W is the browser’s, and closes the app',
  },
  {
    id: 'bench',
    label: 'The Bench',
    group: 'Document',
    defaultBinding: 'alt+Digit0',
    shortcut: 'alt+digit',
  },
  {
    id: 'focus-splitter',
    label: 'The keyboard to the next boundary between panes',
    group: 'Document',
    defaultBinding: 'alt+KeyB',
    shortcut: 'alt+b',
  },
  {
    id: 'move-tab-left',
    label: 'Move the tab in front along the strip',
    group: 'Document',
    defaultBinding: 'alt+shift+PageUp',
    shortcut: 'alt+shift+page',
    fixed: true,
  },
  {
    id: 'move-tab-right',
    label: 'Move the tab in front the other way',
    group: 'Document',
    defaultBinding: 'alt+shift+PageDown',
    shortcut: 'alt+shift+page',
    fixed: true,
  },
  {
    id: 'nth-document',
    label: 'The nth open document, Alt+1 to Alt+9',
    group: 'Document',
    defaultBinding: 'alt+Digit1',
    shortcut: 'alt+digit',
    fixed: true,
    note: 'a range of keys rather than one',
  },
  {
    id: 'save',
    label: 'Download the document',
    group: 'Fixed',
    defaultBinding: 'ctrl+KeyS',
    shortcut: 'ctrl+s',
    fixed: true,
  },
  {
    id: 'find',
    label: 'Find',
    group: 'Fixed',
    defaultBinding: 'ctrl+KeyF',
    shortcut: 'ctrl+f',
    fixed: true,
  },
  {
    id: 'undo',
    label: 'Undo and redo',
    group: 'Fixed',
    defaultBinding: 'ctrl+KeyZ',
    shortcut: 'ctrl+z',
    fixed: true,
  },
  {
    id: 'select-codon',
    label: 'Extend the selection by a codon',
    group: 'Fixed',
    defaultBinding: 'ctrl+shift+ArrowRight',
    shortcut: 'ctrl+shift+arrow',
    fixed: true,
  },
];

const BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]));

export function keyAction(id: string): KeyAction | undefined {
  return BY_ID.get(id);
}

/** The binding a key event is, written as the table writes one. */
export function bindingOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.code);
  return parts.join('+');
}

/**
 * The same binding with Shift, for the pairs that go forwards and back: the
 * next marked change and the previous one are one binding and its Shift.
 */
export function withShift(binding: string): string {
  const parts = binding.split('+');
  const code = parts.pop() ?? '';
  return parts.includes('shift') ? binding : [...parts, 'shift', code].join('+');
}

/** Whether an event is exactly this binding. */
export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  return bindingOf(e) === binding;
}

/** `alt+KeyC` → `Alt+C`, `alt+shift+PageUp` → `Alt+Shift+Page Up`. */
export function formatBinding(binding: string): string {
  const parts = binding.split('+');
  const code = parts.pop() ?? '';
  const modifiers = parts.map((m) => m.charAt(0).toUpperCase() + m.slice(1));
  return [...modifiers, formatCode(code)].join('+');
}

function formatCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1] !== undefined) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit?.[1] !== undefined) return digit[1];
  const named: Readonly<Record<string, string>> = {
    BracketLeft: '[',
    BracketRight: ']',
    Equal: '=',
    Minus: '−',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Space: 'Space',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
  };
  return named[code] ?? code;
}

/**
 * Keys a binding may not take, and why. The browser's own come first: a
 * shortcut the browser eats is one that does not work, and finding that out
 * by pressing it is no way to learn it.
 */
const BROWSER_KEYS: ReadonlySet<string> = new Set([
  'ctrl+KeyT',
  'ctrl+KeyN',
  'ctrl+KeyW',
  'ctrl+KeyQ',
  'ctrl+KeyL',
  'ctrl+KeyP',
  'ctrl+KeyD',
  'ctrl+KeyJ',
  'ctrl+KeyH',
  'ctrl+KeyR',
  'ctrl+shift+KeyT',
  'ctrl+shift+KeyN',
  'ctrl+shift+KeyW',
  'ctrl+shift+KeyI',
  'alt+KeyD',
  'alt+ArrowLeft',
  'alt+ArrowRight',
  'alt+Home',
  'alt+F4',
  'ctrl+Tab',
  'ctrl+shift+Tab',
]);

/** What is wrong with putting `binding` on `action`, or null when nothing is. */
export function bindingProblem(
  binding: string,
  actionId: string,
  bindings: ReadonlyMap<string, string>,
): string | null {
  const parts = binding.split('+');
  const code = parts.pop() ?? '';
  if (code === '' || parts.length === 0) {
    // In the sequence view every bare letter types a base, so a binding
    // without a modifier would type instead of doing what it says.
    return 'A shortcut needs Alt or Ctrl: a key on its own types a base.';
  }
  if (['Alt', 'Control', 'Shift', 'Meta'].some((m) => code.startsWith(m))) {
    return 'That is a modifier on its own; hold it and press another key.';
  }
  if (BROWSER_KEYS.has(binding)) {
    return `${formatBinding(binding)} belongs to the browser, which would take it first.`;
  }
  for (const [other, taken] of bindings) {
    if (other === actionId || taken !== binding) continue;
    const label = keyAction(other)?.label ?? other;
    return `${formatBinding(binding)} is already ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
  }
  return null;
}

/**
 * What each action is bound to: the defaults, with the user's changes over
 * them. A change naming an action we no longer have, or a binding that is
 * not one, is dropped — an old preference must never leave the app with a
 * key that does nothing.
 */
export function resolveBindings(
  custom: Readonly<Record<string, string>> = {},
): Map<string, string> {
  const out = new Map(KEY_ACTIONS.map((a) => [a.id, a.defaultBinding]));
  for (const [id, binding] of Object.entries(custom)) {
    const action = keyAction(id);
    if (action === undefined || action.fixed === true) continue;
    if (typeof binding !== 'string' || binding.split('+').length < 2) continue;
    out.set(id, binding);
  }
  // A change may have taken a key another action still holds by default;
  // the one that was changed keeps it and the other is left unbound rather
  // than both firing.
  const seen = new Map<string, string>();
  for (const [id, binding] of out) {
    const holder = seen.get(binding);
    if (holder === undefined) {
      seen.set(binding, id);
      continue;
    }
    const changed = id in custom ? id : holder;
    const loser = changed === id ? holder : id;
    seen.set(binding, changed);
    out.delete(loser);
  }
  return out;
}
