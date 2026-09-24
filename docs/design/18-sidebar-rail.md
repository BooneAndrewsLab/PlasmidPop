# 18. Sidebar tab strip that stays on one row

Done, as option (a)
of the four considered on 2026-09-18. The tabs are a 30 px vertical
rail down the sidebar's outer edge with the labels turned a quarter
turn, JetBrains style, and the panel beside them; the sidebar is
330 px wide so the panel keeps its old 300 px (`.sidebar`,
`.sidebar__tabs`, `.sidebar__tab-label` in `src/styles.css`). Every
tab is shown whatever their number: on a window too short for them at
full length they shrink and the labels ellipsize (about 80 % of each
label survives at a 500 px viewport), and the rail scrolls only past
that. Under 720 px, where the sidebar is short and wide instead, the
tabs go back to the grid of equal cells above the panel.

**Keys and icons** (#35, 2026-09-24). The rail follows the WAI-ARIA tabs
pattern: one Tab stop (a roving `tabindex` on the tab the panel is on),
↑/↓ along it (←/→ when it is the stacked row, which `aria-orientation`
says), Home and End, wrapping round, with the tab reached opened at once
(automatic activation: a panel is cheap to show, and a rail you have to
confirm your way along is slower than a mouse). The panel is labelled by
its tab. Each tab has a line icon above the label, drawn in
`SidebarIcon.tsx` rather than taken from a set — eight 16-unit glyphs,
turned a quarter with the label on the rail so arrows point along the
word. They are _with_ the words, not instead of them: the words are what
say "ORFs", and on a rail too short for every label the icon is the part
that stays whole.
