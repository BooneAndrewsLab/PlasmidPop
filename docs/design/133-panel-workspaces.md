# 133. The CRISPR, Enzymes and Cloning panels beside Primers and Align

Status: planned, not built. Issues #379 to #398 in the 1.23.0 milestone carry
the work in the build order of section 4; #401 to #405 are the follow-ups.

What was asked: give the CRISPR, Enzymes and Cloning side panels the
treatment the Primers (item 107) and Align (item 129) panels got, a simple
side panel plus a full-screen advanced view, and keep the UI cohesive. Three
design plans were written, one per panel (appendices A to C), then
consolidated against the real Primers and Align code. The issue bodies cite
the decisions (D1 to D13) and sections of this note.

Read-only pass, 2026-11-05, against `551f7dd` (1.22.0 + tutorials). Inputs:
`Appendix A`, `Appendix B`,
`Appendix C` (same folder; amended in place, §5). References in
code: `PrimerPanel.tsx`, `PrimerWorkspace.tsx`, `AlignPanel.tsx`,
`AlignWorkspace.tsx`, `WorkspaceShell.tsx`, `primerWorkspace.ts`,
`alignWorkspace.ts`, `alignSession.ts`, `MsaRunNotices.tsx`, `App.tsx`,
`PhoneShell.tsx`, `state/editorStore.ts`, `state/panelMemory.ts`,
`useRowWindow.ts`, `styles.css`, notes 107 and 129.

**The one rule.** A user who learns one tab knows the others: every
analysis tab is a slim panel (input, a `role="status"` line, a few rows,
a `panel__links` row of doors), and the rest is a workspace built on
`WorkspaceShell` with a rail of pages, `wst` tables, a `detail` pane and
Escape back to the door. The Align build (item 129) is the reference where
Primers and Align differ, because it is the later and simpler of the two;
Primers differs in two places, both kept (table, row "Primers").

## 1. Cross-reference

"=" means the same as the reference (Align's build). "≠" is a deliberate
difference, with the reason. Primers and Align are what is shipped; the
other three are the plan after §2's decisions.

| Dimension                   | Primers (shipped)                                                                                                                                                                                                    | Align (shipped, reference)                                                                                                                                             | CRISPR                                                                                                                                                        | Enzymes                                                                                                                                                                           | Cloning                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Panel anatomy**           | `panel__group` fieldsets: Selection + primary button, Quick check, On this document, My primers… (PrimerPanel.tsx:68-221). ≠: three fieldsets, no status line — kept, it is a quick-actions tab, not an analysis tab | note, input box, Reference line, **Align**, `align__summary role="status"` with **Results ›**, links row (AlignPanel.tsx:54-146)                                       | = : Nuclease select (+PAM/spacer), "Only in the selection", status line, top 8 rows, links row                                                                | = : Filter box, status line, ticked rows (or ≤12 matches), gel sentence + **Digest ›**, links row. **Grown in** stays in the panel too (Q2)                                       | = with one ≠: the **Reaction** picker first (three bodies on one preview channel; the tutorials name it), then the body's status line, rows, shelf line, links row                                                                |
| **Door and wording**        | `button button--primary` **Design primers…** first (:76-91); page links **Last design ›**, **Full check ›**, **My primers…** ≠: the door is the action, not "the rest" — kept                                        | `link` **Options and more ›** first in `align__links`, then **Assemble reads ›**, **Multiple alignment ›** (:108-145). **Renamed to "Open Align workspace ›"** (§2 D1) | **Open CRISPR workspace ›** first in `panel__links`, then **Paired nickases ›**, **Prime editing ›**                                                          | **Open Enzyme workspace ›** first, then **Double digests ›**; **Digest ›** sits on the gel sentence as Align's **Results ›** sits on the summary                                  | ≠: no workspace of its own, so the doors name their destination: **Open the Bench ›**, **Clone an insert into this plasmid ›**; under the digest rows **All fragments and partial digest ›** (the Enzyme workspace's Digest page) |
| **Workspace**               | `PrimerWorkspace` on `WorkspaceShell`, `name="Primer"`, `title="Primers"`                                                                                                                                            | `AlignWorkspace`, `name="Align"`                                                                                                                                       | = `CrisprWorkspace`, `name="CRISPR"` (shell's `lower` must keep the acronym, §3.1)                                                                            | = `EnzymeWorkspace`, `name="Enzyme"`, `title="Enzymes"`                                                                                                                           | ≠: none. The Bench (`FrontTab 'bench'`, Alt+0) is the full-screen place; the primer workspace (cloning mode) and the Enzyme workspace (Digest page) hold the rest                                                                 |
| **Pages / rail**            | Design, Results, Check, Clone check, My primers                                                                                                                                                                      | Align, Results, Assemble, Multiple                                                                                                                                     | Guides, Pairs, Prime                                                                                                                                          | Enzymes, Digest, Double digests, Table                                                                                                                                            | — (Bench columns unchanged)                                                                                                                                                                                                       |
| **Tables**                  | `wst cands role="grid"`, `SortTh`, `tableKeys` (PrimerCandidates.tsx:422-514); My primers, Check sites                                                                                                               | batch list (`ReadBatchList`), no `wst` table                                                                                                                           | = `wst dt` guide table, windowed (§3.3); Pairs and pegRNA tables                                                                                              | = `wst dt` enzyme table, windowed; fragments table (shared with Cloning, §2 D4); pairs table                                                                                      | ≠: rows only (`fragment-list`, `pair-list`), as every slim panel keeps rows                                                                                                                                                       |
| **Detail pane**             | `<aside className="detail">` in `checkgrid` (PrimerCandidates.tsx:144)                                                                                                                                               | none (the alignment is the page)                                                                                                                                       | = `detail` beside the guide table from 900 px, under it below                                                                                                 | = `detail` for the enzyme row                                                                                                                                                     | ≠: none; the row's tooltip carries the third line                                                                                                                                                                                 |
| **State**                   | `useRemembered` slots `primers.*`; page `primers.workspace`; opener in `primerWorkspace.ts`                                                                                                                          | `alignSession.ts` external store (worker result can land after the host unmounts) + `useRemembered('align.workspace')` for the page                                    | ≠ to Enzymes, = to Align: `crisprSession.ts` on the shared `createDocumentSession` (the scan is a worker promise) + controller page memory `crispr.workspace` | = to Primers: `useRemembered` only (`enzymes.filter`, `enzymes.selected`, `enzymes.anchor`, `enzymes.pair`, `enzymes.partial`); sorts stay in the store; page `enzymes.workspace` | = to Primers: `cloning.*`, `pcr.*`, `mutagenesis.*` unchanged; `primers.mode` written by the door                                                                                                                                 |
| **Preview owner**           | `'primers'` via `usePrimersPreview`, by page (PrimerWorkspace.tsx:93-125)                                                                                                                                            | `'align'` for the pointed batch row (AlignWorkspace.tsx:73-79)                                                                                                         | = `'crispr'`, by page (Guides ≤200 guides, Pairs the pair, Prime the edit)                                                                                    | ≠: none for the enzyme table — the ticks are store state the views already draw (`visibleCutSites`); the Digest page's fragments use `'cloning'` through `useDigestPieces`        | = `'cloning'` (digest) and `'pcr'`, lifted into `useDigestPieces`; the Bench draws none                                                                                                                                           |
| **Phone**                   | fourth Details subtab; workspace `layout="phone"` full screen                                                                                                                                                        | fifth subtab, same                                                                                                                                                     | = sixth subtab (`PhoneShell.tsx:26-32`); 5 subtabs on a DNA document, so it fits                                                                              | = already a subtab; nothing to add                                                                                                                                                | ≠: no subtab, no Bench on a phone (item 49) — unchanged                                                                                                                                                                           |
| **Escape / shortcut**       | Escape in the region → `closePrimerWorkspace(true)` → focus **Design primers…** (`takeFocusRequest`)                                                                                                                 | same → **Open Align workspace ›** (`align-workspace-open`)                                                                                                             | = → `crispr-workspace-open`                                                                                                                                   | = → `enzyme-workspace-open`                                                                                                                                                       | ≠: no Escape target of its own; opening the primer workspace from here returns to the Primers tab's **Design primers…** (honest: the design lives there). Alt+0 is the Bench's key already                                        |
| **Empty / loading / error** | `panel__note` "No design yet" / "No suitable pairs"; `panel__note--quiet` for an empty filter; `ws__sub--note role="status"` "Target changed — Design again"                                                         | "Aligning…" `panel__note`; stale note in the head; Results `fieldset disabled` while stale; `MsaRunNotices` on Multiple                                                | = : "Looking for guides…"; once-shown off-target note in the Guides head (`seenOnce`); `RunNotices` for a failed or slow scan (§3.5)                          | = : "Scanning for restriction sites…"; Digest page's head note "Nothing is ticked — Enzymes" with the page disabled, as Align's Results while stale                               | = : the three recovery states kept (CloningPanel.tsx:371-405); PCR `panel__error` / `panel__warnings` as now                                                                                                                      |

## 2. Conflicts and decisions

**D1 Door wording.** Align says "Options and more ›", the CRISPR and
Enzymes plans "Open X workspace ›", Cloning "doors named for the
destination". Decision: two kinds of door, one rule each. (a) A panel's
own workspace: **Open {Name} workspace ›**, `Name` = the shell's `name`
prop (Primer, Align, CRISPR, Enzyme — singular where the tab is plural, as
"Primer workspace" already is). Align's string is renamed (AlignPanel.tsx:
119; 10 test strings in AlignPanel/AlignWorkspace/PhoneShell/App tests;
11-align.md:16,38; 14-shortcuts.md:142; tutorials/align.md:33 and its
test; comments in alignWorkspace.ts:37 and PhoneShell.tsx:23). (b) A door
to a page or another surface is named for where it goes, as Align's
**Assemble reads ›** is: **Paired nickases ›**, **Double digests ›**,
**Digest ›**, **Open the Bench ›**, **Clone an insert into this
plasmid ›**, **All fragments and partial digest ›**. Primers' **Design
primers…** stays a primary button: it is the action, and the Escape
target; the shortcuts table names it beside the three "Open … ›" links.
"›" for every door, "…" only for dialogs. Maintainer's call only on the
Align rename (Q1).

**D2 Order inside the links row.** Enzymes plan: "the opener is the last
control"; Align as built: the opener is the first link of the last row.
Decision: follow the code — `panel__links` is the panel's last block, the
workspace opener is its first link, page doors follow. No Align change.

**D3 Session store for CRISPR, none for Enzymes and Cloning.** Not a
conflict but a rule, note 129's: an external store when a worker result
can land after the host that asked has unmounted; `useRemembered`
otherwise. CRISPR's scan is such a promise (CrisprPanel.tsx:246); the
enzyme and cloning derivations are memos over the store's `analysis`. The
generic half of `alignSession.ts` (map, listeners, `useSyncExternalStore`,
forget: :99-135, 161-166) becomes `createDocumentSession<T>(initial)` and
both sessions use it; the `AbortController` map (:101-158) stays Align's.

**D4 The digest fragments table.** The Enzymes plan builds a `wst`
fragments table on its Digest page from `digestFragments` (lengths and
spans; its R7 cannot name the enzyme at each end) with "Join the pieces on
the Bench ›"; the Cloning plan wants that table to host `useDigestPieces`
(ends with enzyme names, features, partial digest, **Add** to the shelf,
hover preview) and the panel's partial toggle to move there. Decision: one
component, `DigestFragments.tsx`, fed by `useDigestPieces(doc, {partial})`
(lifted from CloningPanel.tsx:240-334 in CL2), hosted by the Enzyme
workspace's Digest page with **Add** per row and the partial toggle
(`enzymes.partial`); the slim Cloning panel keeps the complete digest's
rows and gets the door **All fragments and partial digest ›**. The Digest
page's hand-over link is **Open the Bench ›**, the same words as the
Cloning door. This settles Enzymes R1 (no shared host), R7 and, for
fragments, R10. The `'cloning'` preview owner is then held by whichever
host is mounted — never both (Sidebar.tsx:54). Partial digest leaving the
Cloning tab is a visible change (12-cloning.md:78-89): Q5.

**D5 `Workspace` union and the invariant.** `'crispr'` and `'enzymes'`
are sidebar tab ids (editorStore.ts:142, 138) and tools (:196, 195), so
`setWorkspace`'s rule "open ⇒ sidebar on the tab of that name" (:2196- 2201) holds and `hasSidebarTab` keeps proteins out. `Workspace` becomes
`Extract<SidebarTab, 'primers' | 'align' | 'crispr' | 'enzymes'>` so a
renamed tab fails to compile instead of failing silently (CRISPR R9,
Enzymes R11). No `'cloning'` kind (Cloning plan (c)).

**D6 Page memory shape.** Primers remembers `{page, mode}` under
`primers.workspace` (primerWorkspace.ts:36-42); Align remembers the page
alone under `align.workspace`. Decision: the shared controller remembers
the page alone under `<kind>.workspace` for all four; Primers' mode moves
to its own slot `primers.mode`, and `recallWorkspace()` stays as a facade
over both (CloningDesign.test.tsx:172 and PrimerPanel.test.tsx read it).
The Cloning door's `openPrimerWorkspace(id, 'design', 'cloning')` then
writes `primers.mode` and calls the controller's `open`.

**D7 Windowed rows vs a cap** (CRISPR R3, Enzymes R4). Decision: window;
no listing cap. `useRowWindow` already works for a `tbody` (the spacer is
two `tr`s with a height instead of padding); what it lacks is
`scrollToIndex` for the keyboard landing on an unrendered row. Built once
in E4 (1,500 rows), reused by C4 (25,000).

**D8 Add-as-feature switching the sidebar** (CRISPR R4). Today both Add
actions call `setSidebarTab('features')` (CrisprPanel.tsx:632, 826), which
would shut a workspace (:2186). Decision: inside a workspace, never switch
tabs; a `role="status"` line "Added N features" with **Undo**. From a slim
panel the switch stays (nothing to shut). Guide 17-crispr.md:188 updated.

**D9 Grown in.** The Enzymes plan moves it to the workspace head and
re-points the Cloning tab's link to the workspace; the CRISPR plan keeps
Nuclease in the panel _and_ in the workspace's settings row because it is
the one setting that changes the answer. Decision (recommended, Q2):
Enzymes does the same — the **Grown in** select stays in the slim panel
(one row, as today) and is also the workspace head on every page; the
Cloning tab's **Grown in** link keeps opening the Enzymes tab
(hostMethylation.test.tsx:258 unchanged).

**D10 Ordering across plans.** Cloning 1 was "first" for the
`panel__links` rename; Enzymes 1 was "first" for the controller; CRISPR
assumed nothing. Decision: two small shared issues land first (W1, W2 in
§4), the rest in §4's order; no plan's first issue carries another's
shared piece.

**D11 Design-note numbers.** All three plans reserve 133/134/135; take the
next free at build time (132 is the last today). Each look-pass issue
writes its note.

**D12 `EnzymeSort` growth** (Enzymes R5). Ship Name and Bands as column
sorts (today's two store values); Cuts and Overhang as a follow-up issue.

**D13 Primers' "Full check ›"** stays; it is a page door under a fieldset,
Align's **Results ›** under its summary is the same shape.

## 3. Build once, shared

In the order they land.

**3.1 `src/app/workspaceController.ts`** (W1) — replaces the duplicated
40 lines of primerWorkspace.ts:44-83 and alignWorkspace.ts:14-53.

```ts
export type WorkspaceLayout = 'split' | 'full' | 'phone'; // moved from primerWorkspace.ts:26
export interface WorkspaceController<P extends string> {
  readonly kind: Workspace;
  readonly pages: readonly P[];
  recallPage(documentId: string | null): P;
  rememberPage(documentId: string | null, page: P): void;
  /** Opens on the document in front; `page` or the one last on. trackOnce('panel','open',`${kind}-workspace`), then setWorkspace(kind). */
  open(documentId: string | null, page?: P): void;
  /** Shuts it when it is the one open; with returnFocus the slim panel takes the keyboard. */
  close(returnFocus?: boolean): void;
  takeFocusRequest(): boolean;
  /** useRemembered(`${kind}.workspace`) for the host component. */
  usePage(documentId: string | null): [P, (next: P) => void];
}
export function createWorkspaceController<P extends string>(
  kind: Workspace,
  pages: readonly P[],
  initial: P,
): WorkspaceController<P>;
```

`primerWorkspace.ts` becomes `export const primers = createWorkspaceController('primers', WORKSPACE_PAGES, 'design')` plus the `DesignMode`/`primers.mode` facade and `openPrimerWorkspace(id, page?, mode?)`; `alignWorkspace.ts` the same with `AlignPage`. The eleven files importing `WorkspaceLayout` from `../primerWorkspace` or `./PrimerWorkspace` point at the controller. `setPrimerWorkspace` (editorStore.ts:2204) goes. `WorkspaceShell.tsx:91`'s slot `primers.stripFolded` → `workspace.stripFolded` (not persisted; no migration). `WorkspaceShell.tsx:120` `lower`: keep an all-caps name as is ("Close the CRISPR workspace").

**3.2 `App.tsx` lookup** (W1). `workspaceAt` (:89-94) and the splitter label (:285) become one table:

```ts
const WORKSPACES: Readonly<
  Record<
    Workspace,
    {
      readonly View: ComponentType<{ doc: SeqDocument; layout: WorkspaceLayout }>;
      readonly label: string;
    }
  >
> = {
  primers: { View: PrimerWorkspace, label: 'primer' },
  align: { View: AlignWorkspace, label: 'Align' },
};
```

A new kind is one line here, one in the `Workspace` type, one subtab in `PhoneShell.tsx:26-32` when the tab is new there.

**3.3 `panel__links` / `panel__door`** (W2). `styles.css:7240` `.align__links` → `.panel__links`; the shared link rule `.primers__last, .primers__more, .align__more` (:7204-7217) → `.panel__door`. Align's door renamed (D1). The shortcuts heading `14-shortcuts.md:131` "Primer and Align workspaces" → "Workspaces", its Escape row listing every door, the "Results table" paragraph made generic ("In a workspace table…"). `PhoneShell.tsx:18-25` comment.

**3.4 `src/app/state/documentSession.ts`** (C1) — the generic half of `alignSession.ts`:

```ts
export interface DocumentSession<T> {
  read(documentId: string | null): T;
  update(documentId: string | null, patch: Partial<T> | ((s: T) => Partial<T>)): void;
  use(documentId: string | null): T; // useSyncExternalStore
  forget(): void; // tests
}
export function createDocumentSession<T>(initial: T): DocumentSession<T>;
```

`alignSession.ts` keeps its types, `INITIAL_SESSION`, the run map and exports the same names over an instance; `crisprSession.ts` is an instance plus its `CrisprSession` type.

**3.5 `RunNotices`** (C4). `MsaRunNotices.tsx:9-40` takes `{ error, stopped, slow, busy, retry, advice }` with the MSA sentence ("align fewer or shorter sequences") as `advice`; `MsaRunNotices` stays as a one-line wrapper or its two callers (MsaControls, MsaWindow) pass the props. CRISPR's session gains `busy`, `error`, `stopped` from `analysisClient`'s `AnalysisWorkerError` (note 129, #373).

**3.6 `useRowWindow.scrollToIndex`** (E4). One method on `RowWindow` (useRowWindow.ts:15-29) that sets `scrollTop` from `offsets[i]`; the windowed `tbody` pattern (two spacer `tr`s, `attachRow` on each `tr`, the `.tablewrap` as the scroller) documented in the hook's comment and used by `EnzymeTable` then `CrisprGuideTable`.

**3.7 `DigestFragments.tsx`** (E5) — the fragments table over `useDigestPieces` (D4), hosted by the Enzyme workspace only; the Cloning panel keeps its rows.

**3.8 Already shared, no work:** `WorkspaceShell`, `SortTh`, `tableKeys`, `MapStrip`, `.wst`/`.dt`/`.detail`/`.checkgrid`, `.ws--phone .dt` collapse (styles.css:7045-7061), `seenOnce`, `panelMemory`. Each plan uses these classes, never new ones for the same job.

## 4. Global issue list, build order

Main is releasable after each. Sizes: S ≤ a day, M a few days, L a week.
"Needs" lists dependencies. Each body is ready to file.

**W1 — Shared workspace controller and the App lookup** (S; needs nothing)

> The open/close/focus-request/page-memory functions are copied between `primerWorkspace.ts:44-83` and `alignWorkspace.ts:14-53`, and `App.tsx:89-94, 285` name each workspace by hand. Add `workspaceController.ts` (`createWorkspaceController(kind, pages, initial)`: `open`, `close`, `takeFocusRequest`, `recallPage`/`rememberPage`, `usePage`) and move both onto it; `WorkspaceLayout` lives there. Primers' design mode moves to its own slot `primers.mode` with `recallWorkspace()` kept as a facade. `App.tsx` gets a `WORKSPACES` table for the view and the splitter label; `WorkspaceShell` keeps an all-caps `name` in its close label; `primers.stripFolded` → `workspace.stripFolded`. `Workspace` becomes `Extract<SidebarTab, …>`. No visible change; the Primers, Align, App and store tests are the guard. `format:check`, `tsc -b`, `npm test`.

**W2 — One door wording and one links row** (S; needs W1)

> Rename Align's "Options and more ›" to "Open Align workspace ›" (tooltip unchanged), `.align__links` → `.panel__links`, `.primers__last/.primers__more/.align__more` → `.panel__door`. Guide: 11-align.md:16,38; 14-shortcuts.md heading "Workspaces", the Escape row naming **Design primers…** and every "Open … ›" door, the table-keys paragraph made generic; tutorials/align.md:33 and its test. Tests: the ten "Options and more ›" strings. This is the wording every later door follows (consolidated plan D1).

**CL1 — Cloning tab: two doors and the primer-mode argument** (S; needs W2)

> `openPrimerWorkspace(id, page?, mode?)` writes `primers.mode`. The Cloning panel gets a `panel__links` row: **Open the Bench ›** (`showBench('link')`) and **Clone an insert into this plasmid ›** (opens the primer workspace on Design in cloning mode; hidden where `hasSidebarTab(doc,'primers')` is false). `ShelfSummary` loses its link. The Design page in cloning mode gets a `panel__note` "Gibson, In-Fusion and overlap-PCR tails are designed on the Bench beside their reaction" with **Open the Bench ›**. Guide: 12-cloning.md intro becomes "The tab, the Bench and the primer workspace" with the task map; 10-primers.md "Cloning ends" one sentence; tutorials digest-pcr.md steps 75/106 and `DigestPcrTutorial.test.tsx`. Tests: `primerWorkspace.test.ts` mode written / remembered mode kept; the two doors.

**CL2 — Lift `useDigestPieces`** (S; needs nothing)

> Move CloningPanel.tsx:240-334 (sites, ready, ticked sites, blocked, listed/total, hovered, the `'cloning'` preview with its nonce-seeded `previewActivated` shelving, the unmount clear) into `components/digestPieces.ts` as `useDigestPieces(doc, {partial})`; the panel calls it. UI unchanged; the 15 `CloningPanel` tests (:92-140, :298-330, :372, :395) are the guard. Prepares the Enzyme workspace's Digest page (E5) to host the same hook.

**E1 — Lift `useEnzymeList`; `DoubleDigests` to its own file** (S; needs nothing)

> Move EnzymePanel.tsx:446-755 into `components/enzymeList.ts` (`useEnzymeList(doc)`: digest, groups, cuts, fragments, ticked, lanes, pairable, rows, counts, offered) over the store and a remembered filter text (`enzymes.filter`, per document — a change from editorStore.ts:706-710's reason, accepted because the panel and the table must agree); `DoubleDigests` (:275-432) to `DoubleDigestsPage.tsx`. UI unchanged; the 25 tests pass unchanged.

**C1 — Lift the CRISPR scan into a session** (M; needs nothing)

> Extract `createDocumentSession<T>` from `alignSession.ts:99-135,161-166` into `state/documentSession.ts` (Align re-expressed on it, its tests the guard). Add `crisprSession.ts` (settings, custom nuclease, narrowed region, request + answer, filters/sort, clicked, nickase and pegRNA fields) and `components/crisprScan.ts` (`useCrisprScan(doc)` lifting CrisprPanel.tsx:160-357, the `others` guard and request identity included). The panel and the two sub-panels read it; settings and results now survive a tab switch (no 818 ms rescan). Guard: the 13 `CrisprPanel` tests unchanged, plus `crisprSession.test.ts` and "a scan started in the panel is not rerun".

**E2 — The Enzyme workspace shell** (M; needs W1, E1)

> `Workspace` gains `'enzymes'`; one line in `App`'s table; `enzymeWorkspace.ts` = controller instance with `EnzymePage = 'enzymes' | 'digest' | 'pairs' | 'table'`; `EnzymeWorkspace.tsx` on `WorkspaceShell` (`name="Enzyme"`, `title="Enzymes"`) with four pages mounting today's pieces as they are (the list, the Fragments section with the gel, `DoubleDigestsPage`, import + custom form); **Grown in** also in the head. The panel grows **Open Enzyme workspace ›** (id `enzyme-workspace-open`) in a `panel__links` row. Phone: Enzymes is a subtab already. Tests: `EnzymeWorkspace.test.tsx` mirroring `AlignWorkspace.test.tsx:44-149`; store, App, PhoneShell cases.

**C2 — The CRISPR workspace shell** (M; needs W1, C1)

> `Workspace` gains `'crispr'`; `App` line; `PhoneShell` sixth subtab; `crisprWorkspace.ts` = controller instance with `CrisprPage = 'guides' | 'pairs' | 'prime'`; `CrisprWorkspace.tsx` on `WorkspaceShell` (`name="CRISPR"`) with three pages mounting today's list, `CrisprPairedNickases` and `CrisprPrimeEditing` as they are over the session. The panel grows **Open CRISPR workspace ›** (id `crispr-workspace-open`). Tests as E2's.

**E3 — The slim Enzymes panel** (M; needs E2)

> Cut `EnzymePanel.tsx` to: Filter (matches ≤ 12 with "and N more ›"), the `role="status"` summary with counts and the blocked-by-Dam/Dcm sentence, the ticked rows with the two notes and **Hide all**, **Grown in** as today, the gel sentence with **Digest ›**, the links row (**Open Enzyme workspace ›**, **Double digests ›**). Everything else is the workspace's. The 25 tests move to a `Host` (AlignPanel.test.tsx:39-55 pattern) per the enzymes plan §6; slim-panel cases added. Guide 07-enzymes.md: intro and "The tab and the workspace"; shortcuts Escape row.

**C3 — The slim CRISPR panel** (M; needs C2)

> Cut `CrisprPanel.tsx` to: Nuclease (+PAM/spacer when Custom), "Only cuts in the selection", the `role="status"` count line, the top 8 rows (shared sort, no sideways scroll: `.crispr-row__spacer` may ellipsize, `styles.css:5863`), **Add as feature** and **Details ›** under the selected row, the links row (**Open CRISPR workspace ›**, **Paired nickases ›**, **Prime editing ›** when the nuclease allows). The 13 tests move to a `Host`; slim cases added. Guide 17-crispr.md intro and "The tab and the workspace"; shortcuts Escape row.

**E4 — The enzyme table** (L; needs E2)

> Enzymes page: filter bar (Filter, Cuts, Sold by, Isoschizomers toggle, **Show listed** / **Hide all**), `<table className="wst dt" role="grid">` with `SortTh` (Name and Bands = today's `enzymeSort` store values; non-cutters at the foot), `tableKeys`, windowed rows (`useRowWindow` + new `scrollToIndex`, spacer `tr`s — the shared pattern, consolidated plan 3.6), columns tick/Name/Site/Overhang/Cuts/Positions/Dam-Dcm/Bands; `detail` pane (facts, every site with Select, its lane alone, **Tick**/**Untick**, **Find a partner ›**); the count line as the page's status. Guide "The enzyme table". Tests: `EnzymeTable.test.tsx` (sorts, keys, 1,500-row window, detail names the row). Follow-up filed: Cuts/Overhang sorts (`EnzymeSort` growth).

**C4 — The CRISPR Guides page** (L; needs C2, E4)

> Settings row (Nuclease, Off-targets up to, other documents, Only in the selection), filter bar (Spacer contains, PAM, Show flagged, Base editor, Only with a C), the `wst dt` guide table (#, strand, position, spacer, PAM, GC, four off-target columns, specificity when present, edits with an editor, flags) windowed with the E4 pattern, no cap (the 200 cap stays on the preview), `detail` pane (facts and Add as feature; oligos with Overhangs/Copy/Save to My primers; Other sites table), **Add the N listed as features** as a status line with Undo (no sidebar switch, D8). The once-shown off-target note in the page head. `RunNotices` generalised from `MsaRunNotices` (`advice` prop) for a failed or slow scan. Guide sections re-pointed. Tests per the CRISPR plan §6.

**E5 — Digest, Double digests and Table pages** (M; needs E2, E4, CL2)

> Digest: ticked enzymes as chips with ×, the gel with room (`Gel` `scale` prop or a `wide` variant), `DigestFragments.tsx` over `useDigestPieces(doc, {partial: enzymes.partial})` — #, length, span, the enzyme at each end, features, **Add** per row, hover preview — with the partial-digest toggle and "N sites uncut"; **Open the Bench ›**; disabled with nothing ticked (head note). Double digests: Pair select, partner offer, pairs as a `wst` table with **Tick both**, `PAIRS_SHOWN` 20, a pair's three lanes under the table. Table: the scanning line, import and custom form as open sections, custom enzymes with remove. Guide: "Fragments", "The gel", "Importing REBASE", "Adding your own", "A partner" re-pointed. Test :260 (partial) moves here from `CloningPanel.test.tsx`.

**CL3 — Slim Digest and PCR bodies** (M; needs CL1)

> Digest: one `role="status"` line "EcoRI, BamHI: 3 fragments, largest first." (regex in `DigestPcrTutorial.test.tsx:87` loosened), the three recovery states kept, two-line `FragmentRow`s with the range and features in the tooltip. PCR: Template, the two boxes with their report lines, a closed `<details class="panel__options">` for Polymerase and 5′-phosphorylation, dimers, the pinned status line, products, the gel (kept always unless Q3 says otherwise), one-sentence empty state. Mutate unchanged. digest-pcr.md steps 15/16 and its test; 12-cloning.md Digest and PCR sections.

**CL4 — The partial digest moves to the Enzyme workspace** (S; needs CL3, E5)

> The Cloning panel's **Partial digest** toggle and `cloning.partial` go; under the digest rows the door **All fragments and partial digest ›** opens the Enzyme workspace on Digest (`enzymes.partial` there). 12-cloning.md "Partial digest" re-pointed to 07-enzymes.md "Fragments"; "The shelf" says Add is also on that page.

**C5 — Pairs and Prime pages as tables** (M; needs C2)

> Pairs: nickase select and max offset on top, every pair as a `wst` table (forward guide, reverse guide, nick distance, overhang), a row selects the span and previews the two guides; badge = pair count. Prime: the edit form on top, pegRNAs as a table (guide, nick, distance, PBS, PAM changed, flags), the selected row's PBS / RT template / extension with Copy under it, the edit drawn as a preview tick; badge = pegRNA count. A `CrisprPairedNickases` test (none today). Guide "Prime editing" and "Paired nickases".

**CL5 — Check › from a PCR box** (S, optional; needs CL1)

> Beside each PCR primer box a **Check ›** door that writes `primers.probe` (the reverse of `sendToPcr`, primerToPcr.ts:19-28) and opens the primer workspace on Check. One test, one guide line.

**E6 / C6 / CL6 — Look pass and design note** (S each; after E5 / C5 / CL4)

> Phone via a 390 px iframe of the dev server (memory), 500 px-high windows, both themes, the slim panel at 320 px; the design note (next free number) with what was asked, built and decided, and a line in `docs/design/README.md`. Needs the maintainer's eyes, as items 107 and 129 did.

**Follow-ups to file, not build:** hover-to-highlight an enzyme row's sites (owner `'enzymes'`, Enzymes R10); Cuts/Overhang column sorts (R5); Homology ends as a third option of the primer workspace's cloning mode (Cloning R4); Escape returning to the tab that opened the primer workspace (Cloning R1); PhoneShell subtab strip scrolling if six do not fit at 360 px (CRISPR R5).

**Tutorials and recipes.** #375 (Align) is independent and in progress.
#377 (enzymes) unblocks after E3 + E5 (the tab, the table, the Digest and
Double digests pages are where its recipes click). #378 (CRISPR) after C3

- C4 + C5. #376 (cloning) after CL1 + CL3 for "clone an insert", "check a
  clone by digest", "mutation" and "Golden Gate" (the Bench and the check
  digest are unchanged); a partial-digest recipe, if one is wanted, after
  CL4. Each recipe issue cites the doors by their final names from D1.

**Order, as one line:** W1 → W2 → CL1 → {CL2, E1, C1 in any order} → E2
→ C2 → E3 → C3 → E4 → C4 → E5 → CL3 → CL4 → C5 → CL5 → the three look
passes. Enzymes runs ahead of CRISPR because it builds the windowed table
and the fragments table that CRISPR and Cloning reuse; Cloning's slimming
(CL3) is independent of everything but CL1 and can be pulled earlier if
hands are free.

## 5. Rewrites made to the three plans

Each file got a "Superseded where it differs" line under its title, and
these in-place changes:

- **Appendix A:** §1.5 the opener is the first link of the
  `panel__links` row (not `align__links`); §3 "Page memory" is a
  controller instance and the session is on `createDocumentSession`; R3
  decided (windowed, no cap, pattern from Enzymes E4); R4 decided (status
  line with Undo in the workspace; the panel keeps the switch); R9 answered
  by the `Extract<SidebarTab, …>` type; §5 the shortcuts heading is W2's;
  §7 issue numbers mapped to the global list; note number "next free".
- **Appendix B:** door text "Open Enzyme workspace ›" (the
  shell's name, as "Primer workspace"); opener first in the row; §2 Digest
  page hosts `DigestFragments` over `useDigestPieces` with **Add** and the
  partial toggle, link **Open the Bench ›**; R1/R7/R10 answered; R3 Grown
  in: recommendation panel + head, Cloning link not re-pointed (Q2); R5
  decided (Name and Bands first); §4 `CloningPanel.tsx:375-386` no longer
  changed; §6 `hostMethylation.test.tsx:258` unchanged; §7 issue 1 split
  into W1/W2 and numbers mapped; Cohesion §9 points here.
- **Appendix C:** §1(a) `openPrimerWorkspace(id, page, mode?)`
  writes `primers.mode` (D6), not `primers.workspace.mode`; §2.2 and
  Cohesion §1 the `panel__links` rename is W2's, Cloning 1 adopts it;
  §2 "The enzymes workspace's Digest page" names `DigestFragments.tsx`;
  R2 carries the recommendation (keep the gel always); §7 numbers mapped
  (CL1–CL6) and the sequencing line replaced by §4's order.

## 6. Open questions for the maintainer

1. **Rename Align's "Options and more ›" to "Open Align workspace ›"?**
   Ten test strings, two guide lines, one tutorial line. Recommend yes:
   it is the one string that makes the four doors read as one.
2. **Grown in: slim panel, workspace head, or both?** Recommend both
   (D9): the panel keeps today's one-row select, the head repeats it on
   every page, and the Cloning tab's link keeps opening the tab. Deciding
   "head only" re-points the Cloning link and changes
   `hostMethylation.test.tsx:258`.
3. **The PCR gel: always, or only with two or more products?** Recommend
   always (one lane at 320 px fits; digest-pcr.md step 119 stays true).
4. **What ranks the slim CRISPR panel's eight rows?** Recommend the
   shared sort, default position, with "Only cuts in the selection" as the
   way to make eight meaningful; specificity exists only for SpCas9.
5. **Partial digest leaves the Cloning tab for the Enzyme workspace's
   Digest page (CL4)?** Recommend yes: a partial digest is a question
   about sites, its 200 rows need a table, and **Add** is on that table.
   Deciding no keeps `cloning.partial` and drops CL4.

## Appendix A. CRISPR panel plan

Read-only design pass, 2026-11-05. Model: item 107 (primer workspace) and
item 129 (Align workspace). No algorithm changes: `core/analysis/crispr.ts`
and `crisprEdit.ts` are untouched throughout.

**Superseded where it differs by `this note`** (same
folder, 2026-11-05): door wording and row order (D1, D2), the shared
controller and session factory (§3.1, §3.4), windowed rows (D7), Add-as-
feature (D8), the global issue order (§4). The amendments below are
marked _[consolidated]_.

#### 0. What is there today (for reference)

- `src/app/components/CrisprPanel.tsx` (936 lines) is one component:
  settings (129-150, all plain `useState`, nothing remembered), the custom
  nuclease (160-179), the background-document list (205-221), the worker
  request and scan (223-265), filters and sort (273-306), the selected guide
  from the selection (308-312), the preview (314-336), map-click handling
  (338-346), then the JSX: Options fieldset (362-521), Guides fieldset with
  filter bar (546-619), "Add N listed" (620-639), the row list capped at
  200 (643-716), `GuideDetail` opened in place under the row (752-936:
  detail list, Add as feature, Other sites, oligos, Save to My primers).
- `CrisprPrimeEditing.tsx` (216) and `CrisprPairedNickases.tsx` (109) are
  further fieldsets under the list (727-735), each with its own `useState`.
- Nothing survives a tab switch: settings, filters, region, the pegRNA form
  — and the scan reruns on every remount (818 ms on a 200 kb BAC, note 74).
- The horizontal scrollbar comes from `.crispr-row` (styles.css:5863, five
  grid columns with `auto` widths and a 10.5 px mono spacer that cannot
  shrink below 23 characters) plus `.panel__field--row` labels such as
  "Count off-targets in the other open documents too" at 300 px.

#### 1. The slim panel: keep, move out

**Keeps** (`CrisprPanel.tsx` becomes ~150 lines, like `AlignPanel.tsx`):

1. **Nuclease** select (CrisprPanel.tsx:365-381), with PAM and Spacer boxes
   only when Custom is chosen (382-410). The nuclease is the one setting
   that changes the answer; everything else refines it.
2. **Only cuts in the selection** checkbox (465-503) with its "Cuts in …"
   line and "Use the selection now" — it is how the tab is used on a gene.
3. A one-line summary, `role="status"`: "578 guides, 112 without flags" (or
   "Looking for guides…", "No guides …", the custom-PAM problem). The
   off-target caveat (56-57) becomes the tooltip of the off-target column
   in both hosts; the once-shown paragraph with "Got it" (505-520) moves to
   the workspace's Guides page head (same `NOTE_SEEN_KEY`, seenOnce).
4. **The top guides**: the first 8 rows of the clean list in the current
   order (position by default; the workspace's sort is shared, see §3), the
   same compact row (strand, spacer+PAM, GC, off-targets, `!`) with
   `.crispr-row__spacer` allowed to ellipsize so the panel never scrolls
   sideways. Clicking a row selects the protospacer and reveals it (654-665)
   — no inline detail. Under the selected row a small action line:
   **Add as feature** (818-830 moved) and **Details ›** (opens the workspace
   on Guides with that guide selected).
5. **Open CRISPR workspace ›** (id `crispr-workspace-open`, the Escape
   return target, as `MORE_BUTTON_ID` in AlignPanel.tsx:23) and, when the
   nuclease supports them, **Paired nickases ›** and **Prime editing ›**
   links that open those pages. _[consolidated D1, D2]_ The row is the
   shared `panel__links` (W2 renames Align's `align__links`), the panel's
   last block; the workspace opener is its first link, as Align's is, and
   the page doors follow. Doors are `link panel__door`.

**Moves out** to the workspace: Base editor select (411-431), Off-targets
up to (432-453), Count in other documents (454-464), the spacer/PAM/sort
controls (546-590), Show flagged / Only-with-a-C (591-618), "Add N listed as
features" (620-639), `GuideDetail` (oligos, Other sites, Save to My
primers), `PrimeEditing`, `PairedNickases`.

Phone: CRISPR becomes a sixth Details subtab (PhoneShell.tsx:29-34), the
slim panel there, the workspace full screen as for Align.

#### 2. The workspace

`CrisprWorkspace.tsx` over `WorkspaceShell` (WorkspaceShell.tsx:14-50
props), `name="CRISPR"`, `title="CRISPR"`, three rail pages:

**Guides** (heading note: "578 · 112 clean", or "466 of 578" when filtered)

- Head (`head` prop): the once-shown off-target note with Got it; after
  that nothing.
- A **Settings** row across the top (not a disclosure — four controls fit at
  560 px): Nuclease (+PAM, Spacer), Off-targets up to, "Other open
  documents" toggle, "Only in the selection" toggle with the region span.
  Same handlers, same analytics events (analytics.ts:214-224).
- A **filter bar**: Spacer contains (IUPAC), PAM select, Show flagged,
  Base editor select, "Only with a C to edit" (appears with an editor).
- The **guide table**: `<table className="wst" role="grid">` as
  `PrimerCandidates.tsx:422` with `SortTh` (SortTh.tsx:21) and
  `tableKeys.ts` (one tab stop, `↑ ↓ Home End`). Columns: #, strand,
  position (1-based start, `formatSpan`), spacer (mono), PAM, GC %,
  off-targets as four narrow numeric columns (exact, 1, 2, 3 mm — sortable,
  the current `byOffTargets` 80-86 is the exact-column order), specificity
  (hidden unless some guide has one), edits (with an editor), flags (`!`
  with tooltip). The four current sorts (585-589) become column sorts; the
  default is position. A column picker is not needed: the conditional
  columns (specificity, edits) already come and go with the nuclease and
  editor. Row count: all filtered guides, not 200 — the 200 cap stays only
  on the preview (`MAX_PREVIEWED`, 52) and on the slim panel. See risk R3.
- A **detail pane** for the selected row, beside the table from 900 px and
  under it below that (CSS grid, as `checkgrid` on the primer Check page):
  the `GuideDetail` content split into two columns — left: protospacer,
  cut, GC, specificity, base-edit window and edited spacer, flags, Add as
  feature; right: oligos (Overhangs select, the two oligos, Copy, Save to
  My primers), and under both the **Other sites** table (mismatches,
  document, position, Show) — `guide.sites` is at most 50 rows
  (crispr.ts:128). Selecting a row selects the protospacer on the map as
  now; a second click or Escape-on-map clears it (the open-row toggle,
  654-665).
- Page actions under the table: **Add the N listed as features** (one
  `addFeatures` edit, 628-632). It no longer switches the sidebar to
  Features (632, 826): that would shut the workspace (editorStore.ts:2186).
  Instead a status line "Added 466 features" with Undo. Same for the
  single Add as feature (826).

**Nickase pairs** (badge: pair count; rail label "Pairs")

- Nickase select and max offset (CrisprPairedNickases.tsx:44-68) on top;
  pairs as a `wst` table (forward guide spacer/position, reverse guide,
  nick distance, overhang) instead of 20 text rows; all pairs, sorted by
  distance as `pairNickases` returns them. Selecting a row selects the span
  (90-94) and previews the two guides (owner `crispr`, the rest of the
  guides hidden while this page is in front).

**Prime editing** (badge: pegRNA count once an edit is typed)

- The edit form (CrisprPrimeEditing.tsx:70-141) across the top, "Use the
  selection" kept (its caveat — clicking a guide moves the selection — is
  why it is a button, note 81). pegRNAs as a table (guide, nick, distance,
  PBS, PAM changed, flags) with the selected row's PBS / RT template /
  extension and Copy underneath; the edit position drawn as a preview tick.

**Base editing** is not a page: the window is a per-guide fact (a column, a
filter, and a line in the detail). A page would hold one select.

**Map and sequence view.** The preview owner stays `'crispr'`
(editorStore.setPreview, 329). What is drawn follows the page, as item
107's workspace does: Guides draws the filtered guides (≤ 200) with the
selected one first; Pairs the selected pair; Prime the candidate guides
and the edit. Clicks on an arrow still come back through
`previewActivated` (338-346) and select the row in whichever host is
mounted. Split layout keeps the live map; `full` and `phone` get the
`MapStrip` from the shell for free.

**Phone.** `layout="phone"` from `App.workspaceAt` (App.tsx:89-93). The
tables take the `.ws--phone .dt` collapse rules (styles.css:7045-7061) if
given the `dt` class too, as PrimerCandidates does; the detail pane goes
under the table; the settings row wraps. Nothing CRISPR-specific.

**Light theme.** The app is light by default; dark is one media query
(styles.css:65). The existing CRISPR styles use tokens only (`--ink-3`,
`--surface-3`, `--seq-selection`, `--warn`, 5863-5925); new rules reuse
`.wst`, `.ws__*` and those tokens, so nothing to do beyond not writing a
literal colour. Check the `!` on `--warn` and the selected-row
`--seq-selection` against the table's zebra in both themes by eye.

#### 3. State

**A session store, not panel memory.** `src/app/crisprSession.ts` on the
pattern of `alignSession.ts:1-20`: per-document, `useSyncExternalStore`,
outside React. _[consolidated §3.4]_ Built on `createDocumentSession<T>`
(`state/documentSession.ts`), the generic half of `alignSession.ts:99-135,
161-166` extracted in issue C1 with Align re-expressed on it; the run's
`AbortController` map stays Align's. Reasons: (a) the scan is a worker promise that resolves
after the host that asked may have unmounted (panel → workspace is one
commit, Sidebar.tsx:54 and App.tsx:86-93); a `useRemembered` setter writes
nothing then (note 129, "Shared state"); (b) today's `useState` throws
away the scan on every tab switch, which is the 818 ms rescan.

Session fields (all of CrisprPanel.tsx:129-158 and the two sub-panels'
state): `nucleaseId, pam, spacerLength, maxMismatches, searchOthers,
narrowed {documentId, range}`; the answer `{request, guides|error}`;
`spacerFilter, pamFilter, showFlagged, sort: SortState<Column>,
baseEditorId, onlyEditable, schemeId, clicked`; `nickStrand, maxOffset`;
`pegEdit {position, replace, insert, pbs}`. Nothing persisted to
IndexedDB; a reload starts clean as today.

**One hook, two hosts.** `components/crisprScan.ts`: `useCrisprScan(doc)`
lifts CrisprPanel.tsx:160-357 (nuclease, background list, request, worker
effect, filters and sort, `covered`/`selected`, preview, map-click) over
the session. The panel and the workspace both call it; they are never
mounted at once (Sidebar.tsx:54). The `others` state guard (205-221) and
the request identity (`answered.request === request`, 262) move in as they
are; the test at CrisprPanel.test.tsx:118-141 (one worker call across a
click) is the guard.

**Selection sync.** Unchanged rule: the shown guide is the one whose range
equals the selection, `clicked` breaking the tie between strands (308-312).
`clicked` lives in the session, so a row clicked in the panel is the row
open when the workspace opens, and the reverse. The narrowed region stays
keyed to `documentId` (139, 191-196).

**Page memory.** _[consolidated §3.1]_ `src/app/crisprWorkspace.ts` is one
line: `export const crispr = createWorkspaceController('crispr',
CRISPR_PAGES, 'guides')` (`CrisprPage = 'guides' | 'pairs' | 'prime'`,
slot `crispr.workspace`), giving `open(documentId, page?)`, `close`,
`takeFocusRequest`, `usePage`. Width: `layout.workspaceWidth` shared.

**Store.** `Workspace` gains `'crispr'` (editorStore.ts:151; the type
becomes `Extract<SidebarTab, …>` in W1, so R9 is answered at compile
time); `setWorkspace` (2196-2201) already requires the sidebar tab of the
same name, which `'crispr'` is (142, 196). `hasSidebarTab` (202) keeps a
protein document from opening it. `App.tsx` is one line in the `WORKSPACES`
table (W1).

#### 4. Reused unchanged vs changed

Unchanged: `core/analysis/crispr.ts`, `crisprEdit.ts` and every export
CrisprPanel imports (lines 3-33), `analysisClient.crisprGuides`, the
oracle files, `WorkspaceShell.tsx`, `SortTh.tsx`, `tableKeys.ts`,
`MapStrip`, `panelMemory.ts`, `layout.ts`, `Sidebar.tsx` (reads `workspace
!== null`), `seenOnce`, `savePrimers`, `copyText`.

Changed: `editorStore.ts:151` (+ `hasSidebarTab` untouched); `App.tsx:89-93`
third branch and `:285` splitter label; `PhoneShell.tsx:29-34`;
`analytics.ts` — add nothing to `crispr`, use the existing
`panel / open / 'crispr-workspace'` (`trackOnce`, as alignWorkspace.ts:31)
and list it in note 38; `CrisprPanel.tsx` rewritten slim; `CrisprPairedNickases.tsx`
and `CrisprPrimeEditing.tsx` become pages over the session; new
`crisprSession.ts`, `crisprWorkspace.ts`, `components/crisprScan.ts`,
`CrisprWorkspace.tsx`, `CrisprGuideTable.tsx`, `CrisprGuideDetail.tsx`;
`styles.css` CRISPR block (5847-6025, 6317-6340) trimmed, `.crispr-row`
allowed to shrink, new `.crispr-ws__*` layout rules only.

#### 5. User guide

- `docs/guide/17-crispr.md`: intro (1-20) rewritten for the slim tab; new
  "The tab and the workspace" section modelled on 11-align.md:8-42 (pages,
  shared state, region not dialog, Escape, phone subtab); "Filtering the
  list" (22) → the table's filter bar and column sorts; "Off-targets" (78)
  gains the Other sites table; "Narrowing the scan" (123) stays in the tab;
  "Base editing" (137) → column and detail; "Prime editing" (151) and
  "Paired nickases" (171) → pages, tables; "Ordering and annotating" (188)
  → detail pane, Add N listed no longer jumps to Features. Re-check the
  "200 guides" sentence (18): the cap is now preview-only.
- `docs/guide/14-shortcuts.md:131-150`: the heading "Workspaces" and the
  generic table-keys paragraph are W2's _[consolidated]_; this plan adds
  **Open CRISPR workspace ›** to the Escape row. No new binding, so no
  new row.
- `docs/guide/README.md` entry 17: "the slim tab and the CRISPR
  workspace; …". `10-primers.md:31` and `11-align.md:8` cross-reference
  lines: "as **Design primers…** opens…" add the CRISPR button, optional.
- `src/app/help/guide.ts`: no change (17-crispr is registered, :53), unless
  a section anchor is linked from another page — `guide.test.ts` catches
  that.
- `docs/design/NNN-crispr-workspace.md` + README index line (the next free
  number at build time; 132 is the last today) _[consolidated D11]_.

#### 6. Tests

Must survive (`CrisprPanel.test.tsx`, 13 tests): rerun through a `Host`
that renders `CrisprWorkspace` while `workspace === 'crispr'` and the slim
panel otherwise (AlignPanel.test.tsx:39-55 pattern, `renderCrispr(doc,
page)` opening the workspace, `page('Guides'|'Pairs'|'Prime')` on the
rail). Which host each test needs:

- 48 (preview, map click, unmount clears) — both hosts; add the panel case.
- 77, 88, 157, 215, 264 (counts, filters, custom PAM, Cas12a overhangs,
  base editor) — workspace Guides; the "2 of 3" text (96) becomes the
  heading note; `Show flagged` stays a toggle button.
- 118 (one scan per click, detail under the row) — workspace; the "detail
  is the row's sibling" assertion becomes "the detail pane names the row".
- 143 (note once, then tooltip) — workspace head.
- 172 (oligos), 228 (Add as feature), 246 (Add all, one undo) — workspace;
  228 also in the panel.
- 183 (region held while clicking) — panel.
- 280 (pegRNA) — Prime page; CrisprPairedNickases has no test today: add.

New: `crisprSession.test.ts` (per document, forget); `CrisprPanel.test.tsx`
slim cases: eight rows and the count line, a click selects and reveals,
Open button sets `workspace: 'crispr'`, Escape returns focus
(`takeCrisprFocusRequest`), a scan started in the panel is not rerun when
the workspace opens (spy as :119), settings survive a tab switch;
`CrisprWorkspace.test.tsx` mirroring AlignWorkspace.test.tsx:44-149 (open
on the page asked, rail keys, Escape, shut by another tab and by the
sidebar, phone layout, badges); `CrisprGuideTable.test.tsx` (column sort
toggles, `↑ ↓ Home End`, conditional columns); `editorStore.test.ts:1605`,
`PhoneShell.test.tsx:98`, `App.test.tsx:534` each gain the CRISPR case.
Oracle and core tests untouched. `format:check` and `tsc -b` in every brief.

#### 7. Issues, in order (main releasable after each)

_[consolidated §4]_ These are C1–C6 of the global list; W1 (controller,
App lookup) and W2 (door wording, `panel__links`) land before any of
them, and C4 waits for Enzymes E4's windowed-table pattern.

1. **Lift the scan into a session** (C1; includes `createDocumentSession`) — `crisprSession.ts`, `useCrisprScan`,
   the three components over it, UI unchanged; settings and results now
   survive a tab switch. Guard: all 13 tests pass unchanged. Size S–M.
2. **The CRISPR workspace shell** (C2; needs W1) — store kind, App line,
   PhoneShell subtab, `crisprWorkspace.ts`, `CrisprWorkspace.tsx` with
   three pages that mount today's components as they are; the panel grows
   one door. Tests: workspace + store + App + PhoneShell cases. Size M.
3. **The slim panel** (C3) — cut down per §1, the CSS overflow fixed, guide
   intro and "tab and workspace" section, the shortcuts Escape row. Tests:
   slim cases; the 13 move to the Host. Size M.
4. **The Guides page** (C4; needs E4 for the windowed `tbody`) — settings
   row, filter bar, `wst dt` grid table with sorts and keys, windowed
   rows, detail pane, Add-N as a status line with Undo, the preview
   following the page, `RunNotices` generalised from `MsaRunNotices` for a
   failed or slow scan. Guide sections re-pointed. Size L.
5. **Pairs and Prime pages as tables** (C5) with their previews and
   badges; a nickase test. Size M.
6. **Look and the note** (C6) — phone and 500 px-high pass (phone via a
   390 px iframe of the dev server, per memory), both themes, the design
   note. Size S. Needs the maintainer's eyes: the Chrome extension could
   not reach the dev server in 107 and 129.

#### 8. Risks and open questions

- R1 **What ranks the panel's eight?** Position is honest but useless on a
  plasmid; specificity exists only for SpCas9 NGG/20 (crispr.ts:116-123);
  fewest off-targets ties everywhere on a clean plasmid. Proposal: the
  shared sort, default position, and "Only in the selection" as the way to
  make eight meaningful. Maintainer to decide.
- R2 **Add as feature in the panel or not.** Kept above because it is one
  click today; dropping it makes the panel simpler still.
- R3 **Table size.** A 200 kb BAC has ~25,000 guides (note 74); a 25k-row
  DOM table is slow. _[consolidated D7]_ Decided: window the rows with the
  `useRowWindow` + `scrollToIndex` pattern Enzymes E4 builds; no listing
  cap (the 200 cap stays on the preview only).
- R4 **Add-N no longer opening Features** changes visible behaviour (guide
  188 says it does). _[consolidated D8]_ Decided: inside a workspace never
  switch tabs (it would shut the workspace); a `role="status"` "Added N
  features" with **Undo**. The slim panel's single **Add as feature**
  keeps today's switch.
- R5 **Six Details subtabs on a phone** may not fit at 360 px; PhoneShell's
  tablist may need to scroll.
- R6 **Prime editing's "Use the selection"** still fights the row click
  (note 81); a table makes the conflict more visible. Leave as is.
- R7 **Custom PAM typing** re-scans per keystroke today (debounced only by
  `nucleaseProblem`); unchanged, but now visible in a bigger table.
- R8 Base editing as a column: with ABE and CBE the "edits" count means
  different bases; the column header must name the editor.
- R9 The `Workspace` kind must equal the sidebar tab id (`'crispr'`), which
  it does. _[consolidated D5]_ `Workspace = Extract<SidebarTab, …>` (W1)
  makes a renamed tab a compile error, not a silent break.

## Appendix B. Enzymes panel plan

Read-only design pass, 2026-11-05, against 1.22.0 (`071209f`). Model: item
107 (primer workspace), item 129 (Align workspace), and the sibling CRISPR
plan (`Appendix A`, same folder), whose shared mechanisms are
reused here, not reinvented. No algorithm changes: `src/core` is untouched
throughout (restriction scan, `enzymeDigest`, `gelProfile`, `bestPairs`,
`bestPartners`, `compareDiagnostic`, methylation).

**Superseded where it differs by `this note`** (same
folder, 2026-11-05): door wording and row order (D1, D2), the Digest page's
fragments table hosting `useDigestPieces` (D4), Grown in (D9, maintainer's
Q2), the global issue order (§4). The amendments below are marked
_[consolidated]_.

#### 0. What is there today

- `src/app/components/EnzymePanel.tsx` (1,131 lines), one component:
  constants and helpers (53-240), `DoubleDigests` (275-432), then
  `EnzymePanel` (434-1131): derivations 446-755 (digest, groups, cuts,
  shownCuts, fragments, ticked, tickedGroups, lanes, units, pairable, rows,
  counts, offered, row window), and the JSX: controls 766-918 (Filter, Cuts,
  Order + reverse, Grown in, Isoschizomers, Sold by, Show listed, Hide all),
  notes 919-953 (cut sites hidden; nothing ticked), the windowed list
  958-1038 (`useRowWindow`, `ROW_ESTIMATE` 46 px), the count line 1039-1047,
  Double digests 1048-1056 (only when Order = Band separation), the
  "Scanning with…" line with Add enzyme… / Import a REBASE table… 1057-1098
  (`CustomEnzymeForm`, `EnzymeImport` inline), Fragments with the `Gel`,
  sizes, "each alone", "On a gel" 1099-1126.
- State already in the store, per document: `shownEnzymes` (editorStore.ts:
  523, setters 2328-2339), `enzymesInitialized`; shared and persisted:
  `enzymeCutFilter`, `enzymeSupplier`, `enzymeSort`, `enzymeSortReversed`,
  `enzymeGroupIsoschizomers` (711-727, setters 2341-2371), `gelAgarose`,
  `gelLadder` (Gel.tsx:353, 369), `showCutSites` (680-699, Toolbar Alt+R).
  `doc.methylation` is a document edit (`setMethylation`, 845).
- Local `useState` only: the filter text (448), `importing`/`adding`
  (449-450), the double-digest anchor (277). Nothing async lands in the
  panel: the scan is the store's `analysis` (455-457), so unlike Align and
  CRISPR there is no result that can arrive after an unmount.
- Map and sequence already follow the ticks: `CircularMapView.tsx:162-168`,
  `editorStore.visibleCutSites` (2686-2701). No preview channel is used.
- The Cloning tab's Digest (`CloningPanel.tsx:363-450`) reads the same
  ticks (`sites.pick(shownEnzymes)`, 255) and links to the Enzymes tab for
  "Grown in" (375-386) and "Tick enzymes" (393-401).
- Tests: `EnzymePanel.test.tsx` (811 lines, 25 tests, 73-807; the last
  `describe` at 731 is core-level), `Gel.test.tsx` (7), `EnzymeImport`,
  `CustomEnzymeForm`, `hostMethylation.test.tsx` (clicks **Grown in**, 258),
  `DigestPcrTutorial.test.tsx:137` (the Cloning "No enzyme is ticked" copy).

#### 1. The slim panel: keep, move out

**Keeps** (`EnzymePanel.tsx` becomes ~150 lines, like `AlignPanel.tsx`):

1. **Filter** box (770-779), unchanged, `aria-label="Filter enzymes"`. With
   text in it the panel lists the matching rows (name or site, the same
   `rows` memo 658-726 with the workspace's Cuts/Sold by filters applied),
   capped at 12 with "and N more ›" opening the workspace. This keeps the
   guide's "How to check whether an enzyme is a unique cutter" (07-enzymes.md
   :239) a tab-only task, and lets a new enzyme be ticked from the tab.
2. **A one-line summary**, `role="status"`: "127 enzymes: 35 cut once, 49
   more than once, 43 not at all. 5 ticked." — or "Scanning for restriction
   sites…" (955) while `!ready`. When the document's methylation blocks a
   ticked site, a second sentence: "2 ticked sites blocked by Dam/Dcm
   (grown in dam+/dcm+)". _[consolidated D9, recommended, maintainer's
   Q2]_ The **Grown in** select stays in the panel as today (one row,
   after the ticked rows) and is repeated in the workspace head, as the
   CRISPR panel keeps Nuclease in both hosts; the Cloning tab's link keeps
   opening the Enzymes tab.
3. **The ticked enzymes** (with the box empty): the same compact row
   (963-1035) — tick box, name, +N, site, cut positions (click selects the
   site, 757-762), the methylation note, the band line with its ⚠. Unticking
   a row unticks its group (974-980). The two notes stay: "Cut sites are
   hidden in the views" (919-933, it is about the map) and "Nothing is
   ticked… Tick the N enzymes that cut once" (934-953, the recovery from an
   empty state). **Hide all** stays as a small link under the rows.
4. **The gel in one line**: the "On a gel: 3 bands, 4,361, 2,181, 980 bp"
   sentence (1117-1124, with its warn class) followed by **Digest ›**, which
   opens the workspace on the Digest page. The picture moves there (R2).
5. **Open Enzyme workspace ›** _[consolidated D1: the shell's `name`, as
   "Primer workspace" is to the Primers tab]_ (id `enzyme-workspace-open`,
   the Escape return target, as `MORE_BUTTON_ID` at AlignPanel.tsx:23; a
   `link panel__door`, first in the `panel__links` row — W2 renames
   Align's `align__links` — with **Double digests ›** after it when
   `pairable.length >= 2`).

**Moves out**: Cuts, Order + reverse, Isoschizomers, Sold by
(781-890), Show listed (893-907), the full list and its count line
(958-1047), Double digests, the "Scanning with…" line with Add enzyme… and
Import a REBASE table… (1057-1098), the Fragments section with the `Gel`
(1099-1126).

Phone: Enzymes is already a Details subtab (`PhoneShell.tsx:29-34`,
`['enzymes', 'Enzymes']`), so nothing to add; the slim panel renders there
and the workspace full screen as for Align (App.tsx:168-170).

#### 2. The workspace

`EnzymeWorkspace.tsx` over `WorkspaceShell` (WorkspaceShell.tsx:14-50
props), `name="Enzyme"` (region label "Enzyme workspace", close button
"Close the enzyme workspace", as the shell derives them, :66, :95),
`title="Enzymes"`. `head`: the **Grown in** select (836-855, the same
`setMethylation` edit) on every page — it is a document fact that changes
every page's answer — with its tooltip; on the Digest page the head also
carries the "N sites left out" note. Four rail pages:

**Enzymes** (badge: rows listed; heading note "35 of 127" when filtered)

- A **filter bar** across the top (five controls fit at 560 px): the same
  Filter box as the panel (one remembered value, §3), **Cuts**, **Sold by**
  (only with suppliers, 872-890), **Isoschizomers share a row** as a toggle
  button, **Show listed** / **Hide all** as page actions on the right with
  the same `MAX_SHOW_LISTED` guard (896-900).
- The **enzyme table**: `<table className="wst dt" role="grid">` as
  `PrimerCandidates.tsx:422` with `SortTh` (SortTh.tsx:11-18) and
  `tableKeys.ts` (`toggleSort`, `nextRowIndex`: one tab stop, `↑ ↓ Home
End`, `tabIndex` roving as :489). Columns: tick, Name (+N with the
  `describeOthers` tooltip, 200-208), Site (mono, `describeEnzyme` tooltip
  157-180), Overhang (`overhangKind`, new cheap column: blunt / 5′ / 3′),
  Cuts (count, numeric), Positions (first `MAX_SITES_SHOWN` as the click
  links 998-1028, `+N`), Dam/Dcm ("1 of 2" from `countMarked`, 1030-1033),
  Bands (`BandLine`, 216-240). Sortable: Name and Bands are today's two
  `enzymeSort` values with `enzymeSortReversed` as the direction (same
  store fields, so the choice still survives a reload, 719-727); Cuts and
  Overhang are new column sorts and need `EnzymeSort` to grow (R5).
  Non-cutters stay at the foot in every sort but Name (709-714).
- **Windowed rows.** A REBASE table lists ~1,500 enzymes; the list is
  windowed today (`useRowWindow`, 748-751) and the table must be too. Build
  it once as a `tbody` variant of `useRowWindow` (padding on spacer rows
  instead of the `ul`'s padding) — the CRISPR plan's R3 needs the same
  thing for 25,000 guides. See §9 of Cohesion.
- A **detail pane** for the selected row (click anywhere but the tick; a
  second click or Escape clears it), beside the table from 900 px and under
  it below that, the `checkgrid` pattern (styles.css:6862) and the `detail`
  aside (`PrimerCandidates.tsx:144`): the enzyme's facts (the tooltip's
  lines 157-180 as a list, isoschizomers in full), **every** cut site as a
  small table (position as today, strand context ±10 bases, Dam/Dcm mark,
  Select), its lane alone (`Gel` with one lane, `g.profile()`), and two
  actions: **Tick** / **Untick**, **Find a partner ›** (Double digests page
  anchored on it, today's `setAnchorName`, 358).
- Foot: the count line (1039-1047) as the page's status line.

**Digest** (badge: fragment count; disabled with nothing ticked, as the
Align Results page is disabled while stale, AlignWorkspace.tsx:255)

- The ticked enzymes as chips with × (untick) across the top.
- The **gel** (`Gel lanes={lanes}`, the `lanes` memo 574-614 unchanged,
  with its agarose/ladder menus in the figcaption, Gel.tsx:343-375) with
  room: lift the `maxWidth` (Gel.tsx:207, `width * SCALE`) by a `scale`
  prop so the slab can be twice the panel's 320 px; the SVG is already a
  `viewBox`.
- A **fragments table** _[consolidated D4]_: `DigestFragments.tsx`, a
  `wst dt` table over the Cloning plan's `useDigestPieces(doc, {partial})`
  (lifted in CL2): #, length, span (`formatSpan`, 1-based), the enzyme at
  each end (`FragmentEnd`, so R7 needs no core change), features, the band
  it falls in, **Add** (to the shelf) per row; hovering a row lights the
  fragment through the hook's `'cloning'` preview (never clashes: the
  Cloning panel is unmounted while a workspace is open, Sidebar.tsx:54);
  clicking a row selects the piece. A **Partial digest** toggle
  (`enzymes.partial`, moved from the Cloning tab in CL4) with "N sites
  uncut". The "each alone" line (1109-1114) and "On a gel" (1117-1124)
  under it.
- One link: **Open the Bench ›** (`showBench('link')`, the same words as
  the Cloning tab's door; the Bench is a `FrontTab`, so this workspace
  stays open behind it).

**Double digests** (badge: pairs found)

- **Pair** select (333-350) and the "Find a partner for X" offer (352-364)
  on top; the pairs as a `wst` table: Enzyme 1, Enzyme 2, bands (`BandLine`),
  ⚠, **Tick both** (392-406). `PAIRS_SHOWN` 5 → 20 on the page: `bestPairs`
  and `bestPartners` take the count as an argument (296-302, 310-317), the
  cost is in candidates, not results (note 42). The "pairs of listed
  enzymes… narrow the list" foot (413-429) stays. The page no longer needs
  Order = Band separation to appear (1048) — it is a page.
- Selecting a pair row draws its three lanes under the table without
  changing the ticks (the lane trio of 606-613 built from the pair's cuts);
  **Tick both** still sets the ticks, so the map follows.

**Table** (badge: custom enzymes, `enzymeSetInfo.custom.length`)

- The "Scanning with…" line (1057-1065), then `EnzymeImport` (drop zone,
  steps, 167 lines, styles.css:1327-1354) and `CustomEnzymeForm` as open
  sections rather than toggled links; the custom enzymes listed with their
  remove action (analytics `custom-remove`, analytics.ts:196).

**Methylation** is not a page: the Grown in select in the head, the
Dam/Dcm column and note, the digest's "left out" note.

**Map and sequence view.** Nothing new: the ticks are `shownEnzymes`, drawn
by the views already (CircularMapView.tsx:162-168, LinearSequenceView), and
hidden by Alt+R (`showCutSites`). Clicking a position or a fragment selects
and reveals as today (757-762, 575-588). No preview owner is claimed (R10
proposes row-hover highlighting as a follow-up). Split layout keeps the live
map; `full` and `phone` get the shell's `MapStrip` (WorkspaceShell.tsx:118).

**Phone.** `layout="phone"` from `App.workspaceAt` (App.tsx:89-93). The
tables take the `.ws--phone .dt` collapse (styles.css:7045-7061) through the
`dt` class; the detail pane goes under the table; the filter bar wraps. The
Positions column is the long one; on a phone show the count with the first
three positions.

**Light theme.** The app is light by default, dark one media query
(styles.css:65). The enzyme rules (1289-1300, 1601-1670) and the gel
(4871-4955) use tokens; new `.enz-ws__*` rules reuse `.wst`, `.ws__*`,
`.detail`, `.checkgrid` and tokens, so nothing to do beyond not writing a
literal colour. Check the ⚠ on `--warn` and `link--methylated` against the
table zebra in both themes by eye.

#### 3. State

**No session store; panel memory is enough.** Align and CRISPR need an
external store because a worker promise lands after the host may have
unmounted (note 129, "Shared state"; CRISPR plan §3). The enzyme tab has no
such result: the scan is `analysis` in the store, and every derivation is a
synchronous memo over store state. So the few values that are not in the
store use `useRemembered` (`panelMemory.ts:28`), per document, as the
primer workspace does — and `useRemembered` slots are what the Cohesion
section (§4) standardises on. This is the one deliberate difference from
the CRISPR plan, and it is the primer workspace's pattern, not a new one.

Remembered (slot names, all per document): `enzymes.workspace` (page,
`EnzymePage = 'enzymes' | 'digest' | 'pairs' | 'table'`), `enzymes.filter`
(the Filter text, shared by panel and workspace, so what was typed in the
tab is the table's filter — a change from today, where the box is forgotten
on purpose, editorStore.ts:706-710; worth it because the panel's rows and
the table must agree), `enzymes.selected` (the table's row), `enzymes.sort`
is NOT a slot — it stays `enzymeSort`/`enzymeSortReversed` in the store,
persisted; `enzymes.anchor` (the Pair select), `enzymes.pair` (the pair
row selected). Nothing persisted to IndexedDB beyond what already is.

**One hook, two hosts.** `components/enzymeList.ts`: `useEnzymeList(doc)`
lifts EnzymePanel.tsx:446-755 as it is (digest, groups, cuts, shownCuts,
fragments, ticked, tickedGroups, lanes, units, entryByName, pairable, rows,
listedEnzymes, cutters, nonCutters, offered) over the store and the
remembered filter. The panel and the workspace both call it; they are never
mounted at once (Sidebar.tsx:54, App.tsx:86-93). The lazy `profile()` of
each row (494-505) stays lazy, so the panel pays nothing for rows it does
not show.

**Tick sync** is already the store: a tick in the panel, the table, the
detail pane or Tick both goes through `setEnzymeShown`/`setShownEnzymes`
(2328-2339), and the map, the sequence view, the Cloning digest and the
other host read `shownEnzymes`. Nothing new to build.

**Page memory and open/close.** _[consolidated §3.1]_
`src/app/enzymeWorkspace.ts` is `export const enzymes =
createWorkspaceController('enzymes', ENZYME_PAGES, 'enzymes')` (slot
`enzymes.workspace`). Width: `layout.workspaceWidth`, shared.

**Store.** `Workspace` gains `'enzymes'` (editorStore.ts:151; the type is
`Extract<SidebarTab, …>` after W1). `setWorkspace` (2196-2201) requires
the sidebar tab of the same name; `'enzymes'` is one (138). `hasSidebarTab`
(202) keeps a protein document from opening it. `App.tsx` is one line in
the `WORKSPACES` table (W1).

#### 4. Reused unchanged vs changed

Unchanged: `src/core` entirely (every import at EnzymePanel.tsx:3-32),
`state/cutFilter.ts`, `state/enzymeSort.ts` (until R5), `state/useGel.ts`,
`Gel.tsx` (plus one optional `scale` prop), `CustomEnzymeForm.tsx`,
`EnzymeImport.tsx`, `useRowWindow.ts` (plus the tbody variant),
`WorkspaceShell.tsx`, `SortTh.tsx`, `tableKeys.ts`, `MapStrip.tsx`,
`panelMemory.ts`, `layout.ts`, `Sidebar.tsx`, `PhoneShell.tsx`, the store's
enzyme setters (2328-2371) and `visibleCutSites`, analytics `enzymes` events
(analytics.ts:196), the map and sequence views.

Changed: `editorStore.ts:151`; `App.tsx:89-93` (a third `workspaceAt`
branch) and `:285` (the splitter label — make it a lookup, Cohesion §9);
`EnzymePanel.tsx` rewritten slim; `DoubleDigests` moved to
`DoubleDigestsPage.tsx`; new `enzymeWorkspace.ts`, `components/
enzymeList.ts`, `EnzymeWorkspace.tsx`, `EnzymeTable.tsx`,
`EnzymeDetail.tsx`, `DigestPage.tsx`, `DigestFragments.tsx`,
`EnzymeTablePage.tsx`; `CloningPanel.tsx:375-401` unchanged _[consolidated
D9: both links keep opening the Enzymes tab, whose slim panel has Grown in
and can tick]_; `styles.css` enzyme
block trimmed (1601-1670 keeps the row rules the panel still uses), new
`.enz-ws__*` layout rules only; `analytics.ts:157-158` comment lists
`enzyme-workspace` (use the existing `panel / open` with `trackOnce` as
alignWorkspace.ts:31; note 38's catalogue gets the label).

#### 5. User guide

- `docs/guide/07-enzymes.md`: intro (1-13) rewritten for the slim tab; new
  "The tab and the workspace" section after it, modelled on
  11-align.md:8-42 (what the tab holds, the four pages, the ticks shared,
  Escape, the phone subtab); "Reading the list" (15) → "The enzyme table"
  (columns, sort, the detail pane); "Choosing which to show" (48) keeps the
  opening rules, Show listed / Hide all become page actions, the tab's
  search box gets its own paragraph; "Choosing a diagnostic digest" (103):
  Order → the Bands column sort, "A partner" (122) and "beside the single
  ones" (136) → the Double digests page; "Isoschizomers" (147) → the
  toggle on the Enzymes page; "Hiding the cut sites" (173) unchanged (tab);
  "Fragments" (195) → the Digest page with the fragments table; "The gel"
  (211) unchanged in substance, "here and in the Cloning tab's PCR" still
  true; "How to check a unique cutter" (239) stays a tab recipe; "Importing
  REBASE" (246) and "Adding your own" (300) → the Table page; "Where the
  DNA was grown" (362) → the workspace head, and the Cloning tab's link
  opens it.
- `docs/guide/14-shortcuts.md:131-150`: the heading "Workspaces" and the
  generic table-keys paragraph are W2's _[consolidated]_; this plan adds
  **Open Enzyme workspace ›** to the Escape row. No new binding.
- `docs/guide/README.md:16`: "the slim tab and the Enzymes workspace; the
  enzyme table, …". `12-cloning.md:30` ("ticked in the Enzymes tab") still
  true; `03-viewing.md:146`, `02-files.md:614, 629`, `10-primers.md:189,
271` still true (the ticks are the tab's). `11-align.md:8` and
  `10-primers.md:31` cross-reference lines may name the third workspace.
- `src/app/help/guide.ts`: no change (`07-enzymes` is registered, :43);
  `guide.test.ts` catches a renamed anchor linked from elsewhere — "Fragments"
  and "The gel" anchors are linked from 12-cloning.md; keep the headings.
- `docs/design/NNN-enzyme-workspace.md` + README index line (the next
  free number at build time) _[consolidated D11]_.

#### 6. Tests

Must survive (`EnzymePanel.test.tsx`, 25 tests): rerun through a `Host`
that renders `EnzymeWorkspace` while `workspace === 'enzymes'` and the slim
panel otherwise (`AlignPanel.test.tsx:39-55` pattern; `renderEnzymes(doc,
page)` opening the workspace, `page('Enzymes'|'Digest'|'Double
digests'|'Table')` on the rail). `listed()` (:62) reads `.enzyme-row__name`
— give the table's name cell the same class or update the helper. Which
host each needs:

- 91, 97 (default ticks) — store-level, either host.
- 116 (row window) — workspace table; the assertion counts rendered rows.
- 144 (band line + ⚠) — table; 172, 203, 323 (gel sentence, lane click,
  agarose/ladder) — Digest page; 172's sentence also in the panel.
- 271, 293 (order, reverse) — column sort on the table: the "Order" select
  becomes a click on the Bands header, `aria-sort` the assertion.
- 350, 388 (double digests, partner) — Double digests page.
- 428, 493 (the offer) — panel (and the Enzymes page).
- 467 (cut filter) — Enzymes page; 508 ("keeps what it was asked for when
  the panel comes back") — the store field, either host.
- 587-630 (isoschizomers) — table; 630 (untick the group) also in the panel.
- 655, 674 (methylation marks, worker digest) — table.
- 731-807 untouched (core).
- `hostMethylation.test.tsx:258` clicks **Grown in** in the Cloning tab and
  expects the Enzymes tab's select: unchanged under D9 (the slim panel
  keeps the select); it changes only if Q2 is decided "head only".
- `DigestPcrTutorial.test.tsx:137` copy unchanged if the Cloning link keeps
  "in the Enzymes tab".

New: `EnzymePanel.test.tsx` slim cases (summary line and its counts; ticked
rows only with the box empty; a search lists matches and ticks one; the
gel sentence and Digest ›; Open button sets `workspace: 'enzymes'`; Escape
returns focus via the controller's `takeFocusRequest`; the filter text
survives panel → workspace); `EnzymeWorkspace.test.tsx` mirroring
`AlignWorkspace.test.tsx:44-149` (open on the page asked, ticks shared both
ways and the page remembered, rail keys, Escape, shut by another tab and by
the sidebar, phone layout, badges, Grown in in the head is an undoable
edit); `EnzymeTable.test.tsx` (column sort toggles and `aria-sort`,
`↑ ↓ Home End`, windowing with 1,500 rows, detail pane names the row, all
sites listed in it); `DigestPage` (fragments table rows select, chips
untick, disabled with nothing ticked); `editorStore.test.ts` (the kind),
`App.test.tsx:534` and `PhoneShell.test.tsx:98` gain the Enzymes case.
`Gel.test.tsx` untouched. `format:check` and `tsc -b` in every brief.

#### 7. Issues, in order (main releasable after each)

_[consolidated §4]_ The former issue 1 is the global W1 (controller, App
lookup) and W2 (door wording, `panel__links`, shortcuts heading), which
land before everything; the `useRowWindow` `scrollToIndex` and spacer-row
pattern is built in E4, not in W1. The rest are E1–E6:

1. **Lift `useEnzymeList`** (E1) and move `DoubleDigests` to its own file;
   UI unchanged; the filter text becomes a remembered value. Guard: all 25
   tests pass unchanged. Size S.
2. **The Enzyme workspace shell** (E2; needs W1, E1): store kind, `App`
   line, `enzymeWorkspace.ts`, `EnzymeWorkspace.tsx` with four pages
   mounting today's pieces as they are (the list, the Fragments section,
   `DoubleDigestsPage`, the import and custom form), Grown in in the head;
   the panel grows one door. Tests: workspace + store + App + PhoneShell
   cases. Size M.
3. **The slim panel** (E3) per §1, the guide intro and "The tab and the
   workspace", the shortcuts Escape row. Tests: slim cases; the 25 move to
   the Host. Size M.
4. **The enzyme table** (E4) with sorts (Name, Bands), keys, windowing
   (`scrollToIndex` + spacer rows, the pattern C4 reuses), the detail
   pane, the filter bar, Show listed / Hide all. Guide "The enzyme table".
   Size L.
5. **Digest, Double digests and Table pages** (E5; needs CL2) —
   `DigestFragments` over `useDigestPieces` with Add and the partial
   toggle, the wider gel, chips, **Open the Bench ›**; pairs as a table
   with pair lanes, `PAIRS_SHOWN` 20; the Table page tidied. Guide
   sections re-pointed; `CloningPanel.test.tsx:260` moves here. Size M.
6. **Look pass** (E6) — phone via a 390 px iframe of the dev server
   (memory), 500 px-high windows, both themes; the design note. Size S.
   Needs the maintainer's eyes, as items 107 and 129 did.

#### 8. Risks and open questions

- R1 _[consolidated D4: answered — no shared host; the Digest page hosts
  the Cloning hook's fragments table instead, with Add and the partial
  digest.]_ **Should the Cloning tab's Digest share this workspace?** Not now.
  The Cloning digest (`CloningPanel.tsx:363-450`) lists fragments with their
  ends and features, supports partial digests and puts pieces on the
  shelf; it reads the same ticks. Merging it means a Cloning-opened page
  inside `workspace: 'enzymes'`, which breaks `setWorkspace`'s invariant
  "workspace ⇒ sidebar on the tab of the same name" (editorStore.ts:
  2196-2201; CRISPR plan R9). Proposal: the Digest page shows the same
  fragments (lengths, spans, cutting enzymes) and hands over with **Join
  the pieces on the Bench ›**; the forthcoming Cloning plan decides whether
  the Cloning digest becomes a page of a Cloning workspace that imports
  `DigestPage`'s table. Build the fragments table so it can be hosted by
  either.
- R2 **Gel in the panel or not.** Moved, with the one-line reading kept.
  If the maintainer wants the picture in the tab, `Gel` at 320 px fits as
  today and the Digest page still has the wide one. Decide before issue 4.
- R3 **Grown in in the workspace head** is a document edit (undoable,
  dirties the file) sitting among view controls; the tooltip says so
  today. Alternative: keep it in the slim panel as the one setting that
  changes the answer (the CRISPR plan kept Nuclease for that reason).
  _[consolidated D9, Q2]_ Recommendation changed to **both**: the panel
  keeps today's row and the head repeats it, exactly as CRISPR's Nuclease
  is in both hosts; the Cloning link then needs no re-pointing. Maintainer
  to decide.
- R4 **Table size with REBASE**: ~1,500 rows need the tbody window (issue
  1); until then the Enzymes page would cap at `MAX_SHOW_LISTED` rows with
  a "filter the list" note.
- R5 **New column sorts** (Cuts, Overhang) extend `EnzymeSort`
  (enzymeSort.ts) and the persisted view prefs' validation (`isEnzymeSort`);
  an old stored value stays valid. _[consolidated D12]_ Decided: Name and
  Bands first; Cuts and Overhang filed as a follow-up issue.
- R6 **The filter text becomes remembered**, against the store's stated
  reason not to (editorStore.ts:706-710). Per document and forgotten on
  reload (`forgetPanels`), so the "forgotten word in the box" puzzle is
  only within a session; the panel shows the box, so the word is visible.
- R7 **The Fragments table's "enzyme at each end"**: _[consolidated D4:
  answered]_ `useDigestPieces` returns `PartialFragment.left/right` as
  `FragmentEnd`s with the enzyme name (`endLabel`, CloningPanel.tsx:40-43);
  no core change.
- R8 **Phone**: a seven-column table at 390 px collapses to cards via
  `.ws--phone .dt`; the Positions cell must be truncated or it is a wall.
- R9 **Gel scale**: `Gel.tsx` labels and lane widths are in SVG units, so
  a 2× `maxWidth` scales text too; may want a `wide` variant with more
  lanes rather than bigger text.
- R10 **Hovering a table row to highlight its sites** on the map would
  claim a preview owner `'enzymes'` (editorStore.ts:906-967) — a nice
  follow-up, not in scope; file as an issue. _[consolidated]_ For
  fragments it is answered by the hook's `'cloning'` preview on the Digest
  page; the enzyme table's hover stays the follow-up.
- R11 The `Workspace` kind must equal the sidebar tab id (`'enzymes'`), as
  for CRISPR.

#### Cohesion with Primers, Align and the CRISPR plan

Checked against the code at `071209f`, not from memory.

1. **Side-panel anatomy.** Primers (`PrimerPanel.tsx:68-225`): a
   `panel__group` fieldset with the target line, then **Design primers…**
   (`button button--primary primers__open`, id `DESIGN_BUTTON_ID`, :78-90),
   then "Last results ›"-style `link primers__last` rows, a Check fieldset
   with its own **Warnings, dimers… ›** `link primers__more` (:167), a
   primers-on-document list, and **My primers** as a `button primers__mine`
   (:210). Align (`AlignPanel.tsx:54-147`): a note, the input, the
   reference line, **Align** (`AlignAction primary`), the summary
   `role="status"` with **Results ›** (`link align__more`), then an
   `align__links` row: **Options and more ›** (id `align-workspace-open`),
   **Assemble reads ›**, **Multiple alignment ›**. So the two differ in
   wording ("Design primers…" primary button vs "Options and more ›"
   link) and in where the opener sits (top vs bottom). The CRISPR plan
   follows Align ("Open CRISPR workspace ›" link, last, in an `align__links`
   row). **This plan follows Align too**: order = primary input (Filter),
   summary (`role="status"`), the few rows, one-line gel reading with
   **Digest ›**, then a links row with **Open enzymes workspace ›** (id
   `enzyme-workspace-open`) and **Double digests ›**. Proposal for all
   four: the opener is the last control, a `link` with `›`, worded "Open
   X workspace ›"; Align's "Options and more ›" could be renamed to match
   (one string and one test, AlignPanel.tsx:119). Primers keeps "Design
   primers…" because it is the action, not a door. Rename the shared
   class `align__links` → `panel__links` when the third user arrives.
2. **Workspace shell.** One `WorkspaceShell` (WorkspaceShell.tsx:52-166):
   `region` labelled "`{name} workspace`", `.ws__top` with the title and
   "· doc name", a phone **Back** and a **Close** button, the `MapStrip`
   for `full`/`phone` (:106-118), the rail as a `tablist` with icons,
   labels and badges (:122-150), the heading focused on open (:24), Escape
   handled at the region with `defaultPrevented` respected (:69-73).
   `layout` comes from `App.workspaceAt` (App.tsx:89-93). Enzymes uses it
   as is; `name="Enzyme"` gives "Enzyme workspace" / "Close the enzyme
   workspace", matching "Primer workspace" and "Align workspace". Phone
   subtab: Enzymes is already in `DETAIL_TABS` (PhoneShell.tsx:29-34),
   the slim panel renders there; CRISPR adds its own (sixth).
3. **Tables.** `PrimerCandidates.tsx:422-510` is the reference: `<table
className="wst cands" role="grid">`, `SortTh` headers with `aria-sort`
   (SortTh.tsx:33), `toggleSort`/`nextRowIndex` from `tableKeys.ts`, rows
   with roving `tabIndex` (:489) and `aria-selected` (:490), the keyboard
   handler on the `tbody` (:481), the detail as an `<aside className=
"detail">` (:144) in a `checkgrid` beside or under. The enzyme, fragment
   and pair tables use exactly these, as the CRISPR plan's guide table
   does. Deliberate addition: windowed rows (REBASE size), built once.
4. **State.** Primers: `useRemembered` slots `primers.workspace`,
   `primers.shown`, `primers.targetMode` plus `primerDesign.ts` per-design
   slots. Align: `alignSession.ts` (external store) for the run, and
   `useRemembered('align.workspace')` for the page (AlignWorkspace.tsx:59).
   CRISPR: a session store like Align's. Enzymes: `useRemembered` only,
   slots `enzymes.*` (§3), because nothing asynchronous lands in it — the
   deliberate difference, with the reason. Naming rule for all four:
   `<tab>.workspace` for the page, `<tab>.<thing>` for the rest, per
   document, forgotten by `forgetPanels`. The open/close/focus functions
   are the same 40 lines in `primerWorkspace.ts:54-83` and
   `alignWorkspace.ts:28-55`; the third copy should instead be a shared
   controller (§9).
5. **Preview owner.** `setPreview(owner, …)` (editorStore.ts:2449) with
   owners `'align'`, `'cloning'`, `'find'`, `'crispr'`, `'pcr'`,
   `'collection'`, `'orfs'`, and primers through `primerDesign`. Each
   workspace draws through its owner and clears on unmount. Enzymes
   deliberately claims none: the ticks are first-class state the views
   already draw (`visibleCutSites`). R10 would add `'enzymes'` for hover
   highlighting later, through the same channel.
6. **Empty, loading, error.** Align: "Aligning…" (`panel__note`,
   AlignWorkspace.tsx:235), stale note in the head as `ws__sub ws__sub--note`
   `role="status"` (:119), disabled page while stale (:255), and
   `MsaRunNotices` (:13-37): `panel__error` for a message, a `role="alert"`
   block with the plain sentence, a `<details>` with the technical text and
   **Try again** (`button button--small`), plus a `role="status"` "This is
   taking a while" with the run's own Cancel. Primers: `panel__note` for
   "No design yet" / "No suitable pairs" (PrimerCandidates.tsx:291-296),
   `panel__note--quiet` for "No pair matches the filter" (:520). Enzymes
   uses the same classes: "Scanning for restriction sites…" as the
   `panel__note` loading line in both hosts; the Digest page disabled with
   nothing ticked and a `ws__sub--note` in the head saying so; the filter's
   empty result as `panel__note--quiet`; no worker error path exists for
   the scan today (the scan's failure surfaces in the store), so no
   `MsaRunNotices` copy — if a scan failure is ever shown, reuse that
   component's shape rather than new copy.
7. **Copy and action names.** Existing verbs: "Add as feature", "Add N
   listed as features", "Tick both", "Show listed", "Hide all", "Select
   the … fragment", "Results ›", "Options and more ›", "Design primers…",
   "Find a partner for X". Enzymes keeps the tick vocabulary ("Tick",
   "Untick", "Tick both", "Tick the N enzymes that cut once") because the
   guide and the Cloning tab use it (12-cloning.md:30), and uses "›" for
   every door into the workspace, "…" only for dialogs. Detail actions are
   "Select" (a site) and "Find a partner ›", not "Details"; the detail pane
   opens on the row click as in Results, so no "Details" button is needed
   (the CRISPR plan's panel has one because its rows select the map
   first).
8. **Guide and shortcuts.** 10-primers.md has "The Primers tab" (:14) and
   "The primer workspace" (:31); 11-align.md one section "The tab and the
   workspace" (:8). The CRISPR plan takes Align's title; so does this plan.
   The shortcuts page's one table (14-shortcuts.md:131-150) names every
   opener in the Escape row and covers every `wst` table in the "Results
   table" paragraph; heading "Workspaces".
9. **Build once, shared** (and who first) — _[consolidated §3 and §4
   decide this; the list below is kept as the record of what was asked.
   Differences: the opener is the first link of the row, not the last;
   `useRowWindow`'s table variant is `scrollToIndex` + spacer rows in E4;
   `RunNotices` is C4's; `createDocumentSession` is C1's.]_
   - `workspaceController.ts` — open/close/`takeFocusRequest`/page memory
     generic over `Workspace` kind and slot; replaces the duplicated
     functions in `primerWorkspace.ts` and `alignWorkspace.ts`. First
     plan to land (CRISPR issue 2 or Enzymes issue 1); the other adopts.
   - `useRowWindow` for a `tbody` — Enzymes needs it at 1,500 rows, CRISPR
     at 25,000. Enzymes issue 1 builds it (smaller, bounded case).
   - `App.tsx:285` splitter label and `workspaceAt` as a lookup keyed by
     `Workspace`, so the fourth kind is one line.
   - `panel__links` (rename of `align__links`) and the opener wording
     "Open X workspace ›" — Enzymes issue 4, touching Align's string.
   - The shortcuts heading and the Escape row — whichever lands first.
   - `MsaRunNotices` generalised to `RunNotices({error, stopped, slow,
busy, retry})` when a second worker run needs it (CRISPR's scan is
     the candidate; Enzymes does not need it).
   - The `.dt` phone collapse and `checkgrid` detail layout: already shared
     CSS; no work, but each plan must use those classes rather than new
     ones.

**Deliberate differences, summarised:** no session store (nothing lands
asynchronously); no preview owner (the ticks are already drawn); the
opener is a link at the foot (Align's shape, not Primers' primary button);
Grown in lives in the workspace head rather than the slim panel (R3 to
decide); windowed table rows (a need Primers' tables never had).

## Appendix C. Cloning panel plan

Read-only design pass, 2026-11-05, against 1.22.0 (`071209f`). Models: item
107 (primer workspace), item 129 (Align workspace), item 49 (the Bench), and
the sibling plans `Appendix A` and `Appendix B`
(same folder), whose shared pieces are reused, not reinvented. UI only: no
change to `src/core` (digest, partial digest, pcr, mutagenesis, cloning
ends, clone check) and no algorithm change anywhere.

**Superseded where it differs by `this note`** (same
folder, 2026-11-05): the `primers.mode` slot (D6), the `panel__links`
rename belonging to W2 (D10), the fragments table named `DigestFragments`
(D4), the PCR gel recommendation (Q3), the global issue order (§4). The
amendments below are marked _[consolidated]_.

#### 0. What is there today

- `src/app/components/CloningPanel.tsx` (501 lines): the Reaction picker
  (343-360, `SIDEBAR_REACTIONS`, cloningReaction.ts:31-47), then one of
  three bodies. **Digest** (363-476): heading "Digest with ticked enzymes"
  with every enzyme named (365-370), four states (371-415: scanning,
  all blocked by methylation with a **Grown in** link to the Enzymes tab,
  nothing ticked with a **Tick enzymes** link, or "N fragments, largest
  first … Add the ones to join to the shelf, and join them on the Bench"),
  **Partial digest** (416-431, `cloning.partial` remembered), the "left out"
  and "cut sites hidden" notes (432-444), then `FragmentRow`s (68-180: length
  button, range, Add/Add again/Added ✓, Open, two `EndTag`s, "On shelf ×n",
  feature names) in a `ul.fragment-list` that scrolls inside itself
  (styles.css:4277-4280). **PCR** (478-486) mounts `PcrPanel` (576 lines):
  Template select with more than one tab (349-371), two boxes with a
  `PrimerReport` under each (372-411: length, tail, Tm on template and on
  product, sites, mismatches), Polymerase (412-432), 5′-phosphorylated
  (433-445), dimers (447-457), the three-line "Paste the two oligos…"
  paragraph (459-464), products with Show/Shelve/Open (480-547), a one-lane
  `Gel` (556-571). **Mutate** (488-496) mounts `MutagenesisPanel` (387
  lines): selection line, codon helper, Change to, Back to back /
  Overlapping, the two primers, **Open mutant** (293-386). Then
  `ShelfSummary` (498; 30 lines: "The shelf is empty… Open the Bench").
- Preview: the digest owns `'cloning'` only while Digest is picked
  (306-312) and clears on unmount (329-334); a click on a drawn fragment
  shelves it through `previewActivated` (320-327). PCR owns `'pcr'`
  (PcrPanel.tsx:304-309); a click opens the product (331).
- State already in the store: `sidebarReaction` (shared, persisted,
  editorStore.ts:736-741), `shelf` with its own undo (`changeShelf`, 2850),
  `shownEnzymes` per document, `bench: BenchSettings` (persisted,
  benchSettings.ts). Panel memory: `cloning.partial`, `pcr.*` (12 slots,
  PcrPanel.tsx:237-269, written from outside by `sendToPcr`,
  primerToPcr.ts:19-28), `mutagenesis.*` (234-246). Nothing asynchronous
  lands in the panel: the digest waits on `analysis` (`!ready`, 247-249).
- **The Bench** is already the full-screen place: a `FrontTab`
  (`'bench'`, editorStore.ts:1024), not a `Workspace`; it replaces the
  document rather than the sidebar column (App.tsx:152-155), opens from the
  tab strip, **Alt+0** (keyBindings.ts:176; 14-shortcuts.md:26) or the
  panel's link (`showBench('tab'|'link'|'key')`, editorStore.ts:1549-1556).
  Three columns (Bench.tsx:38-83): shelf, the six reactions (cloningReaction.ts
  :49-76), the product with Check by digest and **Design check primers…**
  (`openCloneCheck`, cloneCheck.ts:421-432, which opens the product and the
  primer workspace on Clone check).
- **The primer workspace already holds "clone an insert into this plasmid"**:
  `DesignMode = 'plain' | 'cloning'` (primerWorkspace.ts:33) in the
  `primers.workspace` memory (:41, `{page, mode}`), the mode switch on the
  Design page (PrimerDesignPage.tsx:151-166, labels "Primers on this
  sequence" / "Clone an insert into this plasmid"), `CloningDesign` (:174)
  with `GoldenGateEnds` inside it (CloningDesign.tsx:648), `CloningCandidates`
  on Results (PrimerWorkspace.tsx:241) with **Simulate**, **Check
  primers…**, **Save**, **Use in PCR** (CloningCandidates.tsx:211-274).
  `openPrimerWorkspace(documentId, page?)` (primerWorkspace.ts:54-58) sets
  the page but not the mode.
- The bridge from designs to the PCR panel exists one way: `sendToPcr` +
  `openPcr` (primerToPcr.ts:19-42) from Results, a Golden Gate part, Clone
  check and My primers (callers at CloningCandidates.tsx:270-274,
  GoldenGatePartResult.tsx:149-152, CloneCheckPage.tsx:138-140,
  PrimerCollection.tsx:434).
- Two other primer designs live on the Bench, beside their reaction:
  In-Fusion/NEBuilder tails inside the Gibson panel (GibsonPanel.tsx:285,
  `OverlapPrimerDesign`, #63) and SOE primers inside Overlap PCR
  (SoePanel.tsx).
- Phone: no Bench (App.tsx:152, item 49) and no Cloning subtab
  (PhoneShell.tsx:29-34). Unchanged by this plan.
- Tests pin the tab's copy: `DigestPcrTutorial.test.tsx` renders
  `<CloningPanel>` alone (:53) and asserts "3 fragments, largest first.",
  "The shelf is empty.", "The shelf holds 1 part, 834 bp.", "One product:",
  Add/Added ✓/Show/Hide/Shelve/Open (:81-183); `CloningPanel.test.tsx` (15
  tests, with the Bench beside it when asked, :27-37); `hostMethylation.test.tsx
:250-266` expects the **Grown in** button and the "left out" sentence.
  The tutorials say "pick **Digest** under **Reaction**", "read the three
  rows", "**Add** on the 834 bp row", "**Open** on the 1,830 bp row", "the
  link at the bottom of the Cloning tab" (digest-pcr.md:22-184,
  ligation.md:16-117, in-fusion.md:25-105, mutagenesis.md:8-247).

#### 1. The answers

**(a) Link to the primer view, do not copy it.** The Cloning panel gets one
door, **Clone an insert into this plasmid ›**, the Design page's own mode
label (PrimerDesignPage.tsx:163), which calls
`openPrimerWorkspace(documentId, 'design', 'cloning')`. The only code
change behind it is an optional third argument. _[consolidated D6]_ After
W1 the mode is its own slot `primers.mode` (the controller remembers the
page alone under `primers.workspace`, as every workspace does), so the
argument is one `rememberPanel('primers.mode', id, mode)` before
`primers.open(id, page)`; `recallWorkspace()` stays as a facade over both
slots for the page and the tests that read it. Nothing of
`CloningDesign`, `CloningCandidates` or `GoldenGateEnds` moves or is
duplicated; the user lands on the page with the same words lit.

How PCR overlaps with the workspace: the per-oligo report under each PCR box
(PcrPanel.tsx:84-131) says what the Check page's probe says (length, Tm,
sites, mismatches), and the dimer list (447-457) is the Check page's dimer
warning. What only PCR has is the **product**: `pcr()` with the polymerase's
reach and A-tail, 5′ phosphates for the shelf, Show on the views, Shelve,
Open with primer features, the gel. So PCR is the _sink_ every design pours
into (`sendToPcr` from four places) and the step that makes a part; it
stays in the sidebar, slimmer. Its report lines stay (the tutorial pins
"22 nt — no 3′ end long enough to prime", digest-pcr.md:184); the fuller
check is a door: **Check ›** beside each box, the reverse of `sendToPcr`
(writes `primers.probe`, primerDesign.ts:375, and opens the Check page).
Optional, issue 5.

**(b) The slim panel keeps** the Reaction picker, a one-line status per
reaction, the rows that make parts (fragments with Add/Open, PCR products
with Show/Shelve/Open, the two mutagenesis primers with Open mutant), the
shelf line, and a links row with two doors. It **loses** the enzyme roll-call
in the heading, the three-line paragraphs, the partial digest, the feature
names and ranges as a third row (they become the row's tooltip), the
polymerase and phosphate controls as always-open fields (a closed
`<details>` "Options"), and the PCR gel when there is one product (R2).
What moves goes to the Bench (nothing new: joining was there already) and
to the enzymes workspace's Digest page (the full fragments table, the
partial digest) — see (c).

**(c) No new workspace. The Bench is the workspace**, and the three
"advanced" homes already exist: joining → the Bench; designing the primers
that make a part → the primer workspace in cloning mode; which enzymes, the
gel, every fragment → the enzymes workspace (sibling plan). A fourth
`Workspace` kind `'cloning'` is possible (it is a sidebar tab id,
editorStore.ts:142, so `setWorkspace`'s invariant holds) but would hold
only what the panel loses: a 200-row partial digest list and a wider PCR
product list. That is not a workspace, it is a page of someone else's.
**Enzymes plan R1 confirmed** (the Cloning digest does not share
`workspace: 'enzymes'` as a _host_), with one amendment: the fragments table
the enzymes plan builds for its Digest page (its §2 "Digest", R7) is the
digest fragment list's better home, and it gets the **Add** (shelve) action
by hosting the same `useDigestPieces` hook the slim panel uses (§3). Its
"Join the pieces on the Bench ›" link then becomes **Open the Bench ›**
after Add, the Bench tab's count pulsing as it does for the panel (item 49,
#81). The partial digest toggle moves there with the list (`cloning.partial`
→ `enzymes.partial`): a partial digest is an enzyme question (which sites
are missed), and its 200 rows need the table's room.

**(d) One path per task**, in the navigation:

| Task                                                                      | Entry                                                                                                           | Where it happens                                                                                                               |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cut this document, keep pieces                                            | Cloning ▸ Digest                                                                                                | slim panel rows; all fragments and partial digest on Enzymes workspace ▸ Digest (door: **All fragments and partial digest ›**) |
| Amplify a stretch with two oligos                                         | Cloning ▸ PCR                                                                                                   | slim panel; products Shelve/Open                                                                                               |
| Change bases, design the primers                                          | Cloning ▸ Mutate                                                                                                | slim panel (already slim)                                                                                                      |
| Design the primers that clone an insert (restriction or Golden Gate ends) | Cloning ▸ **Clone an insert into this plasmid ›**, or Primers ▸ Design primers… ▸ mode switch                   | primer workspace Design (cloning mode) → Results → Simulate / Use in PCR                                                       |
| Join parts: Ligation, Golden Gate, Modular, Gibson, Overlap PCR, Gateway  | Bench tab, Alt+0, Cloning ▸ **Open the Bench ›**                                                                | the Bench (unchanged)                                                                                                          |
| In-Fusion/NEBuilder tails, SOE primers                                    | Bench ▸ Gibson, Bench ▸ Overlap PCR                                                                             | beside their reaction (unchanged; R4 asks whether they should join cloning mode later)                                         |
| Check a clone by digest                                                   | Bench product column                                                                                            | Check by digest (unchanged, item 132)                                                                                          |
| Check a clone by colony PCR                                               | **Design check primers…** on a Bench product; **Check primers…** on Simulate; Primers tab "Check a clone · … ›" | primer workspace Clone check page (`CloneCheckPage`, unchanged)                                                                |
| Verify sequenced clones                                                   | File ▸ Verify clones…                                                                                           | dialog (item 80, unchanged)                                                                                                    |

The Cloning panel does not list the Bench reactions or the clone check: the
guide's new section (§5) is the map; the panel has the two doors.

#### 2. What each surface keeps and what moves

**Slim Cloning panel** (`CloningPanel.tsx` ~250 lines with `PcrPanel`
slimmed separately):

1. The **Reaction** picker as now (343-360). Kept at the top, unlike the
   sibling panels' "primary input first", because the three bodies share
   one preview channel and the tutorials name it ("pick **Digest** under
   **Reaction**", digest-pcr.md:22).
2. **Digest**: a status line `role="status"` merging the heading note and
   the count paragraph: "EcoRI, BamHI: 3 fragments, largest first." (the
   regex `/^3 fragments, largest first\./` in DigestPcrTutorial.test.tsx:87
   becomes `/3 fragments, largest first\./`; the tutorial prose is the
   same). The three recovery states stay as they are (371-405) — the
   **Tick enzymes** link keeps opening the Enzymes tab (the slim Enzymes
   panel can tick, enzymes plan §4) and **Grown in** opens the enzymes
   workspace once it exists (enzymes plan §4 already re-points it). The
   "left out" note (432-439) stays (hostMethylation.test.tsx:262-265). The
   "cut sites hidden" note (440-444) stays, one line. The rows become two
   lines instead of three: length button · ends · Add · Open on the first,
   the `EndTag`s with "On shelf ×n" on the second; the range and the
   feature names go into the row's `data-tip` (the row already has one for
   the range, 130-132). Complete digest only; largest first; the list keeps
   its own scroll (styles.css:4277). Under the list a door, **All fragments
   and partial digest ›** → `openEnzymeWorkspace(documentId, 'digest')`,
   shown once the enzymes Digest page exists (issue 4).
3. **PCR**: Template (as now, only with more tabs), the two boxes with their
   report lines, then `<details class="panel__options">` "Options"
   (Polymerase, its reach line, 5′-phosphorylated) closed by default, the
   dimers list, the status line "One product:" / "N products, the cleanest
   and shortest first:" (469-473, pinned by the tutorial), the products as
   now (480-547), the "more pairings" note, and the gel only with two or
   more products (R2). The empty-state paragraph (459-464) shrinks to one
   sentence: "Paste the two oligos, written 5′ to 3′; only their 3′ ends
   have to match {template}." with the rest in the guide (12-cloning.md:
   182-189 already says it). **Check ›** beside each box (issue 5, optional).
4. **Mutate**: unchanged. It is the shape the others are being cut to.
5. The **shelf line** (`ShelfSummary`) stays, its words pinned by the
   tutorial, but its link moves into the links row below.
6. A `panel__links` row (the shared class, Cohesion §1): **Open the Bench ›**
   (`showBench('link')`, `data-tip` "The shelf, and the reactions that join
   parts from any tab (Alt+0)") and **Clone an insert into this plasmid ›**
   (`openPrimerWorkspace(documentId, 'design', 'cloning')`, `data-tip`
   "Primers with restriction or Golden Gate ends on an insert from another
   tab, in the primer workspace"). The latter is hidden for a linear
   document? No: `CloningDesign` takes any DNA document as the vector
   (item 108 decision 2 handles "whole"); shown always for DNA.

**The Bench**: unchanged. It is the full-screen place; the plan adds no
column and no reaction. The product column's **Design check primers…**
stays the clone check's entry.

**The primer workspace**: unchanged but for the `mode` argument and, on the
Design page in cloning mode, one `panel__note` under the mode switch:
"Gibson, In-Fusion and overlap-PCR tails are designed on the Bench beside
their reaction." with a `link` **Open the Bench ›** (`showBench('link')`;
`setCloningReaction('gibson')` is not forced — the Bench remembers its
reaction). This is the signpost for the one task that still has two homes
(R4).

**The enzymes workspace's Digest page** (sibling plan, its issue E5):
hosts `useDigestPieces` through `DigestFragments.tsx` _[consolidated D4]_
— the `wst dt` table with #, length,
span, the enzyme at each end (their R7: derived UI-side from the hook's
`FragmentEnd`s, which `digest` already returns, so R7 is answered: no core
change), features, "N sites uncut" with the partial toggle on, and **Add**
per row; hovering a row lights the fragment on the map through the hook's
preview (their R10 is then answered for fragments, not for enzymes).

#### 3. State sync between surfaces

Nothing new is stored; one hook is lifted and one function grows an
argument.

- **Shelf**: the store's `shelf` with `addToShelf`/`changeShelf` (its own
  undo while the Bench is in front, item 49). Add in the panel, Add on the
  Digest page, Shelve under a PCR product, Remove on the Bench all go
  through it; the Bench tab's count and the panel's shelf line read it.
- **Ticked enzymes**: `shownEnzymes` per document. The digest reads
  `sites.pick(shownEnzymes)` (255); a tick in the Enzymes panel, its
  workspace or Tick both changes it; the Cloning panel re-renders. Nothing
  to build.
- **Selection**: the store's. A fragment's length button selects and reveals
  (454-457); Mutate reads the selection (232-249); PCR ignores it.
- **Preview**: owners `'cloning'` (digest) and `'pcr'` stay. `useDigestPieces
(doc)` (new, `components/digestPieces.ts`) lifts CloningPanel.tsx:240-334
  — `sites`, `ready`, `tickedSites`, `cutSites`, `blocked`, `enzymesUsed`,
  `listed`, `total`, `hovered`, the preview effect, the `previewActivated`
  click-to-shelve with its mount-seeded nonce, the unmount clear — and
  takes `{partial}` as an argument (the panel passes `false`, the Digest
  page its toggle). Both hosts call it; they are never mounted at once: the
  sidebar drops its panel while any workspace is open (Sidebar.tsx:54).
  So the `'cloning'` owner is held by whichever host is up, and the
  CloningPanel tests at :92-140 and :298-330 (draw, light, click shelves
  once, ignore another owner, not twice on return, clear on leave) become
  the hook's tests through the panel.
- **Reaction**: `sidebarReaction` shared and persisted (store 736-741);
  `openPcr` keeps setting it (primerToPcr.ts:39-42).
- **Primer mode**: the `primers.mode` slot _[consolidated D6]_, written by
  the Design page's switch and by `openPrimerWorkspace(id, page, mode?)`.
  The Primers tab's own **Design primers…** keeps passing no mode (the
  remembered one wins).
- **PCR slots**: `pcr.forward`, `pcr.reverse`, names, template, shown —
  unchanged, written by `sendToPcr`. Issue 5's **Check ›** writes
  `primers.probe` the same way (one `rememberPanel`), then
  `openPrimerWorkspace(id, 'check')`.
- **Partial digest**: `cloning.partial` → `enzymes.partial` (per document,
  forgotten by `forgetPanels`), read only by the Digest page.
- **No session store** (the Enzymes plan's reason, Cohesion §4): the digest
  and the PCR are synchronous memos over store state; the only wait is the
  scan, which is the store's `analysis`.

#### 4. Reused unchanged vs changed

Unchanged: `src/core` entirely; `Bench.tsx`, `BenchProduct.tsx`, `ShelfPanel`,
every Bench reaction panel, `benchSettings.ts`, `cloningReaction.ts`;
`CloningDesign.tsx`, `CloningCandidates.tsx`, `GoldenGateEnds.tsx`,
`GoldenGatePartResult.tsx`, `CloneCheckPage.tsx`, `cloneCheck.ts`,
`PrimerDesignPage.tsx` (plus one note), `PrimerWorkspace.tsx`;
`primerToPcr.ts`; `MutagenesisPanel.tsx`; `WorkspaceShell.tsx`; the store
(no new kind, no new field); `App.tsx`; `PhoneShell.tsx`; `Sidebar.tsx`;
`analytics.ts` (`cloning`/`bench` with `link` already covers the door,
296-307; `primers`/`design-cloning` covers the mode; add nothing).

Changed: `primerWorkspace.ts:54-58` (`mode?: DesignMode`); `CloningPanel.tsx`
(slim; `FragmentRow` two lines; the status line; the links row);
`ShelfSummary.tsx` (the link leaves it for the links row, or the component
is folded into the panel — 30 lines); `PcrPanel.tsx` (Options disclosure,
one-sentence empty state, gel rule, optional Check ›); new
`components/digestPieces.ts`; `styles.css`: `.panel__links` and
`.panel__door` used as W2 defines them _[consolidated D10: the rename is
W2's, not this plan's]_,
`.fragment` rules trimmed to two lines, `.panel__options` for the
disclosure if `details` has no shared style yet; the enzymes plan's
`DigestPage.tsx` hosts the hook (their issue 6). Guide and tutorials as §5.

#### 5. User guide, tutorials, help index

- `docs/guide/12-cloning.md`: the intro (1-27) becomes **"The tab, the Bench
  and the primer workspace"** on the model of 11-align.md:8 "The tab and the
  workspace": what the tab holds (the picker, the rows, the two doors),
  what the Bench is (one paragraph, the section at 252 keeps the detail),
  and that the primers for an insert are designed in the primer workspace
  (link to 10-primers.md#cloning-ends…). The task table of §1(d) goes here
  in prose, one sentence per task. "Digest" (28-101): the rows' two lines,
  the tooltip; **Partial digest** (78-89) re-pointed to the enzymes
  workspace's Digest page (link 07-enzymes.md, its "Fragments" heading —
  the enzymes plan keeps that anchor). "PCR" (160-251): Options
  disclosure, the gel rule, **Check ›**; the "PCR fwd / PCR rev from My
  primers" sentence (170-173) still true. "The shelf" (324): "**Add** in
  the digest, and on the enzymes workspace's Digest page". "Protocol for a
  product" (884): its "sites a partial digest left uncut" line (855) still
  true.
- `docs/guide/10-primers.md`: "The Primers tab" (14-29) unchanged; "Cloning
  ends" (128-136) adds one sentence: the Cloning tab's **Clone an insert
  into this plasmid ›** opens this mode directly; the Bench note about
  In-Fusion and overlap-PCR tails.
- `docs/guide/14-shortcuts.md`: nothing. `Alt+0` is there (26); the Escape
  row (142) still names **Design primers…**, where the keyboard lands when
  the workspace was opened from the Cloning tab too (R1). No binding is
  touched.
- `docs/guide/README.md:19` (entry 12): "the slim Cloning tab with its
  doors to the Bench and the primer workspace; digest, PCR and …".
- `src/app/help/guide.ts`: no change (`12-cloning` registered, :48);
  `guide.test.ts` catches a renamed anchor — keep "The Bench", "The shelf"
  and "Digest" headings, which 10-primers.md and 14-shortcuts.md link.
- **Tutorials** (`docs/tutorials/`, each pinned by a test): digest-pcr.md
  steps 7, 15 ("read the three rows": still three rows, now two lines each
  — the end text `EcoRV blunt to EcoRI 5′ AATT` is in the row, the range
  moves to its tooltip, so step 16's "range `4–316`" becomes "hover for
  the range" or is dropped), steps 75 and 106 ("the link at the bottom of
  the Cloning tab": now **Open the Bench ›** in the links row, still at the
  bottom), step 119 ("Under it a gel draws one band": dropped with R2),
  step 184 (unchanged copy). ligation.md:16-117, in-fusion.md:25-105 and
  mutagenesis.md use Add/Open/the picker only: unchanged. before-you-start.md
  mentions the Bench link: check once. `DigestPcrTutorial.test.tsx` updates
  with the page in the same commit (issue 3).
- `docs/design/NNN-cloning-panel.md` + README index line (the next free
  number at build time) _[consolidated D11]_.

#### 6. Tests

Must survive, and where:

- `CloningPanel.test.tsx` (15): :62 (one of three) — panel; :92, :104, :119,
  :298, :309, :330 (preview, light, click shelves, other owner, not twice,
  clear) — through the hook, rendered by the panel as now; :141 (On shelf,
  Added ✓) — panel; :188, :221, :246, :279 (ligation order, lineage, Open
  fragment, dephosphorylated) — panel + Bench as now; :260 (partial digest)
  — moves to the enzymes `DigestPage` test when issue 4 lands, until then
  unchanged; :372, :395 (provisional sites, rescan) — hook through the panel.
- `PcrPanel.test.tsx` (10): all through the slim PCR; :91 (Taq) opens the
  Options disclosure first (`details` renders in jsdom; click the summary);
  :193 (draws every product) and :211 (click opens) unchanged.
- `MutagenesisPanel.test.tsx` (7), `MutagenesisTutorial.test.tsx` (8):
  untouched.
- `DigestPcrTutorial.test.tsx` (5): regexes loosened as §2.2; "The shelf is
  empty." kept; gel assertion none today (no change).
- `hostMethylation.test.tsx:250-266`: the **Grown in** button and the "left
  out" sentence kept.
- `CloningDesign.test.tsx` (9), `PrimerWorkspace.test.tsx` (25),
  `PrimerPanel.test.tsx` (5), `CloneCheckPage.test.tsx` (4),
  `BenchProduct.test.tsx` (6), `assembly.test.tsx` (19), the Gibson,
  Gateway, OverlapPcr, Modular tutorial tests, `ligationCheck.test.tsx`:
  untouched.

New:

- `primerWorkspace.test.ts`: `openPrimerWorkspace(id, 'design', 'cloning')`
  writes `{page: 'design', mode: 'cloning'}`; without a mode the remembered
  mode stands.
- `CloningPanel.test.tsx` slim cases: the status line names the enzymes and
  the count; a row's tooltip carries the range and the feature names; the
  links row: **Open the Bench ›** sets `front: 'bench'` (and `analytics`
  `cloning/bench/link`), **Clone an insert into this plasmid ›** sets
  `workspace: 'primers'`, `sidebarTab: 'primers'` and the mode; the door is
  absent for a protein (`hasSidebarTab`).
- `PcrPanel.test.tsx`: Options closed by default and remembered open?
  (no — not remembered; one case: closed, opens, Taq reachable); the gel
  absent with one product, present with two; **Check ›** writes
  `primers.probe` and opens the Check page (issue 5).
- `digestPieces.test.tsx`: the hook with `partial: true` lists at most
  `MAX_LISTED` and draws only the hovered piece (today's :260 case).
- Enzymes `DigestPage` test (their issue 6, amended): Add on a row shelves
  it; the Bench count follows.
- `format:check`, `tsc -b` and `npm test` (CI's `with-tmp.mjs` path, per
  memory) in every brief.

#### 7. Issues, in order (main releasable after each)

_[consolidated §4]_ These are CL1–CL6 of the global list. W1 (controller)
and W2 (door wording, `panel__links`) land first; CL1 follows W2.

1. **Two doors and the mode argument** (CL1; needs W2). `openPrimerWorkspace`
   mode via `primers.mode`; the Cloning `panel__links` row with **Open the
   Bench ›** and **Clone an insert into this plasmid ›**; `ShelfSummary`
   loses its link; the Design page's Bench note; guide intro section and
   10-primers sentence; tutorial lines 75/106. Size S.
2. **Lift `useDigestPieces`** (CL2). UI unchanged; the 15 tests as the
   guard. Size S. Any time; no store or `App` change. E5 needs it.
3. **Slim Digest and PCR** (CL3; needs CL1). Status lines, two-line rows
   with tooltips, the Options disclosure, the one-sentence empty state,
   the gel kept always unless Q3 says otherwise; digest-pcr.md and its
   test, the guide's Digest and PCR sections. Size M. `CloningPanel.tsx:
375-401` is not re-pointed by the Enzymes plan any more (D9), so no
   merge conflict.
4. **The partial digest moves to the Enzyme workspace** (CL4; needs CL3,
   E5): the panel's **All fragments and partial digest ›** door;
   `cloning.partial` and the panel's toggle removed (E5 already hosts the
   hook with Add, hover preview and the `enzymes.partial` toggle); guide
   "Partial digest" re-pointed. Size S.
5. **Check › from a PCR box** (CL5, optional; needs CL1): `sendToProbe`,
   the link, a test, one guide line. Size S.
6. **Look pass + design note** (CL6): 320 px panel with the three bodies,
   both themes, 500 px-high windows (no phone: the tab is not on the
   phone). Size S. Needs the maintainer's eyes, as 107 and 129 did.

Sequencing with the others: the consolidated plan's §4 line (W1 → W2 →
CL1 → {CL2, E1, C1} → … → E5 → CL3 → CL4). Nothing here waits on CRISPR;
CL3 can be pulled earlier if hands are free.

#### 8. Risks and open questions

- R1 **Escape lands on the Primers tab, not Cloning.** Opening the primer
  workspace from the Cloning tab sets `sidebarTab: 'primers'`
  (`setWorkspace`, editorStore.ts:2196-2201); Escape returns the keyboard
  to **Design primers…** (primerWorkspace.ts:73-83). The user is in Primers
  land after that, which is honest (the design lives there). A "return to
  the tab that opened it" would need a store field; not proposed.
- R2 **The PCR gel only with two or more products** is a visible change the
  tutorial describes (digest-pcr.md:119). Alternative: keep it always.
  Maintainer to decide before CL3. _[consolidated Q3]_ Recommendation:
  keep it always — one lane fits at 320 px and the tutorial stays true.
- R3 **Shelving from the enzymes workspace** puts Add on a page whose sidebar
  tab is Enzymes. The Bench tab's count still pulses (item 49, #81) and the
  shelf line is one tab away. Acceptable; it is the same hand-over the
  enzymes plan proposed, with the click saved.
- R4 **Two homes for "design the primers for a method"**: restriction and
  Golden Gate ends in the primer workspace; In-Fusion/NEBuilder and SOE on
  the Bench beside their reaction (#63, #216). Item 113 showed how an ends
  option joins cloning mode ("an option inside that same mode"); a third,
  **Homology ends** (kit, overlap length), would take `OverlapPrimerDesign`'s
  inputs (vector tab, template tab, insert, kit; benchSettings.ts
  `overlap`) — a real move, with the Gibson tutorial and its test behind
  it. File as an issue; the signpost note in §2 is this plan's answer.
- R5 **Pinned copy.** Every string in Digest and PCR is asserted by
  `DigestPcrTutorial.test.tsx` and read in the tutorial page; issue 3's
  cost is mostly keeping those three in step (page, test, panel) in one
  commit.
- R6 **No phone Cloning subtab** stays as is: the phone is a reader (item
  49, 107 point 6). The sibling plans add Details subtabs because their
  tabs exist there already (Enzymes) or are asked for (CRISPR); Cloning
  needs the Bench, which the phone lacks.
- R7 **"Open mutant" and the digest's "Open" switch the sidebar to Features**
  (MutagenesisPanel.tsx:290; CloningPanel.tsx:466). Kept: there is no
  workspace here for the switch to shut (the CRISPR plan's R4 reason does
  not apply).
- R8 **The picker stays a segmented control**, not three sections, although
  the sibling panels have no picker: three bodies on one preview channel
  (item 49) and the tutorials' wording. If the maintainer wants the sibling
  shape, the picker could become the first line of the status, "Digest ·
  PCR · Mutate" as links; same store field.
- R9 **The Digest page's enzyme-at-each-end** (enzymes plan R7) is answered
  by the hook: `PartialFragment.left/right` are `FragmentEnd`s with the
  enzyme name (`endLabel`, CloningPanel.tsx:40-43). No core change.

#### Cohesion with Primers, Align, CRISPR and Enzymes

Checked against the code at `071209f`.

1. **Side-panel anatomy and the doors.** Primers: fieldsets with the
   primary **Design primers…** first (PrimerPanel.tsx:69-91), `link
primers__last` rows (:93-115), `link primers__more` **Full check ›**
   (:165-174), `button primers__mine` last (:208-220). Align: note, input,
   action, `align__summary role="status"` (AlignPanel.tsx:70-106), then the
   `align__links` row (:108-145) with **Options and more ›** (id
   `align-workspace-open`, :23). CRISPR and Enzymes follow Align: the door
   is the last control, a `link` with `›`, in the links row. **Cloning
   follows Align too**: picker, body, status line `role="status"`, rows,
   shelf line, then `panel__links` with **Open the Bench ›** and **Clone an
   insert into this plasmid ›**. Deliberate differences: (i) no "Open X
   workspace ›" because Cloning has no workspace — the doors name where
   they go, as Align's **Assemble reads ›** and **Multiple alignment ›**
   name pages; (ii) the Reaction picker stays first (R8); (iii) no Escape
   return id of its own (R1). _[consolidated D10]_ The `align__links` →
   `panel__links` rename (styles.css:7240) is W2's; CL1 uses the class.
2. **Shell, header, page tabs, Escape, phone.** Not used: the panel opens
   other surfaces. The Bench's chrome is its own (Bench.tsx:38-83; three
   `section`s, a segmented picker, `panel__heading` with a note) and is not
   a `WorkspaceShell` because it is a `FrontTab` across documents with no
   live map of one document to sit beside (item 49). Escape does nothing
   on the Bench (a tab); Alt+0 opens it; its Escape-equivalent is clicking
   a document tab. The primer workspace reached from the door is the shell
   as is (WorkspaceShell.tsx:59-226: region :122-133, Escape :127-133, rail
   :180-213, heading focus :78-84). Phone: no Cloning subtab, no Bench
   (R6); the door to the primer workspace would still work on a phone if
   the tab were there — it is not.
3. **Tables and detail panes.** The slim panel keeps rows, not a `wst`
   table, as the CRISPR and Enzymes slim panels keep "the same compact
   row": `ul.fragment-list` (styles.css:4267-4280), `ol.pair-list`
   (PcrPanel.tsx:480), `PrimerLine` rows (MutagenesisPanel.tsx:359-362). No
   detail pane in the panel: the row's tooltip carries what the third line
   held. The full fragments table is the enzymes plan's `wst` table
   (`PrimerCandidates.tsx:422` pattern, `SortTh`, `tableKeys`), built once
   there and hosting this plan's hook; its detail pane, if any, is theirs.
4. **State and key naming.** Panel memory only, as the Enzymes plan (its §3
   reason: nothing lands asynchronously), unlike Align/CRISPR's session
   stores. Slots: `cloning.partial` (→ `enzymes.partial`), `pcr.*` (12,
   PcrPanel.tsx:237-269), `mutagenesis.*` (3, :234-246). The `<tab>.<thing>`
   rule is bent by `pcr.`/`mutagenesis.` prefixes; they stay, because
   `sendToPcr` writes `pcr.*` from four other files (primerToPcr.ts:24-27)
   and a rename buys nothing. The page/mode memory of the primer workspace
   (`primers.workspace`) is written through its own opener, as the sibling
   openers write theirs; when the shared `workspaceController` lands
   (Enzymes issue 1), the `mode` argument lives on the primers instance.
   The Bench's settings are the store's, persisted (benchSettings.ts) — a
   deliberate difference from every workspace, decided in item 49 (the
   Bench unmounts behind a document).
5. **Map preview owner.** `'cloning'` for the digest (CloningPanel.tsx:
   306-334), `'pcr'` for products (PcrPanel.tsx:304-309); clicks come back
   through `previewActivated` and are answered once (320-327, 331). The
   lifted hook keeps the owner and the nonce seeding; two hosts, never both
   mounted (Sidebar.tsx:54). Primers draws through `usePrimersPreview`
   (PrimerWorkspace.tsx:93-125) by page; the Bench draws no preview (its
   product is a `DiffMap`, item 49). CRISPR `'crispr'`; Enzymes none.
6. **Empty, loading, error.** Same classes as the others: "Scanning for
   restriction sites…" `panel__note` (CloningPanel.tsx:372; the Enzymes
   panel's words), "No enzyme is ticked" with a `link` (390-405), the
   blocked-by-methylation `panel__note--warn` (374-388), `panel__note--quiet`
   for the "left out" line (433); PCR's `panel__error` for `result.problem`
   (466) and `panel__warnings` for dimers (448); Mutate's `panel__note--warn`
   (324, 364). The new status lines are `role="status"` as Align's summary
   (AlignPanel.tsx:70). No worker run starts here, so no `MsaRunNotices`
   (MsaRunNotices.tsx:9-40) use; if one ever does (a long partial digest
   moved to the worker), reuse `RunNotices` as the Enzymes plan's §9 says.
7. **Copy tone and action names.** Kept: **Add** / **Add again** /
   **Added ✓** (146; not "Add to shelf": tutorials and tests say Add),
   **Open** (159, 541), **Shelve** (531), **Show** / **Hide** (519), **Open
   mutant** (379), **Tick enzymes** (399), **Grown in** (385). Doors end in
   `›`: **Open the Bench ›** (today's words plus the glyph, so
   digest-pcr.md:75 stays true), **Clone an insert into this plasmid ›**
   (the mode button's label, PrimerDesignPage.tsx:163), **All fragments and
   partial digest ›**, **Check ›**. No **Details** (no detail pane) and no
   **Add as feature** (nothing here is a feature). "…" only for the dialogs
   the primer side already has.
8. **Guide structure and shortcuts.** 12-cloning.md gets "The tab, the Bench
   and the primer workspace" where 11-align.md has "The tab and the
   workspace" (:8) and 10-primers.md has two sections (:14, :31); the
   section is the task map. 14-shortcuts.md: `Alt+0` (26) is the Bench's
   key already; the "Workspaces" table (131-153, heading renamed by
   whichever sibling lands first) gains no row — no Cloning workspace, no
   new binding.
9. **Built once, and who.** _[consolidated §3, §4]_ `panel__links` +
   `panel__door` + the door wording — **W2** (the others adopt).
   `openPrimerWorkspace(id, page, mode?)` — CL1, over the controller's
   primers instance from W1 and the `primers.mode` slot.
   `useDigestPieces` — Cloning 2, hosted by the Enzymes Digest page in
   Enzymes 6 (answers their R7 and, for fragments, R10). The `wst`
   fragments table with windowed rows — Enzymes 5/6, hosted here, not
   rebuilt. `workspaceController`, `useRowWindow` tbody variant, the
   `App.tsx:285` label lookup, `RunNotices` — not needed by Cloning; not
   built here. The shortcuts heading — not touched here.

**Deliberate differences, summarised:** no workspace (the Bench is it, and
the primer and enzymes workspaces hold the rest); doors named for their
destination rather than "Open X workspace ›"; the Reaction picker stays
first; the Bench's settings stay in the store (item 49); panel memory, no
session store; no phone subtab; no new key.
