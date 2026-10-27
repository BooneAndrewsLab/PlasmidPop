# 107. Primer workspace and one shared NCBI search

Design pass for #300 (second round after note 93, #226); mockups in
`300-mockups/` (open `index.html`). Status: layout and the seven
open points decided (2026-10-27); nothing is implemented.

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
