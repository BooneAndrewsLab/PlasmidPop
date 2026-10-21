# 95. The app's own tooltip in place of the browser's `title` (#264)

**Asked:** the native `title` tooltip is slow to appear and plain. The
alignment's large view names what is under the pointer through it
(`R240S · CGT→AGT · bla`, a track feature, a sample's own feature), and so
do the GC tracks on the map and in the sequence view, and some 270 buttons,
rows and labels carry a `title` for their help. "Make a custom tooltip or
something; the system tooltips are too slow and boring." Design and scope
were left to the implementation.

**Built: one `TooltipLayer`** (`src/app/components/TooltipLayer.tsx`),
mounted once in `App`, that draws every tooltip in the app from two sources:

- **`data-tip="…"` on any element**, HTML or SVG, in place of `title`. The
  layer listens on the document for `pointerover`, `pointerout`, `focusin`,
  `focusout`, `pointerdown`, `keydown`, `scroll`, `resize` and `blur`, and
  finds the tipped element with `closest('[data-tip]')`; a control adopts
  the tooltip by a one-word change and no component imports anything.
- **A pointer-following tip** a canvas view sets itself, through
  `followTooltip(text, clientX, clientY)` / `hideFollowTooltip()` in
  `src/app/components/tooltip.ts`, because what is under the pointer on a
  canvas is not an element the layer could watch. The large alignment view
  calls it from its pointer-move handler; the map and the sequence view do
  for the GC track. It is a tiny module-level store, not React state: the
  layer answers a call by writing one node's text and `translate`, and the
  view that called it does not re-render. The alignment view used to keep
  the hover text in `useState`, re-rendering the whole component on every
  change; that state is gone.

## Scope: everything, not just the canvases

The complaint was about the canvases, where the native tooltip is at its
worst: it needs the pointer to stop, waits about a second, and when the text
under a moving pointer changes it hides and waits again. But a toolbar whose
buttons still showed the browser's tooltip beside an alignment that showed
ours would have two kinds of tooltip at two speeds in one window, and the
`data-tip` mechanism makes converting a button free. So every `title` on an
HTML or SVG element became `data-tip`, by an AST rewrite over `src/` (245
attributes, plus two `<abbr>`s by hand), with the exceptions below, and an ESLint rule in
`eslint.config.js` (`plasmidpop/no-title-attribute`) keeps `title` from
coming back on an element. The rule leaves `title` on components alone: a
dialog's `title` prop is its heading. The three components whose `title`
prop was in fact a tooltip (`FileMenu`'s `Item`, `FormatMenu`'s `Row`,
`GeneticCodeSelect`) now call it `tip`.

Kept as `title`:

- `<iframe title>` (the protocol preview): the iframe's accessible name, and
  nothing hovers an iframe for help.
- `<option title>` (the enzyme sort order): a native select's list is the
  browser's; nothing of ours can draw inside it. In practice browsers do not
  show it either.

SVG `<title>` elements went the same way: the gel's bands and shortened lane
names carry `data-tip`, and the whole-gel `<title>` that was its accessible
name is an `aria-label`; the logo's `<title>` likewise. An SVG `<title>` is
a native tooltip too, and would have shown beside ours.

## Timing

- A control's tip shows **300 ms** after the pointer arrives on it, whether
  or not the pointer has stopped. Native tooltips wait about 1 s and need a
  still pointer; 300 ms is enough that sweeping across a toolbar shows
  nothing, and short enough to feel immediate when you mean it.
- **Warm switching:** for 250 ms after a tip went away, the next control's
  tip shows at once, so a toolbar is read control by control without the
  delay each time, as a menu bar behaves.
- The **pointer-following tip has no delay** and tracks the pointer with a
  14 × 18 px offset. On a canvas, what is under the pointer is the point of
  pointing; a delay there would be the native tooltip's fault again.
- A **pointer down** hides the tip and does not bring it back until the
  pointer moves to another element, as the native one does. **Scroll**,
  **resize** and losing the **window** hide it, since all of them move or
  change what it was about; a following tip comes back on the next pointer
  move, which the view answers.

## Placement, look

Centred under the control with a 6 px gap, flipped above it when there is
no room below, and clamped 8 px inside the window's sides. The following tip
flips to the other side of the pointer at the right and bottom edges. The
node is `position: fixed` in a portal on `body`, so showing it shifts no
layout and no `overflow` or scrolling ancestor clips it; `pointer-events:
none` keeps it from ever sitting between the pointer and the control.
`z-index: 100`, above the dialogs (20). The size is measured once per text
and reused while the pointer moves.

A dark bubble in both themes, as operating systems draw them, through two
new tokens, `--tip-surface` and `--tip-ink`, with a hairline `--tip-line`;
12 px UI font, 320 px at most, `white-space: pre-line` so the line breaks a
few titles carried (the document tab's file name, a detected part's source)
still break. A 90 ms fade-in through `@starting-style`; none under
`prefers-reduced-motion`.

## Accessibility

- **Names are not lost.** `title` was the accessible description of every
  converted control and the accessible name of none: an AST survey found
  every tipped button with visible text or an `aria-label`, and the two SVG
  `<title>`s that were names became `aria-label`s. Tests that found controls
  by role and name still pass.
- **The description is kept while it matters.** While the tip is shown for
  an element, that element is `aria-describedby="app-tooltip"`, the node has
  `role="tooltip"`, and the attribute is restored to what it was on hide
  (an existing `aria-describedby` has the id appended, not replaced). This
  is the WAI-ARIA tooltip pattern: the description is there when the
  control has focus or the pointer.
- **Keyboard:** focus reaching a tipped control from the keyboard shows its
  tip at once, for as long as it has focus; `Escape` hides it. Focus that
  follows a click does not show it (the layer tracks the last input's
  modality, as `:focus-visible` does), so clicking a button does not pop
  its help.
- **Touch:** a `pointerover` from a touch never shows a control's tip: a tap
  is a click, and a help bubble over a tapped button is in the way. A
  control's tip is therefore help, never the only place a fact lives — the
  same rule the native `title` imposed. On the alignment's large view, where
  the residue text is information, a **tap** shows it at the tapped point
  and it stays until the next tap or scroll (the view sets it from `onClick`
  when the event's `pointerType` is `touch`). The map's and the sequence
  view's GC track keep hover only, as before; their touch handling is the
  gesture code of items 14 and 15 and the GC figure is a convenience.

## Cost

One document listener per event kind, all passive and on the capture phase;
a `closest()` per `pointerover`. For the following tip, one `textContent`
write when the text changes and one `translate` write per pointer move; no
React render anywhere. The alignment view's pointer-move handler already
computed the text per move for the `title`; it now computes the same and
sets no state.

## Tests

`TooltipLayer.test.tsx` (jsdom, fake timers): the delay, the warm switch, a
pointer that only crosses, children of a control, keyboard focus and
`Escape`, click focus, touch, pointer down and scroll, the clamps and the
flip, the following tip and its edge flips, an existing `aria-describedby`,
an empty tip. `src/test/tips.ts` gives tests `getByTip`, `getAllByTip` and
`findAllByTip`, which took the place of Testing Library's `*ByTitle`
queries.
