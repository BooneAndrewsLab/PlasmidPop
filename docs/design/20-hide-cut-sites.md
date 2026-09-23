# 20. Hide cut sites without losing the enzyme selection

Done. A
**Cut sites** toggle sits next to Complement / Translations in the
toolbar (`showCutSites` in the store); off, the sequence view, the
circular map and both SVG exports draw no cut sites while
`shownEnzymes` is untouched, so the chosen set comes back intact. The
Enzymes tab says so while they are hidden, with a "Show cut sites"
link, and its fragment list and the Cloning digest follow the ticks,
not the toggle (both headings now say "ticked enzymes"). The toggle
is remembered across reloads with the other view preferences
(`src/app/state/viewPrefs.ts`) and bound to `Alt+R` (item 32).
