# 107. Primer workspace and one shared NCBI search

Design pass for #300 (second round after note 93, #226); mockups in
`300-mockups/` (open `index.html`). Status: layout and the seven
open points decided (2026-10-27); stage one built the same day (the shell,
the slim tab, the Design page; see **Built** below), stage two is to
redesign Results, Check and My primers and polish the phone.

## Decided

- A modeless primer workspace beside a live map, with a slim Primers sidebar
  (quick actions only). Four pages in a left rail: Design, Results, Check,
  My primers. Settings collapsed, results as a sortable table with a detail
  pane. Phone: full-screen. Rejected: a modal over the map; a modal with a
  duplicate mini-map.
- **One NCBI search component, used in both places.** The NCBI lookup is a
  single reusable component (today's accession field in
  `NcbiDialog.tsx`, grown by #299 into an autocomplete gene search by name
  and organism, with flanks). It is hosted by File ▸ Open from NCBI… and by
  the Design page's "Gene from NCBI…" target (#299), and behaves
  identically in both: same autocomplete, pick list for ambiguous names,
  flank controls, privacy wording, progress, cancel and errors. It owns the
  request lifecycle and takes the host's reaction as props (what happens
  with the fetched record, how Cancel and Escape close it, whether Escape
  is document-wide as in a modal host or scoped to the form in the
  workspace). It carries no dialog chrome. Callbacks from the host are held
  in refs, so a host re-rendering never restarts a fetch.
  - File menu: opens the record as a document, as now.
  - Primer workspace: the fetched gene (with flanks) becomes the design
    target; whether it also opens as a document tab is for #299 to settle.
    Settled by #299 (note 58): the component takes an optional `onFetched`
    prop and hands the host an `NcbiFetched` (documents, warnings, source:
    accession, region or gene with its `GeneHit` and `Region`) instead of
    opening tabs; the workspace decides whether to open one as well.
- Extract the component first, as its own change with no behaviour change
  and the existing `openFromNcbi` tests as the guard, then build #299 on it
  and the workspace on both.

## Layout: split

On desktop the workspace takes the sidebar's grid column, widened to about
900 px (at least 560 px, splitter-adjustable, remembered). The map keeps the
user's view at 280 px or more and the sequence pane yields while the
workspace is open. The strip layout (a full-width linear ribbon above a
full-width workspace) is used only on the phone and in note 106's
short-and-narrow windows; it needs an unrolled circular map the app does not
have yet.

## The seven points (recommended settings, accepted)

1. **Escape.** The workspace is a `region`, not a dialog: no focus trap, no
   backdrop. Escape closes it only when focus is inside it and nothing inner
   (a menu, an autocomplete, a settings disclosure) consumes the key. Focus
   returns to "Design primers…". Escape on the map keeps the map's meaning.
2. **Tab order.** Toolbar, views, workspace (the rail is a `tablist`, up and
   down arrows move between pages), sidebar tab rail, status bar. Opening
   focuses the active page's heading.
3. **Clicking the map.** Design follows the selection live. On Results a
   selection change hides the map preview but keeps the selected row, with a
   "Target changed — Design again" note. Results persist until the sequence
   changes, as today.
4. **Other sidebar tabs.** The tab rail stays. Choosing another tab closes
   the workspace. The Primers tab's slim panel then offers "Last design ·
   N pairs ›" to reopen it with all state kept (`primers.workspace` in panel
   memory).
5. **Window size.** 1000 px and wider: split. 601 to 1000 px: full width
   with a foldable strip. 600 px and narrower: phone, full screen, horizontal
   page tabs. 500 px high or less: the rail drops to icons and the strip is
   folded.
6. **Phone entry point.** The phone shell has no Primers tab (note 93);
   Primers becomes a fourth Details subtab.
7. **#298 and #299.** #298: a "Spec." column in the results table
   (not checked, queued, one hit, several hits) and a "Check specificity…"
   action in the detail pane; stage one opens NCBI prefilled, stage two
   fills the cell. #299: "Gene from NCBI…" as a third target on Design,
   plus the same search in File ▸ Open from NCBI (the shared component
   above).

## Built (stage one)

**Where the state lives.** `primerWorkspace` is a boolean in the store's
per-document state beside `sidebarTab`: the layout (`App.tsx`) and the
sidebar need it reactively, and the store keeps the invariant — open means
the sidebar is out on Primers; `setSidebarTab` to anything else and
`setSidebarOpen(false)` shut it (point 4). Which page is in front, the
target chooser's mode and the settings disclosure's state are panel memory
under `primers.*` (`primerWorkspace.ts`: `recallWorkspace`,
`rememberWorkspacePage`), so the slim panel's "Last design ›", "Full check
›" and "My primers…" land on a page without the store knowing the pages.
The width is `layout.primerWorkspaceWidth` (560–1400 px, default 900),
persisted with the other boundaries.

**One owner of the design at a time.** The design, the probe and the
preview logic moved out of `PrimerPanel` into hooks (`primerDesign.ts`:
`usePrimerDesign`, `usePrimerProbe`, `usePrimersPreview`) over the same
`primers.*` memory slots as before. The sidebar does not mount its panel
behind the workspace (`Sidebar` renders the rail alone while it is open),
so the slim panel and the workspace never hold the design at once and the
`primers` preview has one owner. What the views draw follows the page:
the search windows around the target on Design, the pair shown or hovered
on Results, the binding sites on Check; My primers draws its own.

**Layout.** In the grid the workspace is a column of its own between the
editor and the sidebar — `editor | splitter | workspace | rail` — which is
also the tab order point 2 asks for (toolbar, views, workspace, rail). The
splitter's after-pane is the workspace plus the rail, so `Splitter.onMove`
now hands the handle over and the caller subtracts the rail's measured
width. The Both view shows the map alone while the workspace is open
(`view` is derived in `App`, the user's choice untouched). Narrower than
1000 px (`VIEWS_STACKED_QUERY`) the workspace takes the whole main area
with the rail beside or under it; the foldable map strip point 5 gives
that range is **not built** — it needs the unrolled map the layout section
mentions, and the window is a laptop's at that width. On a phone the
workspace replaces `PhoneShell` under the toolbar (`layout="phone"`: rail
across the top as tabs, ‹ and ✕ in the top bar); Primers is a fourth
Details subtab (point 6). The phone's strip is not built either. A window
500 px high or less drops the rail to icons by CSS.

**Keyboard (points 1–3).** The region's own `keydown` shuts it on Escape
unless `defaultPrevented`; the settings disclosure folds first and marks
the event, the NCBI search's autocomplete stops it, and the "Gene from
NCBI…" wrapper marks Escape so the search's Cancel does not also shut the
workspace. Focus return is a one-shot request (`closePrimerWorkspace(true)`
→ `takeFocusRequest()` in the slim panel's mount effect), because the
button to return to mounts only after the shut. Opening, and a page change
that is not the rail's doing (a design, "Design again"), focuses the
heading (`tabindex=-1`); the rail's arrows keep the keyboard on the rail.
Design follows the selection live; Results hides the preview and says
"Target changed — Design again" once the selection is neither the designed
target nor the shown pair's product — an empty selection counts as no
change, since Escape on the map and the product being given back on close
are not new targets.

**The target chooser.** The target is always the selection; Feature and
Gene are ways of setting it. Choosing a feature selects its extent and the
line names it while the selection is exactly a feature's; a later click on
the map takes over without the chooser having to be reset. **Gene from
NCBI… opens the record as a tab**: a design needs a template and the flanks
are where the primers may lie, so the fetched gene cannot be a target of
the document in front. `designForFetchedGene` opens the tab (`openFetched`),
selects the `gene` feature NCBI annotated (`geneTarget`; the whole record
without one) and opens the workspace on Design there. That is the
least-surprising reading of "design primers for this gene": one tab, the
band already on the map.

**Settings.** The disclosure's row says **changed** and the summary only
once a setting is off its default (the defaults are a click away); the
disclosure's open state is remembered. The mockup's "Enter" hint beside
Design primers is not built: Enter on a page with number boxes and a
textarea has no one meaning.

**Left to stage two.** Results as a sortable table with a detail pane and
the "Spec." column (#298); Check and My primers redesigned (they host the
item 93 content unchanged, My primers with its own legend hidden by CSS);
the foldable map strips; the phone pages' polish; the `#298` link. The
guide's page 10 and the shortcuts page describe what stage one built.
