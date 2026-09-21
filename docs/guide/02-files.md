# Files and storage

## Formats

| Format     | Extensions                             | Open | Download   |
| ---------- | -------------------------------------- | ---- | ---------- |
| GenBank    | `.gb` `.gbk` `.genbank` `.gbff` `.ape` | yes  | yes        |
| FASTA      | `.fa` `.fasta` `.fna` `.seq` `.txt`    | yes  | export     |
| SnapGene   | `.dna`                                 | yes  | no         |
| Bare bases | `.txt`, or pasted                      | yes  | as GenBank |

The format is sniffed from the content first, so a GenBank record in a
`.txt` file still opens as GenBank. If a file holds several records, the first
one is opened.

**GenBank** is the native format: sequence, topology, definition, accession,
references, and every feature with its full location (`complement(...)`,
`join(...)`, partial ends, ranges that wrap the origin) and qualifiers.
A download writes a standard GenBank flat file that other programs can read.
Anything PlasmidPop does not understand in a record is reported as a warning
in the status bar rather than silently dropped.

A molecule with sticky ends — a fragment from a digest, say — has something
GenBank cannot express, so the ends travel as a `PlasmidPop-ends:` comment
line. Other software sees an ordinary comment; PlasmidPop reads it back as
the document's ends (see [Simulated cloning](12-cloning.md)).

**ApE** files are GenBank with extra colour qualifiers; those colours are
used for the features.

**FASTA** gives a bare sequence. A header ending in `[topology=circular]`
makes the sequence circular. Gaps and digits are stripped with a warning;
protein FASTA is rejected.

**SnapGene `.dna`** files are read for sequence and topology, features
(including segmented features and their colours), primers (as `primer_bind`
features) and notes (description, organism, references). Enzyme sets,
history, alignments and appearance settings are skipped. PlasmidPop cannot
write `.dna`; download GenBank instead.

**Geneious** files are not supported. Export them as GenBank first.

## Several documents at once

Every document you open gets a tab in the strip under the toolbar, so a
vector and its insert can be open side by side. **Open file**, **New**,
**Open example**, a dropped file, a pasted record, a ligation product and a
fragment opened from the Cloning tab all open in a new tab and bring it to
the front. Opening a file that already has a tab goes to that tab instead of
opening it twice — unless that tab has been edited, which makes it a
[working copy](#working-copies) rather than the file — and a "New" document
nothing has been typed into gives its tab up to the next file you open.

- Click a tab to switch to it. Each tab keeps its own selection, undo
  history, enzyme ticks, cut sites and find bar; the view switcher, the
  toggles, the Format and Edits settings and the sidebar tab are the same
  for all of them.
- The **×** on a tab (or **File ▸ Close**) closes it. The document stays in
  the browser's storage and under **Recent files**; only its undo history is
  gone.
- The **Files** tab at the left is the start screen with the recent files;
  the logo and **File ▸ Show files** go there too. The other tabs stay open
  behind it, and entries that are open in a tab are marked **open**.
- **+** at the right of the strip starts a new sequence, like **New**.
- A dot after a tab's name means that document differs from the file on
  disk. The browser warns before you close it while any tab is in that
  state.

The open tabs, their order and the one in front are remembered, so a reload
brings them all back.

## Working copies

**The file you open is never written to.** The first edit to a document that
came from a file turns that document into a _working copy_: it takes a name
of its own — `pBR322` becomes `pBR322 copy` — and a line under the toolbar
says which file it came from and what this copy is called. Whatever happens
in that tab afterwards, the file on disk is exactly as it was.

- **Rename**, on that line, gives the copy a name of your own; so does
  clicking the name in the toolbar. That name is what a download will be
  called, so it is worth setting early. If your first action is a rename, the
  copy is called what you called it and never carries a `copy` name at all.
- **See what changed**, at the right of the line, shows the differences
  against the original at any time.
- Opening the same file again gives you the original back in its own tab, so
  the two can be compared side by side.
- The copy's history starts at the contents of the file, under the copy's
  name. Undo therefore takes you back to what the file holds and stops
  there — there is no state in which the tab is the original again, and no
  edit that renames the document behind your back.
- A document from **New**, a paste, the bundled example, a ligation or a
  fragment opened from the Cloning tab has no file on your disk to protect
  and is never forked.

## Downloading

**PlasmidPop never writes to a file on your disk.** Documents live in this
browser as you work on them (see
[Local storage and recent files](#local-storage-and-recent-files)); when you
want one as a file, you download it, and the file is yours from then on.
Downloads are always GenBank.

- **Download GenBank…** (`Ctrl+S`, and `Ctrl+Shift+S` out of habit) writes
  the document in front.
- A **working copy** is reviewed first: what it changed about the file it
  came from — a summary line, each changed stretch of sequence drawn with the
  same marks the sequence view uses for tracked changes and headed with where
  it is and what happened there (`around 1,204  inserted 5 bp; deleted 3 bp`),
  and the features added, changed or removed. **Download** writes it;
  **Cancel** writes nothing.
- In Chrome and Edge the browser then asks where to put the file, with the
  name filled in — the name you chose last time for this document, so you can
  point at the same file again and replace it. In Firefox and Safari a page
  may not ask, so the file lands in your downloads folder under a name the
  browser decides (see below).
- The name PlasmidPop offers comes from the document's own name, never from
  the file the copy was made from: `pBR322` is offered as `pBR322_copy.gb`.
  Rename the document (double-click its name in the Features tab) to change
  it, or type another name in the browser's dialog.

The dot after the document name means it has changed since the last download.

### Downloading in Firefox and Safari

Chrome and Edge can ask a page where to put a file; Firefox and Safari
cannot, so every download lands in your downloads folder with the browser
naming it. Download the same document twice and you have `pBR322_copy.gb` and
`pBR322_copy(1).gb`: two downloads of the same document at different moments,
not two versions PlasmidPop made. A line under the toolbar says so the first
time; **Got it** puts it away for good.

Firefox can be told to ask, and then you can replace the earlier file
yourself:

1. Open `about:preferences` (☰ ▸ **Settings**), **General** ▸ **Downloads**.
2. Choose **Always ask you where to save files**.

Every download then opens the system dialog with the name filled in; point it
at the file you downloaded before and confirm **Replace**. Safari has the same
setting under **Settings ▸ General ▸ File download location ▸ Ask for each
download**.

Nothing is lost in the meantime: every open document is written to this
browser's own storage as you work and comes back when you return. Downloading
is how you get a file _out_ of PlasmidPop, not how you avoid losing work.

## Exporting

From the **File** menu:

- **Export map as SVG**: the circular map as a standalone vector file for
  figures, with the cut sites of the enzymes ticked in the Enzymes tab —
  none of them while the toolbar's **Cut sites** toggle is off.
- **Export sequence view as SVG**: the sequence rows as a vector file —
  ruler, bases, features and cut sites, laid out as on screen. It follows the
  **Complement**, **Translations** and **Cut sites** toggles, the **Edits**
  marks, the enzymes ticked in the Enzymes tab and the **Format** menu's
  bases-per-row, complement numbering and base colours. With Format left at
  "Fit the window" the file is written 60 bases to a row, so it does not
  depend on the window width; the text size is always the export's own.
  Sequences longer than 100,000 bases are refused: export a range instead.
- **Export selection view as SVG**: the same picture, cut down to the rows
  that hold the selection and with the selection highlighted. Positions stay
  those of the whole document. A selection that crosses the origin has no
  contiguous rows, so the whole sequence is written instead.
- **Export sequence as FASTA**.
- **Export selection as GenBank** or **as FASTA**: just the selected bases,
  with the features that fall inside them trimmed to the selection. The
  selection may wrap the origin of a circular sequence.

The **Translate** tab has its own **Export FASTA** for six-frame
translations, see [Translation](09-translate.md).

## Local storage and recent files

Every open document is written to the browser's storage (IndexedDB) half a
second after each change, and again when you leave the page, so a closed tab
or a crash loses nothing. On the
start screen (the **Files** tab), **Recent files** lists these documents with
size, topology, feature count and when they were last changed. Opening the
same file twice does not create a second entry.

- Click an entry to reopen it in a tab, or to go to its tab when it is
  already **open**. A working copy comes back as a working copy, under the
  name it was given, and the file it came from is still untouched.
- **Rename** changes the stored name (and the document name, when it is
  open, as an undoable change in that tab).
- **Remove** deletes it from the browser and closes its tab. This does not
  touch files on disk.
- **File ▸ Show files** goes back to this list while keeping every tab
  open.

The view switcher and the Complement, Translations and Cut sites toggles are
remembered in the same browser storage, see
[Viewing and selecting](03-viewing.md).

Local storage is per browser profile and per device. The first time a
document is written there, PlasmidPop asks the browser to keep that storage
rather than clear it when space runs low; Chrome and Edge decide for
themselves, Firefox asks you, and saying yes means your documents are not
among the first things thrown away. Clearing site data still removes them,
and a private window keeps nothing.

So: this browser is where your work lives while you are working, and it is
not a backup. Download the documents you want to keep as files.

## Usage statistics

The public build sends anonymous usage statistics to a self-hosted
[Matomo](https://matomo.org) instance: page views and coarse events such as
"opened a GenBank file", "ran a ligation" or "exported the map as SVG".
Never sent: sequences, feature names, file names or anything else from your
documents. The tracker sets no cookies and the instance anonymises IP
addresses. If your browser sends a Do-Not-Track signal, nothing is sent at
all. Builds without a configured instance never send anything.

## Offline use

PlasmidPop is a progressive web app. After the first visit it works without a
network connection, and the browser offers to install it. When installed,
sequence files can be opened with it from the file manager.
