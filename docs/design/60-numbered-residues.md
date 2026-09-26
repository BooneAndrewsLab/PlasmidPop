# 60. Numbered residues

Done, 2026-09-25 (#97; `core/analysis/residueNumbers.ts`,
`view/linear/residueLabels.ts`, `drawResidueNumbers` in `renderLinear.ts`,
`TranslatePanel.tsx`). Asked for: number the residues where amino acids are
shown, as SnapGene does — the translations under CDS features, counted from
the first codon, across joins and on the reverse strand, and the six-frame
translation. Later the same day: a setting to number every residue, not only
every tenth.

## What is numbered

The first residue and every tenth one (10, 20, …). Residue 1 is the CDS's
first whole codon: `translateCds` already skips the bases `/codon_start`
names, splices the segments of a `join(...)` in reading order, reverse
complements a reverse-strand CDS and follows it through the origin, so a
residue's number is its codon's index plus one and nothing else has to know
about segments. `residueNumbers(t, step)` picks the numbered codons and
anchors each on its codon's **middle base in reading order**, the base the
letter is drawn over, so a codon split by an intron, a row break or the
origin is numbered where it is lettered. The tests check it against the
segments directly, not against `translateCds`: `/codon_start` 2 and 3 on
both strands, three exons of 7, 14 and 50 bases, a segment through the
origin and a join whose junction is the origin, and every one of the 60
rotations of a circle carrying a two-exon CDS, each base mapped back.

## Where the numbers go

In a band at the top of each amino-acid line, above the letters, as the
ruler sits above the bases: 11 px at the default size, scaled with the text.
That makes a translation line 27 px instead of 16. The band is part of the
line (`translationHeight` includes `residueNumberHeight`), so hit testing,
`laneTop` and every row height follow without a second measurement, and a
number can never meet a feature label or a cut site: those are in other
bands. The numbers are 0.85 of the label font, muted.

A number too close to another is dropped, never drawn over it
(`placeLabels`, 4 px apart). The first residue and the tens are placed first,
then the rest left to right in what room is left; with every tenth only, two
numbers are 27 bases apart and the rule never bites, but with every residue
numbered it is what keeps the view readable: at 13 px text a codon is 23 px
and "1,000" is about as wide, so past residue 999 about every other one
shows, the tens always. A larger size or fewer bases per row brings them back, as
the guide says.

## The setting

**Format ▸ Residue numbers**: Off, Every 10th (the default) or Every residue,
`SharedState.residueNumbering`, remembered with the view preferences. Off
also takes the band away, so a user who never wanted numbers gets the old
row heights back. The sequence SVG export follows it (it shares the renderer
through `SvgContext`), as it follows the other Format choices. On a protein
document the items are disabled: there are no translations, and the ruler
already counts residues, so labels there would duplicate it.

## The six frames

The six-frame translation is not drawn in the sequence view; it is the
Translate tab's text. There the protein is set in blocks of ten, each
numbered by its last residue and the first also by 1 — how a protein is
printed. The count is **per frame, from the frame's first codon**: residue 1
of +2 is the codon starting at the selection's second base, and of −1 the
codon at its right-hand end, because that is the reading the user asked for
by choosing the frame. Numbering per ORF was the other reading and was not
taken: the tab shows whole frames, stops and all, not ORFs, and the ORFs tab
lists each ORF with its own length already.

The numbers are CSS `::before`/`::after` content from `data-` attributes, not
text: copying a frame, or reading its `textContent`, gives residues only.
Every residue is not offered there, since a block of ten already says where
each residue is. Off shows the frames as plain text, and so does a frame of
more than 20,000 residues, where a span per ten residues would be a lot of
DOM for a panel.

## Cost

Measured in `docs/perf-notes.md`: a screen of a 200 kb sequence dense with
CDSs draws in about 0.85 ms with every tenth numbered against 0.8 without,
and about 1 ms with every residue, after the number texts were formatted
once and a codon's stretch found without building a list.
