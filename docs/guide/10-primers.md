# Primers

The **Primers** tab designs PCR primer pairs for a selected region, checks
primers you already have, and keeps your own list of primers,
[My primers](#my-primers), with where each of them binds on the document.
The tab itself is short — the selection, a quick check, the primers already
on the document — and the work is done in the
[primer workspace](#the-primer-workspace), a larger panel beside the map.

Melting temperatures use the nearest-neighbour method (SantaLucia 1998,
unified parameters) at 500 nM oligo and 50 mM monovalent salt. They are
good to about ±2 °C for ordinary PCR primers; adjust for your buffer.

## The Primers tab

- **Selection** names the current selection (`251–350 · 100 bp`) and
  **Design primers…** opens the workspace on its Design page for it. With
  nothing selected it opens the workspace all the same: pick a feature
  there, or switch to cloning an insert into this plasmid, which needs no
  selection. Once a
  design has been made, **Last design · 10 pairs ›** reopens the workspace on
  its Results.
- **Quick check** takes a pasted primer and gives its length, Tm, GC content
  and whether it ends in a GC clamp, with where it binds on the document
  (each site previewed in the views; click one to select it). **Full check ›**
  opens the workspace's Check page, which adds the warnings and the actions.
- **On this document** lists the document's `primer_bind` features with their
  strand and position; click one to select it.
- **My primers…** opens the workspace on your list.

## The primer workspace

The workspace takes the sidebar's place, widened, with the map live beside
it: a design is judged by where it lands, so the map stays in view and
follows every click. The sequence view yields to it in the Both view and
comes back when it closes; the boundary between the map and the workspace
can be dragged like the other pane boundaries, and is remembered. A rail
down its left edge names its four pages — **Design**, **Results**, **Check**
and **My primers** — each with a heading of its own and a count where there
is one; `↑` and `↓` on the rail move between them.

The workspace is a region of the window, not a dialog: nothing is greyed
out behind it, the map and the toolbar keep working, and `Escape` closes it
only while the keyboard is inside it (an open **Settings** folds first). Its
**✕** closes it too, as does choosing another sidebar tab; the Primers tab
then offers the last design to come back to, with everything as it was
left. On a window narrower than about 1000 px the workspace takes the whole
area under the toolbar; on a phone it fills the screen, with the pages as
tabs across the top, and **Primers** is a fourth tab under **Details**. In
both of those the map cannot be beside the workspace, so a **Map** strip
across its top draws the whole document as one ribbon — the features, the
selection and whatever the page is previewing — and follows every click;
its label folds it away and brings it back, and a short window starts with
it folded.

## Designing primers for a region

1. Select the region to amplify in either view, through the origin of a
   circle too: the Design page gives the target as the status bar does,
   `591–20 · 30 bp` on a 600 bp plasmid. **Target** offers two ways of
   choosing it:
   - **Selection**: whatever is selected, live — click the map or the
     sequence and the target follows. When the selection is exactly a
     feature, its name is given (`lacZα 146–469 · 324 bp · reverse strand`).
   - **Feature**: pick one of the document's features from a list; it is
     selected for you. A later click elsewhere takes over, as above.

   While a target is selected, the two stretches the designer will search —
   the forward primer's window before it and the reverse primer's after it,
   as **Settings** sets them — are drawn in the views as previews.

2. Click **Design primers**. The workspace goes to **Results**. Until
   something is selected the button is off, with "Select a region or pick a
   feature" beside it to say why.
3. Up to ten pairs are listed in a table, best first: the rank (**#**),
   the product size, the Tm difference (**ΔTm**), then each primer's bases
   5′→3′ with its Tm and GC content, and **Spec.**, the pair's specificity
   (see [below](#checking-specificity-with-ncbi-primer-blast)). Click a
   column heading to sort by it, again to turn the order round. The box
   above the table narrows the rows to the pairs with a run of bases
   (`acgtac`, four or more), a position inside a site or the product
   (`150`), or a rank (`#3`); the chips keep only the pairs with **ΔTm ≤ 1**
   °C, a **GC clamp** on **both** primers, or **No hairpin**. The count
   says how many of the pairs are shown.
4. Select a pair — click its row, or with the keyboard in the table press
   `↓` and `↑` (`Home`, `End` for the first and the last). The pair is
   drawn in both views without touching the document: the two sites as
   dashed arrows pointing the way each primer reads, and the product
   between them as a bracket (see [Previews](03-viewing.md#previews)). The
   product is selected too, so the views scroll to it and the status bar
   gives its length. Pointing at another row shows that pair for as long
   as the pointer is there, so candidates can be compared without
   annotating anything. Under the table the selected pair is given in
   full: each primer's bases, length, Tm, GC content, position and whether
   it ends in a GC clamp, and the checks — the longest hairpin stem,
   self-complementary stretch and 3′-end pairing of each primer, the 3′
   pairing between the two (**cross**), and **elsewhere**, whether either
   primer would also anneal somewhere else on the document. Untick **Show
   on map** to take the drawing and the selection off while keeping the
   pair selected; closing the workspace takes them off too. If you have
   selected something else in the meantime that selection is yours and is
   left alone.
5. **Add both** annotates the pair as `primer_bind` features
   (the primer sequence goes in a `/note`), so the sites are on the map and
   saved with the file. Unlike showing it, this is an edit: it goes into the
   History as one step, and one **Undo** takes both back.
6. **Save both** keeps the two primers in [My primers](#my-primers), named
   after the document (`pUC19 fwd 1`, `pUC19 rev 1`), with the target, Tm
   and GC content in their notes. **Copy** puts both oligos on the
   clipboard, a name and the bases a line each, ready for an order form.

On a phone the table is a list of rows — rank, product, ΔTm and the two
Tms — and the selected row opens out into the same detail; **Sort by** is
a list above it.

If nothing qualifies, select more flanking sequence, look further from the
selection, or loosen the settings.

A design belongs to the sequence it was made on. If you edit the bases, reverse
complement, or change the topology or origin, the list is cleared, because
the coordinates and oligos no longer fit; select the target and design
again. Adding or editing annotations leaves it alone. Selecting something
else while on Results keeps the list but takes its preview off the map, and
**Target changed — Design again** at the top goes back to Design for the new
selection; the Design page's **Last design** line goes the other way.

## Cloning ends: primers that put two restriction sites on an insert

The Design page has a second mode, **Clone an insert into this plasmid**
(the switch at the top; **Primers on this sequence** is the design above).
With a plasmid open as the vector it designs the two primers that amplify
an insert from another tab with a restriction site on each 5′ tail, so
that after PCR and a double digest the insert's ends match the vector cut
with the same two enzymes, in one direction. The mode is remembered per
document, and **Results** shows whichever design was made last.

1. **Where on the vector.** The selection, live, as in the plain mode —
   the polylinker, say — with the same **Selection** / **Feature** chooser.
   With nothing selected the one feature named as the cloning site (`MCS`,
   `multiple cloning site`, `polylinker`) is taken, and failing that the
   whole plasmid, in which case the line says so and the candidates are
   the enzymes that cut it once anywhere; select a region to narrow them.
   The line under it names the enzymes that cut inside the region.
2. **What to insert.** **Feature in another tab…** lists every open DNA
   tab's features and, when it has one, its selection; the insert is read
   off that tab, so an edit there follows and a closed tab is said rather
   than kept. **Gene from NCBI…** is the same search as File ▸ Open from
   NCBI, with **Add** where that one says Open: the record opens as a tab of its own (it is the PCR template) and
   its CDS — else its gene, else the whole record — becomes the insert,
   while the workspace stays on the vector. The insert's line gives its
   first and last bases and, once the scans are in, which of the region's
   enzymes cut inside it. **Orientation** says which end goes to which cut;
   **Flip** turns the insert round, for a vector whose promoter runs the
   other way.
3. **Enzymes.** Pairs are suggested, not picked blind: each enzyme must
   cut the vector exactly once, inside the region, past the vector's
   dam/dcm host, leave a sticky end, not be Type IIS, have room to cut
   beside the other, give two ends that cannot ligate to each other (so
   the insert goes in one way and the vector cannot close), and cut the
   insert nowhere. Usable pairs come first, the wider stretch between the
   cuts first; the rest are greyed with the reason, the long tail folded
   behind **N more excluded pairs**. Click a row (or `↓` `↑` in the table)
   to pick a pair; the two sites are drawn on the map. **Any two enzymes…**
   picks any pair at all from every enzyme that cuts the vector, excluded
   ones included: Design then warns instead of refusing. A pair picked
   before the region or the insert changed is kept and said to be unusable
   with its reason.
4. **Design primers** is off, with the reason beside it, until an insert
   and two enzymes are set. **Settings** has two rows of its own in this
   mode — **Padding**, the bases 5′ of each site (6 by default), and
   **Junction**, whether the padding is chosen so that padding, site and
   insert spell no new site where they meet — above the shared ones, which
   judge the part that anneals.

Each primer is padding + site + an annealing part on the insert's end, and
on Results each oligo is written as ordered, 5′→3′: the tail in lower case
(padding in grey, the site in the cut colour and underlined), the annealing
part in upper case. **Tm** and GC are the annealing part's, since that is
what the first cycles see; **PCR** is the product with its tails. The
picked pair is row 1 and up to five other suggested pairs follow, designed
with the same settings, so EcoRI · BamHI can be compared with EcoRI · PstI
without going back. The selected row's detail names both ends — enzyme,
site with its cut, padding, overhang, how the vector is cut — the warnings
in full, and the actions: **Simulate** runs PCR on the insert's tab, the
digest with both enzymes and the ligation into the vector's backbone, and
opens the product as a new document named `vector-insert` (the thumbnail
in the pane is that product drawn small, so what it shows is what opens,
with the two enzymes ticked in its Enzymes tab);
**Save both** keeps the primers in [My primers](#my-primers) as
`insert-F-enzyme` and `insert-R-enzyme`; **Copy** puts both on the
clipboard; **Use in PCR** fills Cloning ▸ PCR with them and the insert's
tab as the template; **Check specificity…** opens Primer-BLAST with the
two annealing parts only, since the tails match no template.

**Warnings** come in two colours. Red means the clone will be wrong: an
enzyme that cuts inside the insert (the digest cuts the product too), one
that cuts the vector never or more than once, a site on the vector blocked
by its dam/dcm host, two ends that ligate to each other or one enzyme used
twice (the insert can go in either way), a Type IIS enzyme (its cut lands
beside the site, so the overhang is the insert's own bases — for a part
with overhangs of your own, switch **Ends** to **Golden Gate part**), a site the
amplicon spells beyond the two intended. Amber means look before ordering:
padding raised because the enzyme cuts poorly within a few bases of an end
(NEB's cleavage-near-the-end chart: NotI and PmeI want 8, NdeI 7, SalI 4),
two sites too close together for a double digest (digest with one enzyme,
then the other), a new site made where padding, site and insert meet, an
annealing part that misses the settings, or one that binds elsewhere on
the insert's tab.

The methylation rule: the vector's host decides whether a site on the
vector cuts, and the insert's does not — the amplified insert is a PCR
product and carries no methylation, so a site in it cuts whatever the tab
it came from says.

### Golden Gate ends: primers that make the insert a part

Step 3 has a second kind of end: **Ends ▸ Golden Gate part**, beside
**Two restriction sites**. It designs the two primers that turn the insert
into a [Golden Gate](12-cloning.md#golden-gate) part, each one

```
5′ padding · Type IIS site · spacer · overhang · annealing part 3′
```

with the site pointing into the part, so the enzyme cuts past it and the
site leaves with the flank. Nothing about the geometry is typed in: the
spacer's length and the overhang's are read off the enzyme's own row of the
table, so BsaI (`GGTCTC(1/5)`) and BsmBI get one spacer base and a 4-base
overhang, BbsI (`GAAGAC(2/6)`) two and four, and SapI (`GCTCTTC(1/4)`) one
and three. The line beside the picker says which. Only enzymes the table
can express this way are offered: one that cuts on both sides of its site,
leaves a blunt end or a 3′ overhang, or has an ambiguity code in its site,
is left out.

- **Enzyme.** BsaI by default; BsmBI, BbsI, SapI and the other Type IIS
  enzymes in the table follow. **and** adds a second enzyme for a tube that
  holds parts made for two, as the Bench's Golden Gate does; its site must
  not be in the part either.
- **Overhangs.** Choose a pair, or type four bases (three for SapI). The
  list offers every position of the bundled standards — the MoClo plant
  common syntax, the Yeast Toolkit — so a CDS part is `AATG`…`GCTT`, and,
  when the enzyme opens the plasmid in front, the pair that plasmid's own
  cut ends ask for, as **From pGG-Destination: GGAG…CGCT**. That last one
  is the way to be sure the part fits the destination you have open. Both
  overhangs are written as they read on the **top strand**; the reverse
  primer carries the right one reverse-complemented for you.
- **Start and stop codons.** `AATG` is `A` plus a start codon, so when the
  region begins with `ATG` the overhang spells it and the annealing part
  begins at the base after it — the note under the fields says so. Untick
  **Include the stop codon** (it is off by default) to leave the region's
  own stop out, so that a tag or a second domain follows in frame; untick
  **Include the start codon** for an N-terminal fusion part. Only those two
  codons are ever taken as spelled by an overhang: a part whose first base
  happens to be the overhang's last keeps it, since eating it would shift
  the frame for nothing.

The note under the fields is the design as it would be made: the part's
length, what each overhang does, how many coding bases reach the right
overhang and whether that is a whole number of codons, the PCR product's
length, and in red anything that would spoil it. **Design primers** then
puts the one part on Results — one design, not a table of pairs — with the
oligos written as ordered, the part the reaction releases, the warnings and
the same actions. **Simulate** runs the PCR on the insert's tab and then
the Golden Gate into the plasmid in front, with every other open tab the
enzyme releases a part from in the tube, and opens the circle with the
enzyme ticked in its Enzymes tab. When there is no destination, or the
enzyme opens nothing in it, or the set needs parts that are not open, it
says which in plain words and gives the PCR product alone — which is the
part, ready for the Bench.

Red warnings: a site for the enzyme (or the second one) inside the part,
which the reaction would cut; a site the tails and the part spell between
them. Amber: an overhang that is its own reverse complement, the same
overhang at both ends, or one a base away from another in the tube, by the
rules the [assembly](12-cloning.md#golden-gate) is judged by; coding bases
that do not reach the right overhang in frame; an ambiguity code in the
annealing part; and the padding, annealing, specificity and dimer warnings
of the restriction ends above.

## Checking specificity with NCBI Primer-BLAST

Whether a pair would also amplify something in a genome cannot be checked
in the browser: no genome is bundled. **Check specificity…**, under a
selected pair on Results and under a picked pair in
[My primers](#my-primers), opens NCBI's
[Primer-BLAST](https://www.ncbi.nlm.nih.gov/tools/primer-blast/) in a new
tab with the two primers already in its form. When the document has an
NCBI accession (a record opened from NCBI, say) the form also gets it as the
template, its organism, a genome database to search, and a product-size range
that fits the pair; otherwise choose those there. Run the search on NCBI's
site.

What leaves the browser: the two primer sequences, in the address of the
page that opens, plus the template's NCBI accession and organism when the
document has them. When the document annotates an mRNA (a gene opened from NCBI does)
whose exons hold both primers, that transcript's accession is the template,
so the result names the gene the pair targets; a pair in an intron or outside
every transcript uses the record's own accession instead. The two primers
swap places when the template reads the other way round, as Primer-BLAST
wants the first one on the template's top strand — never its sequence or name, and a name that is not an
NCBI accession is not sent — and nothing at all until you click. The **Spec.** column says **not
checked** for every pair: the answer stays on NCBI's page for now.

## Settings

**Settings**, under the target on the Design page, sets what a designed
primer has to be. It is folded by default; its row says **changed** once any
setting is off its default and then sums the main rules up (`18–27 nt, Tm
58–65 °C, GC 35–65 %, within 0–200 bp of the target`). Open it to see and
change them all. Every candidate that breaks one of them is refused, and the
same numbers are what **Check a primer** warns about, so a pasted primer is
judged by the rules the designed ones had to pass. They are remembered in
this browser, from plasmid to plasmid; **Reset to defaults** puts them back.

| Setting    | Default               | What it means                                                                                                                                                                                                            |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Length     | 18–27 nt              | Shortest and longest primer.                                                                                                                                                                                             |
| Tm         | 55–65 °C              | Melting temperature range.                                                                                                                                                                                               |
| GC         | 35–65 %               | GC content range.                                                                                                                                                                                                        |
| ΔTm        | ≤ 3 °C                | Largest Tm difference between the two primers of a pair.                                                                                                                                                                 |
| Forward    | 0–200 bp before start | Where the forward primer may lie.                                                                                                                                                                                        |
| Reverse    | 0–200 bp after end    | Where the reverse primer may lie.                                                                                                                                                                                        |
| Base run   | ≤ 4                   | Longest run of one base (`GGGG` is 4).                                                                                                                                                                                   |
| Hairpin    | stem ≤ 4 bp           | Longest stem the primer can fold back into, with a loop of at least 3 bases.                                                                                                                                             |
| Self-dimer | ≤ 6 bp                | Longest stretch that pairs with another part of the same primer.                                                                                                                                                         |
| 3′ dimer   | ≤ 4 bp                | Longest stretch at the 3′ end that pairs with itself or with the other primer of the pair — the dimer a polymerase can extend.                                                                                           |
| GC clamp   | preferred             | Tick **required** to refuse a primer that does not end in G or C.                                                                                                                                                        |
| Product    | 0–20,000 bp           | Shortest and longest product a pair may give. 20 kb is the most the PCR reaction will make.                                                                                                                              |
| Elsewhere  | refused               | Refuse a primer that would also anneal somewhere else on either strand — exact 3′ end, up to two mismatches elsewhere, the same rule as **Check a primer**'s binding sites. Untick it to allow a primer inside a repeat. |

**Where to look** is measured from the selection's edges: the forward primer
lies wholly between the two distances before the start, the reverse primer
between the two after the end. A negative number reaches _into_ the
selection, so `-30`–`0` for the forward primer puts it on the selection's
own first bases — how an ORF is amplified from its start codon. To keep
primers well clear of the region, as for sequencing across it, raise the
near edge: `50`–`200` leaves at least 50 bp between each primer and the
selection.

When you [clone an insert](#cloning-ends-primers-that-put-two-restriction-sites-on-an-insert) the **Product**
and **Where to look** rows are greyed out: the primers sit at the two ends of
the insert, and the product is the insert plus the enzyme-site tails, so
neither is a choice. The other settings still hold the annealing parts.

Among the candidates that pass, pairs are ranked by a penalty that favours
a Tm in the middle of the range, GC in the middle of its range, a GC clamp,
little self-complementarity or hairpin, a length near 21 nt and a small Tm
difference.

## Checking a primer

Paste a sequence into the tab's **Quick check**, or into the workspace's
**Check** page (**Full check ›** takes the pasted primer there). You get its
length, Tm, GC content and, when it ends in G or C, **clamp**; the Check
page adds, under those, a warning for each setting it breaks — too short or
too long, Tm or GC out of range, a long run of one base, a hairpin, a
self-complementary stretch, a 3′ end that pairs with itself — and for a
missing GC clamp, then a line with the three dimer measures themselves
(`No hairpin, self-dimer 3 bp, 3′ dimer 2 bp`).

With eight or more bases, both also search the document for **binding
sites** on both strands: the 3′ end must match exactly and up to two
mismatches are allowed elsewhere. Every site found is previewed in both
views at once, so off-target binding is visible at a glance, and a site's
mismatches are marked on its arrow at the bases they fall on. The Check
page lists the sites in a table at the right — strand, position,
mismatches; the tab lists them under the box — and clicking a position
selects the site. On the Check page, **Add sites as primer_bind** annotates
them all, as one step a single **Undo** takes back, and **Save to My
primers** keeps the primer in [My primers](#my-primers).

A **degenerate primer** — one with ambiguity codes, such as `NNK` for a codon
library — is a mix of molecules, and the check says so: **mix of 8** gives
how many molecules the mix holds, and its tooltip how many positions are
degenerate. Tm and GC content are given as the range over the mix
(`Tm 58.2–63.9 °C`). A setting is broken when all of the mix breaks it, and
**Part of the mix** says when only some does. Past 4,096 molecules (six
`N`s) the Tm is not given. A code binds wherever it stands for the
template's base, so a degenerate primer's sites are the ones some molecule
of the mix binds at, as in PCR. Hairpins and dimers are counted on the
plain bases.

Use this to check a primer from a paper or an old order against the plasmid
you have, and to spot off-target binding.

Note that this search asks whether the **whole** oligo matches, which is the
right question for "is this primer specific to my plasmid" and the wrong one
for a cloning primer with a 5′ tail — a restriction site or a Gibson homology
arm matches the template nowhere. To amplify with such a primer, use
[Cloning ▸ PCR](12-cloning.md#pcr), which anneals by the 3′ end and reports
the rest as a tail. To design the tailed primers that fuse two or more fragments
by PCR, use the Bench's [Overlap PCR](12-cloning.md#overlap-pcr).

## My primers

**My primers**, the workspace's last page (the tab's **My primers…** button
opens it, with the count), is your own list of primers as a table: a name,
the bases, the length (**nt**), the Tm of the bases (none for a degenerate
primer) and notes for each, with **Edit**, **PCR fwd**, **PCR rev** and
**Delete** at the right. Click a column heading to sort by it, again for
the other way round; the order is remembered. The box above the table
finds primers by name, notes or bases. The list is kept in this browser's
storage, beside the recent files, and like it it never leaves the browser
except as a file you download, or as the two primers of a pair you send to
Primer-BLAST (below). It is the same list whichever document is open. On a
phone the table scrolls sideways.

### Adding primers

- **Add primers ▸ One primer**: a name, the bases (5′ to 3′, IUPAC codes
  allowed) and notes. Without a name it is called `Primer 1`, `Primer 2` and
  so on.
- **Add primers ▸ Paste many**, then **Add pasted**, or **From a file…**,
  reads a list in any of these shapes:
  - FASTA: `>name notes` and the bases on the lines below;
  - a table, as CSV, tab-separated (what a spreadsheet copies) or
    semicolon-separated: with a header naming `name`, `sequence` and `notes`
    columns in any order, or without one, when the column of bases is the
    sequence, the first other column the name and the rest notes;
  - one primer per line, the bases alone or after a name;
  - an Excel workbook (`.xlsx`), such as an oligo order sheet. Its sheets
    are tried in order and the first one with a primer in it is read, as a
    table is; the report says which sheet when there are several. Sheets are
    not added together. A workbook in which no sheet has a primer is turned
    away with the names of its sheets. An old `.xls` workbook or an
    OpenDocument `.ods` one is not read: save it as `.xlsx` or CSV first.

  The header need not be the first row: a title or address above it is
  passed over. Order-sheet headers such as `Oligo Name`, `Sequence Name`,
  `Sequence (5' to 3')` or `Sequence 5'->3'` are understood, and a
  `5' Modification` column is added to the notes. `5′-…-3′`, spaces
  between the bases and IDT's modification codes (`/5Phos/ACGT…`, which go
  into the notes) are fine. You can also drop the file on the **Paste many**
  box; a file is read by what is in it, whatever its name. Lines (or a
  sheet's rows) with no primer in them are named in the report under the
  box. A primer already in the list under the same name and with the same
  bases is left out rather than added twice; the same bases under another
  name are added.

- **Save both** under a designed pair, and **Save to My primers** under
  **Check a primer**.
- **From this document's primer_bind features** adds every `primer_bind`
  feature of the open document, and **Save to My primers** in the feature
  editor adds one. The oligo is taken from a `sequence:` note when the
  feature has one (the Primers tab and SnapGene write one, and it holds a
  5′ tail the template does not have), otherwise it is the bases under the
  feature, read along its strand.

**Edit** and **Delete** change one primer; **Delete all…**, at the foot of
the page, asks once more before emptying the list.

### A pair from the list

Tick the box at the left of two primers, the forward one first, and a
line under the table names the pair: **Check specificity…** opens NCBI
Primer-BLAST with the two in its form (what that sends is
[above](#checking-specificity-with-ncbi-primer-blast)), **Swap** turns
the pair round, **Use in PCR** puts them in the two slots of
[Cloning ▸ PCR](12-cloning.md#pcr), and **Clear** unticks both.

### Finding where they bind

Tick **Find in** _the document_, beside the filter box. Every primer of
the list is searched on both strands and, on a circular sequence, through
the origin, the way [PCR](12-cloning.md#pcr) anneals a primer: by its 3′
end. The last five bases must match exactly; before them up to two
mismatches are allowed (**Mismatches** sets it, from none to three), and a
site needs at least 15 annealed bases (**Shortest site** sets it, from 10
to 20). The two settings appear beside the tick box while it is ticked,
with how many of the primers bind. What does not anneal at the 5′ end is
reported as a tail, so a cloning primer with a restriction site or a
homology arm on it is found by the part that binds.
Primers shorter than the shortest site are counted but not searched; lower
**Shortest site** to search a short sequencing primer. Under 15 bases a site
is more likely to be there by chance, which is why it is not the default.

Each site is listed under the table with its strand, position, name,
mismatches and tail, and every site is drawn on both views at once as a
[preview](03-viewing.md#previews), mismatches marked on its arrow. The
search runs again as you edit.

- Click a site to select the bases it anneals to.
- **Add** annotates one site as a `primer_bind` feature, with the whole
  oligo in a `sequence:` note and the primer's notes after it; **Add all
  sites as primer_bind** annotates every one. Either is one step in the
  History, so a single **Undo** takes it back.
- **PCR fwd** on a forward site, or **PCR rev** on a reverse one, puts the
  primer in that slot of [Cloning ▸ PCR](12-cloning.md#pcr), under its own
  name; the list's own **PCR fwd** and **PCR rev** buttons do the same for
  any primer. A line under the sites says what PCR holds, and **Open PCR**
  goes there. Editing the bases in PCR by hand drops the name.

At most 200 sites are listed and drawn; a primer inside a repeat can bind
many more.

### Downloading the list

**Download CSV** writes `primers.csv` (`name,sequence,notes`), which reads
back exactly as it was. **Download FASTA** writes `primers.fasta`, one
`>name notes` record per primer; a FASTA name ends at the first space, so
spaces in a name become underscores. Either can be pasted or loaded back, in
this browser or another. Download the list now and then: a browser can clear
its storage (see [Files and storage](02-files.md#local-storage-and-recent-files)).
