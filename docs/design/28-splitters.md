# 28. Drag the boundary between the map and the sequence

Done,
2026-09-21. Asked for the same day: in the **Both** view the two panes were
a fixed ratio (`minmax(280px, 2fr) minmax(0, 3fr)`, and stacked under
1000 px `minmax(240px, 1fr) minmax(0, 1.4fr)`), and a user who wanted the
map at half the screen could not have it.

- **One `Splitter`, used twice** (`src/app/components/Splitter.tsx`): a grid
  item of its own between two panes, so the panes stay plain children and
  the container only has to give the track a width. It reads the geometry
  off the DOM — its own parent is the container — rather than being told
  the sizes, which is why nothing had to be taught that the panes changed:
  both views already re-measure themselves with a `ResizeObserver`, and the
  map keeps its zoom and pan across a resize. `onMove` hands back the first
  pane's size and the room the two share, both in px and already held to
  the floors (map 200, sequence 260 wide or 160 tall, sidebar 240, editor
  360); the caller turns that into whatever it stores. `role="separator"`
  with `aria-orientation`, `aria-valuenow`/`valuetext`, arrow keys (16 px),
  Page Up/Down (64 px), Home/End to either floor, double-click to put that
  one boundary back, and pointer capture so a fast drag keeps the grab.
  Whether a drag is under way is a **ref**, not state: the first
  `pointermove` can arrive before React has re-rendered, and a boundary
  that ignores it jumps when the second one lands (found in the browser,
  not by the tests, which flush between events).
- **Two fractions and a width**, in `SharedState.layout`
  (`src/app/state/layout.ts`), remembered with the other view preferences:
  `viewsSplit` for the side-by-side layout, `viewsSplitStacked` for the
  stacked one — a ratio chosen for a wide window is the wrong one on the
  other axis — and `sidebarWidth` in px. The breakpoints are named there
  as well as in `styles.css` (`useMediaQuery`), because the handle has to
  know which axis it is dividing; the stylesheet keeps the old ratios as
  the fallback. **Format ▸ Reset the layout** (`resetLayout`) puts all
  three back and opens the sidebar.
- **The sidebar puts itself away.** Asked for alongside it: clicking the
  sidebar tab that is already open collapses the sidebar to its 30 px rail
  (`sidebarOpen`, `.sidebar--collapsed`), giving the views the whole width,
  and clicking any label opens it again on that tab — the tool-window
  behaviour of the IDEs the rail was modelled on (item 18). The rail is
  always there, so there is no separate control to hide or show it and no
  way to get stuck; the panel is `hidden` rather than unmounted, so what
  was typed into it survives. A toolbar toggle was built first and taken
  out again as redundant.
- `Alt+S` collapses the sidebar and brings it back (item 32).
- **Past the floor, and from the keyboard** (#36, 2026-09-24). A floor is a
  wall only for a boundary that cannot collapse its pane; given
  `onCollapse`, dragging more than half the floor away (or pressing one more
  arrow toward a pane already at it) puts the pane away and ends the grab.
  Half, so a drag that merely overshoots the floor does not lose a pane.
  The views' boundary collapses the map to **Sequence** or the sequence to
  **Map**; the sidebar's folds it to its rail; the editor never collapses.
  Each already had a way back (the view switcher, the rail), which is why
  collapsing is just those states and nothing new. `Alt+B` moves focus to
  the next splitter on screen and Escape hands it back to what had it
  (`splitterFocus.ts`). Doing that from the sequence view is what showed
  that every `Alt` binding had stood down there since 1.0: `isTextTarget`
  counted the view's `role="textbox"` as a field. The `Alt` bindings now
  stand down only in real fields (`isAltBlocked`); the view types nothing
  on `Alt`, and it is what `Alt` was chosen for. Stacked (≤720 px) the
  sidebar under the editor has a handle on its top edge and a height of its
  own (`sidebarHeightStacked`, 120–900 px, default the old 200).
