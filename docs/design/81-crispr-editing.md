# 81. CRISPR base-editing windows and pegRNAs (#222)

**Asked:** follow-up to item 74: show a base editor's editing window on each
guide, and design pegRNAs for prime editing. No efficiency score, as in 74.

**Decided: two small additions to the guide scan, in
`core/analysis/crisprEdit.ts`, both SpCas9-only.** No worker request is
needed: each is arithmetic on the guides already found.

## Base editing

A base editor converts one base inside a window of the protospacer, counted
from the spacer's 5' end. The presets are CBE (C to T, positions 4-8, Komor
2016), ABE7.10 (A to G, 4-7, Gaudelli 2017) and ABE8e (A to G, 4-8, Richter
2020). The positions are defined for a 20 nt spacer with an NGG PAM, so
`supportsBaseEditing` is false for every other nuclease and the panel hides
the selector. `baseEditWindow(guide, editor)` returns the window as a
forward range, the bases in it the editor converts (spacer position,
guide-strand base, forward coordinate) and the spacer after all of them are
converted. On a reverse-strand guide the window runs from the right and the
forward-strand base is the complement (a C to T edit is a G to A there). The
panel shows the count on each row, an "only with a C to edit" toggle, and
the bases and the all-edited spacer in the guide's details. Bystander edits
are visible (several bases listed) but not scored: how much each is edited
is a trained, editor-specific profile, not a formula.

## Prime editing

`designPegRnas` takes an edit ("replace `deleteLength` bases at `start` with
`insert`", which covers substitution, insertion and deletion) and, for each
guide whose nick is upstream of it, builds the pegRNA 3' extension.
Everything is read along the PAM strand with the nick as origin: the PBS is
the reverse complement of the `pbsLength` bases before the nick (default
13), the template is the reverse complement of the edited strand from the
nick through the edit and `homology` further bases (default 10), and the
extension is template then PBS. A reverse-strand guide reads the same way
through a base accessor that complements and counts downward, so the one
code path handles both strands and the origin of a circle (the property
test: a molecule and edit reverse-complemented give the same pegRNA; a
rotated circle the same one again).

- The nick is the nickase's PAM-strand cut (`cut.pamStrand`); any 3'-PAM
  nuclease with one cut point qualifies, which in practice is SpCas9 and
  its PAM variants.
- An edit before the nick cannot be templated; one more than 30 bases
  after it, or needing a template over 60 nt, is out of reach. Such guides
  are not offered, and the panel says when none is.
- Mechanical flags only: a template starting with C (it can pair with the
  scaffold), a PBS with GC outside 40-60%, TTTT in the extension, and a
  note whether the edit changes the PAM (which stops re-nicking of the
  edited strand). No ranking beyond distance from the nick.
- The scaffold is not appended and no PE3 second nick is designed; the panel
  gives the spacer and the extension, which is what is ordered onto a
  scaffold. PE3/PE3b nicking guides are the natural follow-up if asked.
- Ambiguous bases in the footprint skip the guide: a template cannot
  contain an N.

The edit is typed (position, bases replaced, new bases) rather than taken
from the selection, because clicking a guide moves the selection; a button
copies the selection's position and length in.
