# 38. Usage statistics that can say what is not used

Done, 2026-09-23 (`src/app/analytics.ts`). The Matomo events of item 9 of
the build order covered file I/O and the simulations, about thirty call
sites fired from action handlers. That answers "how often is Gibson run"
and cannot answer "is anyone using the Translate tab": none of the sidebar
tabs, the view switcher, the toolbar toggles, the Format menu, Find, the
edits or the guide sent anything, so an unused feature and an untracked one
looked the same. Asked for: which features are used most and which not at
all — without snooping.

- **The catalogue is the point.** `EVENTS` lists every category and action
  the app may send, and `track` takes nothing else; a new call site that
  is not on the list does not type-check. Matomo only shows what it
  received, so "unused" is read as: on this list, absent from the Events
  report. The event name, where there is one, is a fixed label — a file
  format, a panel, a view, a key binding, a guide page id, the version.
- **Once per visit for the frequent things.** `trackOnce` sends an event the
  first time it happens in a page load. Edits, toggles, tab switches, Find,
  the Format options, guide pages and key bindings go through it; Matomo's
  _unique events_ then reads as "visits that used it", one person toggling
  the complement a hundred times counts once, and a visit sends a dozen
  requests rather than one per click. The rarer, deliberate actions
  (open, download, export, a simulation run) keep counting every time.
- **Counted where the user acts, not in the store.** Remembered view
  preferences are put back through the same setters a click uses, and
  panels switch the sidebar tab themselves after a reaction; counting in
  the setters would report every restore and every hand-off as use. So
  panel, view and Format events are sent by the buttons, and the Edits
  baseline event moved out of `setEditsBaseline` into the menu for the
  same reason (it had been counting every restored preference). Edits,
  undo, redo and Find are counted in the store, which only the user drives.
- **What is now sent:** `app` start (the version), layout (desktop/phone,
  as at load), display (browser tab or installed PWA); `panel` open
  (which sidebar tab); `view` mode, toggle, format (which option, not what
  it was set to); `find` open; `edit` by `EditOp` type, plus undo and redo
  — the list is exhaustive over `EditOp` by a `Record`, so a new kind of
  edit cannot be left out; `shortcut` use by binding (`alt+c`, `ctrl+f`,
  …), which says whether the key bindings of item 32 are found at all;
  `help` page; `file` open-failed, with the format guessed from the
  extension and reduced to the ones the app knows (`formatOfFileName`), so
  neither the error message nor a made-up extension can carry a file name.
- **Left out on purpose:** sequence length, feature and enzyme counts even
  as buckets, how long a computation took (it gives away the size), where
  an edit was or how long, heartbeat and time-on-page pings, heatmaps,
  click positions, session recording, and anything that follows a user
  from one visit to the next. Cookieless and Do-Not-Track as before; still
  no toggle (decided 2026-09-18). Nothing needs configuring in Matomo:
  plain events, no custom dimensions.
- **Reading it.** Behaviour ▸ Events, by category then action/name, with
  _unique events_ for the `trackOnce` ones. `app / start` gives the number
  of visits a release has had, which the rest can be put against.
