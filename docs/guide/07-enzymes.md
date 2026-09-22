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

Each row is one enzyme that cuts the sequence:

- a **tick box** that chooses the enzyme: its cut sites are drawn in the
  views, and the Cloning tab digests with it;
- the **name**;
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
  the enzymes whose fragments are furthest apart on a gel first, and the
  ones whose bands would run together last, which is how a diagnostic digest
  is actually chosen.
- **Sold by** narrows the list to one supplier's catalogue. It appears only
  after you import a REBASE table, which is where the supplier information
  comes from.

**Cuts**, **Order** and **Sold by** are remembered between sessions, like
the toolbar's view settings: they say what you are generally looking for
rather than anything about the document. The name filter is not — it is a
question about the list in front of you, not a standing choice.

Cut sites of the ticked enzymes are drawn in the sequence view (a mark with
the enzyme name above the bases) and on the map (labels around the ring), and
they are included in **Export map as SVG** and **Export sequence view as
SVG**.

## Choosing a diagnostic digest

Set **Cuts** to _Twice_ and **Order** to _Band separation_. The enzyme at the
top gives the two bands furthest apart, which is the one to run. On pBR322
that is DrdI, at 3,948 + 413 bp; BtsI also cuts twice, but its two cuts are
20 bp apart, so it is at the bottom with a ⚠ and one band you could see.

Tick a candidate and the **Fragments from ticked enzymes** section below the
list says what the whole digest would look like — several enzymes ticked
together give a lane none of their own rows can predict.

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

**Fragments from ticked enzymes** lists the sizes of the pieces a complete
digest with all ticked enzymes would produce, largest first. On a circular
molecule, n cuts give n fragments; on a linear one, n + 1. Under it, **On a
gel** says how that lane would read: how many bands, which pieces would run
together, and whether any are too small to stay on the gel.

The gel is a rule of thumb for a standard 1 % agarose gel, not a simulation
of one: two fragments within about 15 % of each other are called one band,
anything under 100 bp may run off the end, and more than one fragment over
10 kb will compress near the well. Your gel may do better or worse.

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
determined, the handful (BcgI and its kin) that cut on _both_ sides of their
recognition site, which PlasmidPop cannot yet represent, and the ones that
cut at a modified base rather than at a sequence (AbaSI, MspJI and kin),
whose REBASE site is a base or two and would otherwise appear to cut
everywhere.

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
