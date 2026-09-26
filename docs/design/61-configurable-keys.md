# 61. Configurable key bindings

Done, 2026-09-25 (#79; `src/app/keyBindings.ts`, `KeyBindings.tsx`,
**Format ▸ Keyboard shortcuts…**). Item 32 gave the app its `Alt` bindings
and ended by saying that making them configurable is a feature of its own
rather than one key more. This is that feature.

## One table

Until 1.8 a binding was written out wherever it was handled — in
`useViewShortcuts`, in each `useAltKey` caller — and again by hand in every
tooltip that named it and in the guide. That is fine while the keys are
fixed and comes apart the moment they are not, because a change has to reach
all three.

`KEY_ACTIONS` is now the one table, keyed by what the binding _does_
(`toggle-sidebar`, `format-menu`), with a label, a group, a default and how
it is reported in the usage statistics. The handlers ask it what key they
are on, the tooltips ask it what to print (`useBindingLabel`), the settings
dialog is drawn from it, and a test holds `docs/guide/14-shortcuts.md` to
naming every default.

- **A binding is its modifiers and the physical key code**, lower case, in a
  fixed order: `alt+KeyC`, `alt+shift+PageUp`. The code rather than the
  character for the reason item 32 gives: on macOS `Alt+C` arrives as `ç`.
  `bindingOf(event)` writes one, `matchesBinding` reads one, and
  `formatBinding` prints it the way the keyboard has it (`Alt+[`, `Alt+−`,
  `Ctrl+Shift+→`).
- **`resolveBindings`** puts the user's changes over the defaults. A change
  naming an action we no longer have, a fixed action or a binding that is
  not one is dropped: an old preference must never leave the app with a key
  that does nothing. Where a change takes a key another action still holds
  by default, the changed one keeps it and the other is left **unbound**
  rather than both firing — which the tests check both ways.

## What a key may be

`bindingProblem` refuses, in this order, and says why in a sentence:

- **no modifier** — in the sequence view every bare letter types a base, so
  an unmodified binding would type instead of doing what it says;
- **a modifier on its own**;
- **a key the browser keeps** (`Ctrl+T`, `Ctrl+W`, `Alt+D`, `Ctrl+Shift+I`
  and the rest): a shortcut the browser eats is one that does not work, and
  finding that out by pressing it is no way to learn it;
- **a key another action has**, named: "Alt+C is already complement."

Fixed: `Ctrl+S`, `Ctrl+F`, `Ctrl+Z` and `Ctrl+Shift+←`/`→`, which the rest
of the app and the platform already spend, and the ranges (`Alt+1`…`9`,
`Alt+Shift+PageUp`/`PageDown`), which are a span of keys rather than one.
They are listed all the same, marked `fixed`, because a list of shortcuts
that leaves out the ones people use most is not a list of shortcuts.

## Where they are kept and changed

With the view preferences (`ViewPrefs.keyBindings`, localStorage), as the
issue asked: only the changes, so a default that moves later moves for
everyone who has not chosen otherwise. The dialog is **Format ▸ Keyboard
shortcuts…**: one row per action, **Change** listens for the next key
(Escape gives up), **Default** puts one back and **All back to their
defaults** the lot. While it is up the app's own bindings stand down, so
pressing `Alt+S` there sets a key rather than closing the sidebar.

## Not done

- The sequence view's own editing keys (the arrows, `Backspace`, `Ctrl+C`)
  are not in the table: they are the platform's text-editing keys, and
  moving them would be surprising rather than useful.
- No import or export of a set of bindings, and no per-document sets.
