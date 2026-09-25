# Files and storage

## Formats

| Format     | Extensions                             | Open | Download             |
| ---------- | -------------------------------------- | ---- | -------------------- |
| GenBank    | `.gb` `.gbk` `.genbank` `.gbff` `.ape` | yes  | yes                  |
| FASTA      | `.fa` `.fasta` `.fna` `.seq` `.txt`    | yes  | export               |
| SnapGene   | `.dna`                                 | yes  | no                   |
| AB1        | `.ab1` `.abi`                          | yes  | as GenBank, or FASTQ |
| FASTQ      | `.fastq` `.fq`, gzipped or not         | yes  | as GenBank, or FASTQ |
| Bare bases | `.txt`, or pasted                      | yes  | as GenBank           |

The format is sniffed from the content first, so a GenBank record in a
`.txt` file still opens as GenBank. If a file holds several records, the first
one is opened, and a warning in the status bar says how many others there
were. AB1 and FASTQ files are sequencing reads, with a quality for every
base: see [Sequencing reads](15-reads.md).

**GenBank** is the native format: sequence, topology, definition, accession,
references, and every feature with its full location (`complement(...)`,
`join(...)`, partial ends, ranges that wrap the origin) and qualifiers.
A download writes a standard GenBank flat file that other programs can read.
Anything PlasmidPop does not understand in a record is reported as a warning
in the status bar rather than silently dropped. So is a record that
contradicts itself: a CDS whose stored `/translation` is not the protein its
own bases give (see
[Checking a record against itself](09-translate.md#checking-a-record-against-itself)).

A molecule with sticky ends — a fragment from a digest, say — has something
GenBank cannot express, so the ends travel as a `PlasmidPop-ends:` comment
line. Other software sees an ordinary comment; PlasmidPop reads it back as
the document's ends (see [Simulated cloning](12-cloning.md)). A FASTA file
carries the same text in brackets at the end of the header line
(`>insert [PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt]`), beside the
usual `[topology=circular]`. A SnapGene file's own record of its overhangs
is read on import — a linearised TA vector opens with its 3′ T at each end,
a D-TOPO vector with its 5′ overhang.

Where the DNA was grown travels the same way, as
`PlasmidPop-methylation: dam-; dcm+`, and only when it is not an ordinary
`dam+ dcm+` plasmid (see
[Where the DNA was grown](07-enzymes.md#where-the-dna-was-grown)).

What a product of a simulated reaction was made from travels as a block of
`PlasmidPop-made-from:` comment lines, one per molecule of its tree (see
[What a product was made from](12-cloning.md#what-a-product-was-made-from)).

A line of ours that cannot be read — edited by hand into something that no
longer parses, say — is kept as an ordinary comment rather than dropped, in
GenBank and in a FASTA header alike, so it is still there to fix.

**ApE** files are GenBank with extra colour qualifiers; those colours are
used for the features.

**FASTA** gives a bare sequence. A header ending in `[topology=circular]`
makes the sequence circular. Sticky ends and where the DNA was grown travel
in the header too, as `[PlasmidPop-ends: ...]` and
`[PlasmidPop-methylation: ...]`, the same text as the GenBank comment lines.
What a product was made from does not: it is too long for a header line, so
a FASTA export leaves it out. Gaps and digits are stripped with a warning;
protein FASTA is rejected.

**SnapGene `.dna`** files are read for sequence and topology, features
(including segmented features and their colours), primers (as `primer_bind`
features), sticky ends and notes (description, organism, references). Enzyme
sets, history, alignments and appearance settings are skipped. PlasmidPop
cannot write `.dna`; download GenBank instead. Files from current SnapGene
versions are what is tested; before version 1.2, primers were placed one base
to the left of where SnapGene has them, and a primer SnapGene stores twice
came in twice — reopen the `.dna` file to get them right.

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

- Click a tab to switch to it, or press `Alt+1` … `Alt+9` for the first to
  the ninth. Each tab keeps its own selection, undo history, enzyme ticks,
  cut sites, find bar and sidebar tab, and comes back scrolled to the row
  and with the map zoomed as you left it; the view switcher, the toggles and
  the Format and Edits settings are the same for all of them.
- Drag a tab along the strip to move it, or press `Alt+Shift+PageUp` /
  `Alt+Shift+PageDown` to move the one in front. `Alt+1` … `Alt+9` follow
  the new order.
- The **×** on a tab, `Alt+W` or **File ▸ Close** closes it. The document
  stays in the browser's storage and under **Recent files**, with its undo
  history: reopening it brings both back (see
  [History](13-history.md#after-a-reload)). (`Ctrl+W` is the browser's, and
  closes PlasmidPop itself.)
- The **Files** tab at the left is the start screen with the recent files;
  the logo and **File ▸ Show files** go there too. The other tabs stay open
  behind it, and entries that are open in a tab are marked **open**.
- **+** at the right of the strip starts a new sequence, like **New**.
- A dot after a tab's name means that document has changed since it was
  last downloaded. Closing the tab, or the page, loses nothing: the document
  is in this browser's storage either way.

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

### What a copy remembers about its original

A working copy also writes down what it came from, and carries that into
every file and link it leaves as:

    COMMENT     PlasmidPop-derived-from: cdseguid=dUxN7YQ… pBR322.gb

The file name is a courtesy; the [checksum](03-viewing.md#the-checksum) is
the part that holds up. A name is what somebody called a file once, while a
checksum is the molecule itself and stays true however the original is
rotated, renamed or exported again — so whoever ends up with `pBR322
copy.gb` can put the original beside it and _check_, rather than take the
line's word for it.

- PlasmidPop says so under the toolbar when you open such a file: **Derived
  from pBR322.gb**, with the checksum. Point **Compare with…** at that file
  and the dialog confirms it is the one, then shows everything that has
  happened since.
- Other software sees an ordinary comment and ignores it. PlasmidPop takes
  the line out of the comments on reading and puts it back on writing, so a
  file never collects copies of it.
- It records the file a copy was forked from, not a chain: a copy of a copy
  names its immediate parent.

## Downloading

**PlasmidPop never writes to a file on your disk.** Documents live in this
browser as you work on them (see
[Local storage and recent files](#local-storage-and-recent-files)); when you
want one as a file, you download it, and the file is yours from then on.
Downloads are always GenBank.

- **Download GenBank…** (`Ctrl+S`, and `Ctrl+Shift+S` out of habit) writes
  the document in front.
- A **working copy** is reviewed first: what it changed about the file it
  came from — a summary line, the whole molecule drawn as a map with the
  changes marked on the ring, each changed stretch of sequence drawn with the
  same marks the sequence view uses for tracked changes and headed with where
  it is and what happened there (`around 1,204  inserted 5 bp; deleted 3 bp`),
  and the features added, changed or removed. Each feature is named and says
  where it is (`− misc_binding 411..414`), a removal included; where one
  deletion took several features with it, the review says so once, naming
  them. A changed feature says what changed — `~ tet type gene → CDS` — with
  qualifiers counted rather than quoted, since a `/note` can be a paragraph. **Download** writes it; **Cancel** writes nothing.
- In Chrome and Edge the browser then asks where to put the file, with the
  name filled in — the name you chose last time for this document, so you can
  point at the same file again and replace it. In Firefox and Safari a page
  may not ask, so the file lands in your downloads folder under a name the
  browser decides (see below).
- The name PlasmidPop offers comes from the document's own name, never from
  the file the copy was made from: `pBR322` is offered as `pBR322_copy.gb`.
  Rename the document — click its name in the toolbar, or **Rename** on the
  working copy's line under it — to change what is offered, or type another
  name in the browser's dialog.

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

## Comparing with another document

**File ▸ Compare with…** (`Alt+K`) shows how the open document differs from
another one: the same review a [working copy](#working-copies) gets before
it is downloaded, asked of any file or tab rather than the one this document
came from.

With other documents open it first asks what to compare with: one of the
other tabs, as it is now, or **A file on disk…**, which opens the file
picker. With no other tab open it goes straight to the picker.

It answers the question a plasmid map on its own cannot — _is this the same
construct as the one in that file, and if not, where do they part company_ —
which is what a colleague's copy, a vendor's sequence or last month's version
of your own plasmid is usually for.

- **Nothing is opened, written or stored** unless you ask. A file is read, compared and
  dropped; no tab appears and neither file changes. The document you are
  looking at is the one that keeps its tab. To work on the other file too,
  **Open _file name_** in the dialog opens it in a tab of its own, exactly as
  **Open file…** would; for another tab, **Go to _tab name_** brings it
  forward.
- **The differences are in this document's coordinates**: what it has that
  the other does not. The map at the top marks them on the ring, so where they
  fall is the first thing you see, with a feature the other has and this one
  does not drawn as a broken red ghost where it would be. Each neighbourhood
  of changed bases is drawn the way the sequence view draws tracked changes,
  and the features added, changed and removed are named below them.
- **The map points into the list.** Click a mark or a wedge on it and the
  review scrolls to the stretch of sequence it is in and lights it for a
  moment; click a ghost and it goes to that feature's line. The other way
  round, a removed feature's name in the Features list is a link: click it and
  its ghost is picked out on the map. Neither changes your selection — the
  review is not the editor. The same holds in the review before a download.
- **Features are matched by what they are**, since two files give the same
  feature different internal ids. A feature both agree on to the last
  qualifier is not reported. One that differs is matched to the feature it
  became when it is still in the same place and still recognisable, by its
  name or by its type, and then it is one changed line rather than a removal
  and an addition at the same coordinates. Two features that share only a
  place are not matched: a `gene` and the `CDS` inside it cover the same
  bases and are not versions of one another. A feature that both moved and
  was renamed is matched by its bases instead: the same type on the same
  strand covering the same sequence, at least 20 bp of it, when that
  sequence is annotated once in each file. Two copies of a repeated element
  are left as a removal and additions rather than matched by guesswork.
- **A plasmid written from another origin is lined up first.** A circle has
  no first base, so the same plasmid saved by two programs can share no text
  at all. The dialog works out how the other file's copy has to be turned —
  rotated to another origin, read from the other strand, or both — says so
  above the differences, and compares against it turned. What is left is the
  real difference between the two molecules, not the difference between two
  ways of writing one.
- **The two checksums are at the top.** Each is the molecule's
  [SEGUID v2 name](03-viewing.md#the-checksum), which does not change with
  the origin or the strand, so two that match mean the same molecule for
  certain — anything the dialog then lists is annotation, not sequence.
- **Two unrelated sequences** come out as "too different to follow in
  detail" rather than as a thousand tiny differences. Where nothing long
  enough is shared, nothing can be lined up either, and the dialog says that
  rather than guessing.
- **Mark in the views** closes the dialog and marks the same differences in
  the sequence view and on the map, as the [Edits](04-editing.md#seeing-what-you-changed)
  menu marks your own changes: the other side, lined up as the dialog lined
  it up, becomes what this document's marks are measured from. The Edits
  menu then offers **Compared with _name_**, and **Next change** (`Alt+N`)
  and **Previous change** (`Alt+Shift+N`) walk from one difference to the
  next. It belongs to this document: another tab keeps its own marks, and
  a reload brings **Since opened** back.

## Sharing a link

**File ▸ Copy share link** (`Alt+L`) puts a link to the document on your
clipboard.
Paste it into an email or a chat, and whoever opens it gets the document —
sequence, topology, features and all — in their own copy of PlasmidPop.

Nothing is uploaded. The document travels inside the link itself, in the part
after the `#`, which browsers never send to a server: not to the site the app
is served from, not to us, not into anyone's logs. There is no account, no
expiry and no server holding your plasmid, because there is no server.

What follows from that is worth knowing.

- **Anyone with the link can open it.** The link _is_ the document, not a
  pointer to it. Treat it the way you would treat the file.
- **A link cannot be withdrawn or updated.** It is a snapshot of the document
  as it was when you copied it; edit the document and copy a new one.
- **Links are long.** An ordinary annotated plasmid makes one of four to
  twelve thousand characters. Mail and chat clients cope, but such a link
  wraps badly in plain text — paste it as a link where you can.
- **File ▸ Copy link to selection** makes a shorter one: a link to just the
  selected bases, as a linear document of their own with the features that
  fall inside them — what **Export selection as GenBank** writes. It may
  wrap the origin of a circular sequence, and a selection that reaches an
  end of a sticky fragment keeps that end's overhang. The notice says it is
  a link to the selection.
- **References and comments go when they are what makes it too long.** A
  link can carry at most 32,000 characters. When a document is over that
  with its REFERENCE and COMMENT blocks — the papers and notes a record
  from NCBI comes with — and under it without them, the link is made
  without them, and the notice says so and how long it would have been:
  _Too long with its references and comments (40,210 characters); share
  link copied without them_. The bases, features, topology, sticky ends,
  host and where it came from are always in the link.
- **A document too big for a link even so is refused**, with its length in
  the message; copy a link to a part of it, or download the GenBank file
  and send that instead. It is the
  annotation rather than the bases that fills a link, so a lightly annotated
  long sequence may share while a heavily annotated short one does not.
- **What the reader gets is their own copy.** It opens in a tab of its own
  with no file name, and it is marked as changed since its last download,
  because in their browser it has never been downloaded. There is no
  [working copy](#working-copies) to fork, since there is no file behind it,
  and nothing they do can reach back to you.
- **The link leaves the address bar** as soon as the document opens, so the
  sequence is not left in the browser's history. Reloading is safe: the
  document is in that browser's storage like any other.

## Exporting

From the **File** menu:

- **Export map as SVG**: the circular map as a standalone vector file for
  figures, with the cut sites of the enzymes ticked in the Enzymes tab —
  none of them while the toolbar's **Cut sites** toggle is off.
- **Export sequence view as SVG…**: the sequence rows as a vector file —
  ruler, bases, features and cut sites, and a read's trace, laid out as on
  screen. It follows the
  **Complement**, **Translations** and **Cut sites** toggles, the **Edits**
  marks, the enzymes ticked in the Enzymes tab and the **Format** menu's
  complement numbering and base colours; the text size is always the
  export's own. A small dialog asks three things:
  - **Whole sequence**, **Selection** (chosen for you when there is one,
    and highlighted in the file) or **From–to**: two base numbers, counted
    from 1 as the ruler counts, both included. On a circular sequence a
    "to" before "from" runs through the origin — 4301 to 60 of a 4,361 bp
    plasmid is its last 61 bases and then its first 60, drawn as two
    stretches one under the other, each numbered as in the document. So
    does a selection across the origin. The rows are whole rows, so the
    first and last may hold a few bases either side of the range.
  - **Bases per row**, 10 to 200: the Format menu's setting to start with,
    or 60 when Format is left at "Fit the window", so the file does not
    depend on the window width.
  - **Split into A4 pages**: one SVG file per A4 page (210 × 297 mm, 15 mm
    margins), as many whole rows to a page as fit, scaled down to the
    page's width when the rows are wider and never scaled up. Each page's
    foot names the document, the bases on it and the page number. The
    dialog says how many pages it will be before you export; the pages
    download one after another as `…_p01.svg`, `…_p02.svg` and so on, and
    your browser may ask once whether the site may download several
    files. At most 40 pages go at once (pBR322 is 9 at 60 bases a row):
    choose a shorter range or more bases per row for more.

  Sequences longer than 100,000 bases are refused: export a range instead.

- **Export sequence as FASTA**.
- **Export read as FASTQ**, for a document opened from an AB1 or FASTQ
  file: the bases with their qualities. Offered only while the bases are
  the read's; see [Downloading a read](15-reads.md#downloading-a-read).
- **Export selection as GenBank** or **as FASTA**: just the selected bases,
  with the features that fall inside them trimmed to the selection. The
  selection may wrap the origin of a circular sequence. A selection that
  reaches an end of a linear fragment keeps that end's sticky overhang.

The **Translate** tab has its own **Export FASTA** for six-frame
translations, see [Translation](09-translate.md).

## Local storage and recent files

Every open document is written to the browser's storage (IndexedDB) half a
second after each change, and again when you leave the page, so a closed tab
or a crash loses nothing. Its undo history is written with it, so undo and
redo still work after a reload. On the
start screen (the **Files** tab), **Recent files** lists these documents with
size, topology, feature count and when they were last changed. Opening the
same file twice does not create a second entry: a file identical to a stored
document whose tab is closed opens as that document, with its history, as if
you had reopened it from the list. (If you edit the new tab back to the stored
contents before it is first saved, it keeps an entry of its own instead, so
neither history is lost.)

- Click an entry to reopen it in a tab, or to go to its tab when it is
  already **open**. A working copy comes back as a working copy, under the
  name it was given, and the file it came from is still untouched.
- **Rename** changes the stored name (and the document name, as an undoable
  step of its history, whether it is open or not).
- **Remove** deletes it from the browser, with its undo history, and closes
  its tab. This does not touch files on disk.
- **File ▸ Show files** goes back to this list while keeping every tab
  open.

The view switcher and the Complement, Translations and Cut sites toggles are
remembered in the same browser storage, see
[Viewing and selecting](03-viewing.md).

Local storage is per browser profile and per device. A browser may clear a
site's storage when disk space runs low, so the first time a document is
written there a banner under the toolbar offers to ask the browser to keep
PlasmidPop's storage instead. Nothing about that changes where your data is:
it stays in this browser and nothing is uploaded.

- **Keep my documents** puts the question to the browser. In Firefox that
  is a dialog of the browser's own, worded something like "Allow this site
  to store data in persistent storage"; saying yes there means your
  documents are not among the first things thrown away. Chrome and Edge show
  no dialog and decide for themselves: they agree when the app is
  [installed](#offline-use), bookmarked or used often, and otherwise say no
  in silence. If the browser says no, the banner tells you so, and asks
  again quietly on later visits until it agrees, so installing the app later
  is enough.
- **Not now** leaves things as they are. The browser is not asked, now or on
  later visits, and storage stays clearable.

Either way your documents are still in the browser. Clearing site data
removes them, and a private window keeps nothing. So: this browser is where
your work lives while you are working, and it is not a backup. Download the
documents you want to keep as files.

## Usage statistics

The public build sends anonymous usage statistics to a self-hosted
[Matomo](https://matomo.org) instance: page views and coarse events such as
"opened a GenBank file", "ran a ligation" or "exported the map as SVG", and
which parts of the app a visit used at all — which sidebar tabs, views,
toggles and guide pages, which kinds of edit, which keyboard shortcuts —
each reported once per visit however often it is used. The version of the
app, and whether it runs on a phone or as an installed app, are sent once.
Never sent: sequences, feature names, file names, sequence lengths, where
in a sequence you worked, or anything else from your documents. The page address is reported without the part after the `#`, so
opening a [share link](#sharing-a-link) sends the tracker the app's address
and nothing of the document it carries. The tracker sets no cookies and the instance anonymises IP
addresses. If your browser sends a Do-Not-Track signal, nothing is sent at
all. Builds without a configured instance never send anything.

If Chrome asks whether the page may **access other devices on your local
network**, that is this tracker: the statistics server is on the lab's
network, and Chrome asks before a public page may reach a private address.
Refusing costs nothing but the statistics; the editor does not use the
network at all.

## Offline use

PlasmidPop is a progressive web app. After the first visit it works without a
network connection, and the browser offers to install it. When installed,
sequence files can be opened with it from the file manager.
