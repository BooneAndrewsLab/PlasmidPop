# Restriction enzymes

The **Enzymes** tab scans the sequence for the recognition sites of a
bundled table of about 130 common, commercially available enzymes. The scan
runs in the background whenever the sequence changes, on both strands, and
handles ambiguity codes in recognition sequences (`GRCGYC`), enzymes that cut
outside their site (Type IIS such as BsaI and BsmBI) and sites that wrap the
origin of a circular sequence. You can swap the bundled table for the whole
of REBASE — see [Importing the full REBASE table](#importing-the-full-rebase-table)
below.

## Reading the list

Each row is one enzyme that cuts the sequence — or, with isoschizomers
sharing a row, every enzyme that cuts it identically (see
[Isoschizomers](#isoschizomers)):

- a **tick box** that chooses the enzyme: its cut sites are drawn in the
  views, and the Cloning tab digests with it;
- the **name**, with **+N** after it when N other enzymes share the row
  (hover it for their names);
- the **recognition site**, 5′→3′ on the top strand (hover to see whether it
  leaves a blunt end, a 5′ overhang or a 3′ overhang);
- the **cut positions**: the base after which the top strand is cut. Click
  one to select that recognition site in the views;
- the **bands** this enzyme alone would give, largest first, as a gel would
  show them. Fragments within about 15 % of each other are written as one
  band (`2,181 ×2`), because that is what you would see. A ⚠ means the lane
  would hide something — pieces running as one band, or bands under 100 bp
  that may run off the end — and the tooltip says which. An enzyme that
  simply linearises the plasmid gets no mark: there is nothing to tell
  apart, which is not a fault.

The list scrolls inside the panel, so what is below it — the counts, the
import link, the fragment sizes — stays where you left it however many
enzymes cut. Only the rows on screen are drawn, which is what keeps an
imported table of 1,500 enzymes responsive; a browser page search (Ctrl+F)
will not find an enzyme that is scrolled out of sight, so use the filter box
for that.

Below the list: how many enzymes cut, and how many do not cut at all.

## Choosing which to show

- When a document opens, the enzymes that cut **exactly once** are ticked,
  so unique sites are on the map at once. If there are more than 50 of them
  — which happens with an imported REBASE table, where a small fragment can
  have ninety unique cutters — nothing is ticked instead, because ninety
  labels is a wall rather than a starting point. The tab then offers **Tick
  the N enzymes that cut once** if you want them after all; with a **Cuts**
  filter set, it offers those instead — **Tick the N enzymes that cut
  twice**.
- Tick or untick individual enzymes. **Show listed** ticks every enzyme
  currently in the (filtered) list, **Hide all** clears them. Show listed
  asks for a narrower list past 200 enzymes: more labels than that is more
  than the views can draw.
- **Filter** by name (`Eco`) or by site (`GGATCC`).
- **Cuts** lists only the enzymes that cut a chosen number of times: once (a
  unique site to clone into), twice, once or twice, or three times or fewer.
  A **diagnostic digest** is the usual reason for wanting more than one — an
  enzyme that cuts twice gives two bands to check a construct against, where
  a unique cutter only linearises it. **Any number** is the default.
- **Order** sorts the list. _Name_ is the catalogue. _Band separation_ puts
  the enzymes whose bands are easiest to tell apart on a gel first, and the
  ones whose bands would run together last, which is how a diagnostic digest
  is actually chosen. Bands twice as long as each other are as distinct as
  bands ever get, so past that the order prefers a lane whose smallest band
  is bright — 500 bp or more — over one with a faint sliver at the foot.
- **Sold by** narrows the list to one supplier's catalogue. It appears only
  after you import a REBASE table, which is where the supplier information
  comes from.

- **Isoschizomers: share a row** is described [below](#isoschizomers).

**Cuts**, **Order**, **Sold by** and **Isoschizomers** are remembered between sessions, like
the toolbar's view settings: they say what you are generally looking for
rather than anything about the document. The name filter is not — it is a
question about the list in front of you, not a standing choice.

Cut sites of the ticked enzymes are drawn in the sequence view (a mark with
the enzyme name above the bases) and on the map (labels around the ring), and
they are included in **Export map as SVG** and **Export sequence view as
SVG**.

## Choosing a diagnostic digest

Set **Cuts** to _Twice_ and **Order** to _Band separation_. The enzyme at the
top gives the two bands easiest to read, which is the one to run. On pBR322
that is HincII, at 3,254 + 1,107 bp, with BstAPI and DrdI (3,948 + 413) just
behind it; BtsI also cuts twice, but its two cuts are 20 bp apart, so it is
at the bottom with a ⚠ and one band you could see.

When no single enzyme will do, **Double digests** under the list offers the
five best pairs of the enzymes listed, judged by the same rule on the digest
with both — on pBR322, EagI + MscI at 3,854 + 507 bp. It appears while the
list is ordered by band separation, pairs only enzymes that cut three times
or fewer, and follows the other filters, so _Sold by_ narrows the pairs to
what you can buy from one place. A pair whose second enzyme cuts only where
the first already does is left out, since it is the same digest as one
enzyme alone. **Tick both** ticks that pair and nothing else, and the gel
then shows it beside each enzyme alone. With a big imported table only the
120 enzymes that cut least are paired; narrow the list to pair the others.

Tick a candidate and the **Fragments from ticked enzymes** section below the
list says what the whole digest would look like — several enzymes ticked
together give a lane none of their own rows can predict.

### A double digest beside the single ones

Tick two enzymes (or three) and the gel draws a lane for each of them alone
and a last lane, **Both** (or **All 3**), for the digest with all of them —
the way a double digest is run at the bench, so a band can be read off
against the lanes that explain it. A band in **Both** that is in neither
single lane is the piece between the two enzymes' sites. The sizes are
written beside the combined lane; hover a band in any lane for its size, and
the line under the gel lists what each enzyme gives alone. Tick four or more
and the gel goes back to one lane for them all.

## Isoschizomers

Enzymes from different organisms often recognise the same site and cut it
in the same place — BamHI, BstI and a dozen others all cut `G^GATCC`. They
give the same fragments with the same ends, so at the bench they are one
choice whatever the label on the tube. With **Isoschizomers: share a row**
ticked (the default), they are listed as one row: an imported REBASE table
of about 1,550 enzymes becomes about 400 rows.

- The row carries the best-known name: an enzyme from the bundled table if
  there is one, otherwise the one sold by most companies. A name you
  searched for, or one you ticked, takes its place, and with **Sold by**
  set only that supplier's enzymes can name the row.
- Ticking the row ticks the enzyme named on it, and unticking it unticks
  every enzyme in the row.
- When a document opens and its single cutters are ticked, one enzyme per
  row is ticked, so one cut is drawn with one label rather than twelve.
- The count under the list still counts enzymes, and says how many rows
  they take.

Enzymes that recognise the same site but cut it differently —
_neoschizomers_ such as SmaI (`CCC^GGG`, blunt) and XmaI (`C^CCGGG`, 5′
overhang) — keep separate rows, because the ends they leave are what a
cloning plan depends on. Untick **share a row** to list every enzyme on its
own.

## Hiding the cut sites without losing the choice

**Cut sites** in the toolbar, next to Complement and Translations, hides
every drawn cut site at once — useful when a map with a dozen labels is too
busy to read. The ticks stay exactly as they are, so switching it back on
restores the same set; no need to untick and re-tick a carefully chosen list.
The toggle is remembered between sessions (see
[Viewing and selecting](03-viewing.md)); the ticks are not, they start again
at the single cutters of each document you open (or at nothing, with a big
table).

While it is off:

- the sequence view, the map, **Export map as SVG** and **Export sequence
  view as SVG** draw no cut sites;
- the **Fragments from ticked enzymes** list below and the
  [Cloning](12-cloning.md) tab's digest are unchanged — they follow the
  ticks, not the toggle.

The Enzymes tab says so while the sites are hidden, and offers a **Show cut
sites** link to bring them back.

## Fragments

**Fragments from ticked enzymes** draws the lane a complete digest with all
ticked enzymes would give (with a lane for each enzyme alone beside it when
two or three are ticked), beside a ladder — 1 kb, or 100 bp when everything
is small. A short band is drawn faint, because a stain binds DNA by mass and
a 200 bp band really is faint next to a 4 kb one. **Click a band to select
that piece** — in a single enzyme's lane, the piece that enzyme alone cuts — in the sequence view and on the map; where two pieces run
together, the click takes the larger one, and the band says so when you hover
it.

Under the lane are the fragment sizes themselves, largest first — on a
circular molecule, n cuts give n fragments; on a linear one, n + 1 — and then
**On a gel**, which says in words what the picture cannot: which pieces would
run together, and whether any are too small to stay on the gel.

The gel is a rule of thumb for a standard 1 % agarose gel, not a simulation
of one: band positions are calculated from the length, two fragments within
about 15 % of each other are called one band, anything under 100 bp may run
off the end, and more than one fragment over 10 kb will compress near the
well. Your gel may do better or worse.

For the fragments themselves, with their ends and the features they carry,
and to join them into a new construct, use the [Cloning](12-cloning.md)
tab.

## How to check whether an enzyme is a unique cutter

1. Open the **Enzymes** tab.
2. Type the enzyme name in the filter box.
3. Look at the number of cut positions in its row. Set **Cuts** to _Once_ to
   list all unique cutters at once.

## Importing the full REBASE table

The bundled table is deliberately small: the enzymes most people clone with.
For everything else — and for supplier and isoschizomer information —
import [REBASE](https://rebase.neb.com), the restriction enzyme database
Richard Roberts and colleagues have maintained since 1975.

PlasmidPop cannot download it for you. REBASE files are copyright "all
rights reserved", so we have no right to ship them, and rebase.neb.com does
not allow a web page to fetch them. You download the file; the app reads it.

1. Open the **Enzymes** tab and click **Import a REBASE table…** at the
   bottom of the list.
2. Follow **Download withrefm from REBASE**. The file opens as plain text in
   a new tab — save it with Ctrl+S, or right-click the link and choose _Save
   link as_. It is about 4 MB.
3. Back in PlasmidPop, click **Choose file…** and pick what you saved
   (usually `link_withrefm.txt`), or drop the file onto the panel. The
   picker asks for text files; if your browser saved it without an
   extension, switch the picker to _All files_.

The table is read in your browser, kept in this browser's local storage, and
never uploaded anywhere. It survives reloads, and the Enzymes tab says which
release it is scanning with. **Go back to the bundled table** undoes the
import.

Of the roughly 6,100 records in REBASE, about 1,580 become usable enzymes.
The panel reports what it left out: enzymes whose cut position nobody has
determined, and the ones that cut at a modified base rather than at a
sequence (AbaSI, MspJI and kin), whose REBASE site is a base or two and
would otherwise appear to cut everywhere.

About 27 of them — BcgI, BaeI, CspCI, BsaXI and kin — cut on _both_ sides
of their recognition site, cutting it out on a piece of about 30 bp. Each
site of theirs is two cuts, so such an enzyme with one site in your plasmid
is listed as cutting twice, draws two cut marks, and in a digest cuts out
the short piece carrying the site. The tooltip on
its recognition site says so. They are not offered for Golden Gate. A table
imported before version 1.2 does not have them; import it again to add
them.

Scanning with the whole table takes about 80 ms on a 4 kb plasmid instead of
7 ms, in the background, so the list takes a moment longer to appear.

If you publish work that used it, please cite REBASE: Roberts RJ, Vincze T,
Posfai J, Macelis D, _REBASE — a database for DNA restriction and
modification: enzymes, genes and genomes_, Nucleic Acids Research.

## Notes

The bundled table was typed from supplier catalogues and has no supplier,
isoschizomer or methylation information; an imported REBASE table adds all
three (hover an enzyme's recognition site to see them). What REBASE calls
the methylation site is where the enzyme's _own_ methyltransferase modifies
the site — it is not a statement about whether Dam or Dcm methylation from
your _E. coli_ strain will block the enzyme. PlasmidPop does not warn about
that yet.

Cut positions are given on the top strand; the bottom-strand cut and the
overhang are used by the Cloning tab.
