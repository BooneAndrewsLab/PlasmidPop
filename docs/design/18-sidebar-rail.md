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
tabs go back to the grid of equal cells above the panel. Not yet:
arrow-key navigation along the rail (the tabs are plain buttons in
the Tab order), icons instead of words.
