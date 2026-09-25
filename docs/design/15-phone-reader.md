# 15. Mobile-friendly layout

Done, 2026-09-22, as a **reader**, not a
smaller editor. The question asked first was who holds the phone and why,
and the answer shaped everything: someone opened a link a colleague sent
(item 11 made that inevitable — plasmids now travel in chat messages, and
messages are read on phones), someone at the bench or the freezer wants a
list (which enzyme cuts once, what are the fragments), or someone is
showing a map to a colleague. Nobody designs a primer or types a base on a
phone. So the target was "a share link reads well on a phone", and the
centre of gravity moved from the map to the list.

- **`PhoneShell`** (`src/app/components/`) at `PHONE_QUERY` (600 px,
  `layout.ts`): one pane at a time — **Map**, **Sequence**, **Details** —
  behind a bar of three 48 px tabs at the foot of the screen, with the
  safe-area inset under it. Details is the Features and Enzymes panels
  alone (`SidebarPanel`, lifted out of `Sidebar` for it), on the store's
  own `sidebarTab` so a tab any other code opens is honoured, falling back
  to Features from one the phone has not got. The pane is local state,
  starting on the map, because that is what a link is opened to see; it is
  not a view preference. Tapping a row in a list bumps `reveal`, and on a
  phone the view is on another pane, so the shell answers a reveal raised
  while on Details by going to the view pane last looked at; a reveal from
  a view itself changes nothing, and the nonce present at mount is never
  answered.
- **The toolbar is the name, the size and shape, and the File menu.** The
  view switcher is the shell's bar; the toggles, Format, Edits and History
  are for editing. `.toolbar__meta`, hidden at 720 px to make room for the
  toggles, comes back at 600 px because the toggles have gone and "4,361
  bp, circular" is the first thing a reader wants. No splitters; the
  sidebar's 200 px row of the stacked layout is overridden away.
- **Touch is a tap, not a drag**, decided by `pointerType` rather than by
  screen size, so a tablet in the desktop layout gets the same. On the
  sequence view a finger down decides nothing — the browser owns the drag
  (`touch-action: pan-x pan-y pinch-zoom`) and the view acts on the tap at
  `pointerup` if the finger lifted within `TOUCH_SLOP` (10 px); a scroll
  arrives as a `pointercancel` or an up elsewhere and is left alone. The
  press itself is the same `press()` a mouse takes, so a tap on a feature
  bar selects the feature and one on the bases places the caret. On the
  map a finger drag was already a pan or a pinch (`touch-action: none`);
  what was missing was hover. **A tap on a feature sets the hover** to it,
  and `onPointerLeave` — which fires the moment a finger lifts — leaves a
  touch hover alone, so the tapped feature's label comes back if the ring
  dropped it and stays until the next tap. That is item 29's recovery for
  dropped labels, made to work without a pointer that rests.
- **The reader shows the bases alone**: `LinearSequenceView`'s `reader`
  prop applies neither the Complement nor the Translations toggle, since
  each adds a line to every row and a phone has the height for neither.
  The stored preferences are untouched. Cut sites were left to the toggle
  (until #43, below):
  they rank below features in the label layout, so they cost the features
  nothing (measured: pBR322 at 390×600 draws 24 feature labels with no cut
  sites and 24 with 35), and the Enzymes tab's own "Show cut sites" link
  still works.
- **Measured** in `labelCollisions.test.ts`, which now has a 390×600 case:
  pBR322 with every feature named draws 24 and drops 32 at zoom 1 (34 and
  22 at 900×700), 31 and 60 with 35 cut sites; the 13.8 kb construct draws
  30 and drops 26. 0 collisions, leaders ≤ 54 px, 1–5 ms. Those drop
  counts are the argument for item 29's second label ring and item 31's
  spreading a crowd about its centre: a phone is where they would pay.
- **`@media (pointer: coarse)`** grows the things a finger lands on:
  buttons and segmented buttons to 36 px, document tabs and their × to
  36/28 px, the map's zoom buttons, the sidebar's tabs to 40 px.
- A **notice** under the toolbar says once that this is the reader and
  editing works best on a larger screen, with **Got it** remembered in
  `localStorage` — without it the missing toolbar reads as broken. The
  guide's "On a phone" section (`03-viewing.md`) says the rest.
- **The first look on a real phone found a map bug** (2026-09-22): the
  name in the centre of the ring was drawn as a squeezed script.
  `drawCentre` handed `fillText` its `maxWidth`, which condenses the
  glyphs sideways rather than doing anything readable (and the SVG export
  did the same through `lengthAdjust="spacingAndGlyphs"`); with four
  lanes of features inside a 390 px ring there are ~40 px in the middle.
  `fitTitle` now steps the title font down to `MIN_TITLE_PX` (11) and past
  that the name is **left out**, not shortened — the first cut ellipsized
  it, and "SYN…" says nothing the toolbar's name does not, on a phone or on
  a desktop map dragged narrow (which squished the same way). The length
  is whole or absent too, and takes the middle when the name has gone.
  Nothing on the map passes a `maxWidth` any more. Tested through the SVG:
  "pBR322" stays at 15 px, "pLenti-CMV-EGFP1" steps down whole, "SYNPBR322
  copy" at a phone's size draws nothing, and no `textLength` is written.
- **Not done from here: tested on a real device**, which the item asked
  for and which a jsdom test cannot stand in for. Also not yet: whether the
  messaging apps people actually use pass a 10 k-character URL fragment
  intact (Slack and email do; some SMS apps rewrite long links), which
  decides whether the link case is real. The rest of this list — long-press
  selection, a Web Share Target, hiding cut sites by default and
  remembering the pane — was built for #43, below; none of it has been on a
  real phone yet either.

## Follow-ups (#43, 2026-09-25)

Four of the "not yet" list above, built for 1.6.

- **Long-press to select** (`LinearSequenceView`). A finger that rests for
  `LONG_PRESS_MS` (500 ms, the top of Android's own long-press range, so
  a slow start to a scroll is not taken for a selection) without leaving
  `TOUCH_SLOP` selects the base under it; dragging then extends the
  selection base by base, the anchor base always included, and holding
  within 40 px of the top or bottom edge scrolls on a frame at a time,
  since a stretch can be longer than the screen and the finger cannot
  scroll while it selects. Lifting offers **Copy _n_ bp** in a pill over
  where the finger let go; it copies the bases as plain text through the
  async clipboard (`copyFragment`, which also sets the last-copied
  memory, so a paste back into the same tab keeps the features — the
  async clipboard takes no custom types). The offer goes with any other
  selection and after "Copied".
  The gesture fight the first attempt was warned about is settled by
  _when_ the view takes the drag, not by `touch-action`: that is read at
  `touchstart`, so changing it once the press has fired would change the
  next gesture, not this one. Instead a non-passive `touchmove` listener,
  added by hand because React's touch listeners are passive, cancels the
  move once — and only once — a long press has fired; before that a drag
  is exactly the scroll it was, and a scroll's `pointercancel` or its first
  move past the slop cancels the timer. `contextmenu` is prevented while a
  finger is down (Android answers a long press with one) and the canvas
  has `user-select: none` and `-webkit-touch-callout: none`. Decided by
  `pointerType`, like the tap, so a tablet has it too. Tested in jsdom
  with fake timers: the timer, the slop, the scroll that started first,
  the cancelled `touchmove` before and after, the offer and the copy.
  Counted as `phone / long-press-copy` when the button is used.
- **Web Share Target** (`src/pwa/shareTarget.ts`, `src/app/sharedFiles.ts`),
  so a GenBank attachment opens from a phone's mail app. The manifest's
  `share_target` POSTs `multipart/form-data` to `share-target` under the
  base path, with one `files` field accepting every extension `openFile`
  reads and their MIME types — plus `text/plain`, `application/octet-stream`
  and gzip, because that is how mail apps label a `.gb` as often as not; the
  app decides by name and content, as File ▸ Open does. A static site cannot
  take a POST, so the **service worker** does, and it stays on the device:
  it stashes the files in Cache Storage (`plasmidpop-share-target`, one
  entry per file, the name in a header) and answers 303 to
  `<scope>?share-target=<count>` (`failed` if the form could not be read,
  so the app says so rather than open to nothing). On start
  `useRestoreSession` takes the marker off the address bar synchronously,
  like the share fragment, and after the session and any share link opens
  the files in order through `openFile` — the same path as File ▸ Open, the
  same failure messages — then deletes the stash whether or not they read,
  so nothing opens twice. Cache Storage over IndexedDB because both halves
  already have it and a `Response` keeps a `File`'s bytes and type as they
  are. **The least change to the build:** it stays `generateSW`. Workbox
  takes a route handler as a function and writes its source into `sw.js`,
  so `isShareTargetRequest` and `handleShareTarget` are ordinary TypeScript,
  imported into `vite.config.ts` and unit-tested as functions, with the one
  constraint that each stands alone (no imports, no module references);
  a test checks the names spelled inside them against the constants the
  app reads with. Switching to `injectManifest` would have meant owning the
  precache and navigation routes too. Supported where Web Share Target is:
  Android Chrome (and other Chromium browsers there) with the app
  installed; not iOS Safari, not desktops. Counted as `phone /
share-target-open`, once per share; each file's `file / open` gives its
  format. Verified from the build (the manifest block and the route in
  `dist/sw.js` under `BASE_PATH=/PlasmidPop/`) and by tests of both halves
  against an in-memory Cache Storage, not yet on a phone.
- **The pane is remembered** per document: `phonePane` in `DocumentState`,
  beside `sidebarTab` and for the same reason (a tab is a piece of work),
  set by the shell's bar through `setPhonePane`. That undoes the note above
  that it was deliberately local state: the reason given, that a link is
  opened to see the map, is about how a document _starts_, and it still
  starts there — every `openDocument` without a stored id (a file, a share
  link, a paste, a Bench product) gets `'map'`. What was lost was the second
  look: switch to another tab and back, and the reader was on the map again.
  **Across a reload** the panes go with the view preferences as
  `phonePanes`, id → pane, since a reload reopens every tab under the id it
  is stored under; only panes other than the map are written, no more than
  `MAX_REMEMBERED_PANES` (20), and on read an entry keeps only real panes
  under plausible ids. A stored pane is handed to its document only when
  that is reopened from local storage under that id (`restorePhonePanes`,
  taken once), so a share link opened on top of a restored session still
  opens on the map, and a pane still waiting for its tab is written back
  until it is used. Not kept in the Dexie record: it is a view of the
  document, not part of it, and would have made a pane change an autosave.
  The shell's "last view" for a reveal from Details starts from the stored
  pane, so a tab brought back on Details answers a reveal with the map.
- **Cut sites hidden by default on a phone.** A preference of the phone's
  own rather than a different default for the one there was: the store
  keeps `desktopShowCutSites` (stored as `showCutSites`, as before) and
  `phoneShowCutSites` (off until chosen), `App` tells it which layout is on
  screen (`setPhoneLayout`, in a layout effect so the first phone frame is
  drawn without sites), and `EditorState.showCutSites` — what every view,
  export and panel already reads — is the one in effect. `setShowCutSites`
  changes the one on screen, so the Enzymes tab's **Show cut sites** link
  on a phone shows them there and is remembered there, and the desktop's
  toggle never finds its choice changed by a phone, nor the other way; the
  stored values are put back by name. The alternative, applying "off" in
  the shell until the user chose on the phone, needed the same "chosen on
  the phone" bit and a second place deciding what is drawn. The reason is
  not the label layout: as measured above, sites rank below features and
  cost them nothing. It is what a small screen shows first — on a 390 px
  ring the site names crowd the dozen feature names that fit, and on the
  map and in the sequence a finger lands on a site as often as on the
  feature it was after. A 1.5 entry, which has only the desktop's value,
  leaves the phone on its default.
