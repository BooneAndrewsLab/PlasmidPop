# 32. Key bindings for the things that were only ever a click away

Done,
2026-09-21. Five items had ended with the same footnote — the Cut sites
toggle (20), the Edits baseline (21), collapsing the sidebar (28),
switching document tabs (6) and the share link (11) — plus extending a
selection by codon (19). Separately each is a footnote; together they are
the difference between using the app with a pointer and using it while
working.

- They are all `Alt` and one key, which is not a style choice: in the
  sequence view every bare letter types a base, and `Ctrl` is spoken for
  by the browser and by editing, so `Alt` is the one modifier a document
  editor can spend. `isAltKey` (`src/app/keys.ts`) matches the physical
  `code`, because on macOS `Alt+C` arrives as `ç` and a shortcut that
  works on one keyboard and not another is worse than none.
  `useViewShortcuts` (`src/app/state/`) holds them; it does nothing while
  a modal is up or a text field has the key.
- `Alt+C`/`Alt+T`/`Alt+R` the three toolbar toggles, `Alt+E` the edit
  marks off and back to the baseline that was chosen (remembered in a
  ref, so it is the user's choice that returns), `Alt+S` the sidebar,
  `Alt+L` a share link, `Alt+1`..`Alt+9` the nth open document.
- **Selecting by codon** lives in the sequence view, where the CDS is:
  `Ctrl+Shift+←`/`→`, the first press taking the codon the caret is in as
  `Shift+Arrow` takes the base it is on, each press after that adding
  one. Along the row rather than along the protein, so a reverse-strand
  CDS extends leftwards — which is what dragging a translation line
  already did, since it follows the pointer. `CdsTranslations` is now
  built whether or not the Translations toggle is on: the keyboard needs
  the codons even when nothing is drawing them.
- Not yet: nothing for the view switcher, the Format menu or the sidebar
  tabs; no way to close a tab from the keyboard (`Ctrl+W` is the
  browser's); the bindings are fixed, not configurable.
