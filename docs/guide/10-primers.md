# Primers

The **Primers** tab designs PCR primer pairs for a selected region, checks
primers you already have, and keeps your own list of primers,
[My primers](#my-primers), with where each of them binds on the document.

Melting temperatures use the nearest-neighbour method (SantaLucia 1998,
unified parameters) at 500 nM oligo and 50 mM monovalent salt. They are
good to about ±2 °C for ordinary PCR primers; adjust for your buffer.

## Designing primers for a region

1. Select the region to amplify in either view. It can be a feature (click
   it in the Features tab) or any range.
2. Open **Primers** and click **Design primers**.
3. Up to ten pairs are listed, best first. Each shows the forward and
   reverse primer with its Tm and GC content, the product size and the Tm
   difference between the two.
4. **Show** draws that pair in both views without touching the document:
   the two sites as dashed arrows pointing the way each primer reads, and
   the product between them as a bracket (see
   [Previews](03-viewing.md#previews)). It also selects the product, so the
   views scroll to it and the status bar gives its length. **Hide** takes
   both away again, the drawing and the selection, as does leaving the tab;
   if you have selected something else in the meantime that selection is
   yours and is left alone. Hovering a pair shows it for as long as the
   pointer is there — so three candidates can be compared without annotating
   anything.
5. **Add both as features** annotates the pair as `primer_bind` features
   (the primer sequence goes in a `/note`), so the sites are on the map and
   saved with the file. Unlike **Show**, this is an edit: it goes into the
   History and can be undone.
6. **Save both** keeps the two primers in [My primers](#my-primers), named
   after the document (`pUC19 fwd 1`, `pUC19 rev 1`), with the target, Tm
   and GC content in their notes.

If nothing qualifies, select more flanking sequence, look further from the
selection, or loosen the settings.

## Settings

**Settings**, under the target, sets what a designed primer has to be. Every
candidate that breaks one of them is refused, and the same numbers are what
**Check a primer** warns about, so a pasted primer is judged by the rules the
designed ones had to pass. They are remembered in this browser, from plasmid
to plasmid; **Reset to defaults** puts them back.

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

Among the candidates that pass, pairs are ranked by a penalty that favours
a Tm in the middle of the range, GC in the middle of its range, a GC clamp,
little self-complementarity or hairpin, a length near 21 nt and a small Tm
difference.

## Checking a primer

Paste a sequence under **Check a primer**. You get its length, Tm, GC
content and whether it ends in a GC clamp, plus a warning for each setting it
breaks — too short or too long, Tm or GC out of range, a long run of one
base, a hairpin, a self-complementary stretch, a 3′ end that pairs with
itself — and for a missing GC clamp.

With eight or more bases, the tab also searches the document for **binding
sites** on both strands: the 3′ end must match exactly and up to two
mismatches are allowed elsewhere. Every site found is previewed in both
views at once, so off-target binding is visible at a glance, and a site's
mismatches are marked on its arrow at the bases they fall on. Each site also
shows its strand, position and mismatch count in the list; click one to
select it, or **Add sites as primer_bind** to annotate them all. **Save to My
primers** keeps the primer in [My primers](#my-primers).

A **degenerate primer** — one with ambiguity codes, such as `NNK` for a codon
library — is a mix of molecules, and the check says so: how many positions
are degenerate and how many molecules the mix holds. Tm and GC content are
given as the range over the mix (`Tm 58.2–63.9 °C`). A setting is broken when
all of the mix breaks it, and **Part of the mix** says when only some does.
Past 4,096 molecules (six `N`s) the Tm is not given. A code binds wherever it
stands for the template's base, so a degenerate primer's sites are the ones
some molecule of the mix binds at, as in PCR. Hairpins and dimers are counted
on the plain bases.

Use this to check a primer from a paper or an old order against the plasmid
you have, and to spot off-target binding.

Note that this search asks whether the **whole** oligo matches, which is the
right question for "is this primer specific to my plasmid" and the wrong one
for a cloning primer with a 5′ tail — a restriction site or a Gibson homology
arm matches the template nowhere. To amplify with such a primer, use
[Cloning ▸ PCR](12-cloning.md#pcr), which anneals by the 3′ end and reports
the rest as a tail.

## My primers

**My primers**, at the bottom of the Primers tab, is your own list of
primers: a name, the bases and notes for each. It is kept in this browser's
storage, beside the recent files, and like them it never leaves the browser
except as a file you download. It is the same list whichever document is
open.

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
  - one primer per line, the bases alone or after a name.

  `5′-…-3′` and spaces between the bases are fine. Lines with no primer in
  them are named in the report under the box. A primer already in the list
  under the same name and with the same bases is left out rather than added
  twice; the same bases under another name are added.

- **Save both** under a designed pair, and **Save to My primers** under
  **Check a primer**.
- **From this document's primer_bind features** adds every `primer_bind`
  feature of the open document, and **Save to My primers** in the feature
  editor adds one. The oligo is taken from a `sequence:` note when the
  feature has one (the Primers tab and SnapGene write one, and it holds a
  5′ tail the template does not have), otherwise it is the bases under the
  feature, read along its strand.

**Edit** and **Delete** change one primer; **Delete all…** asks once more
before emptying the list. Past eight primers a filter box finds them by name,
notes or bases.

### Finding where they bind

Tick **Find my primers in** _the document_. Every primer of the list is
searched on both strands and, on a circular sequence, through the origin, the
way [PCR](12-cloning.md#pcr) anneals a primer: by its 3′ end. The last five
bases must match exactly; before them up to two mismatches are allowed
(**Mismatches** sets it, from none to three), and a site needs at least 15
annealed bases. What does not anneal at the 5′ end is reported as a tail, so a
cloning primer with a restriction site or a homology arm on it is found by the
part that binds. Primers shorter than 15 bases are counted but not searched.

Each site is listed with its strand, position, name, mismatches and tail,
and every site is drawn on both views at once as a [preview](03-viewing.md#previews),
mismatches marked on its arrow. The search runs again as you edit.

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
