# Files and storage

## Formats

| Format     | Extensions                                 | Open | Download                |
| ---------- | ------------------------------------------ | ---- | ----------------------- |
| GenBank    | `.gb` `.gbk` `.genbank` `.gbff` `.ape`     | yes  | yes                     |
| GenPept    | `.gp` `.gpff`                              | yes  | yes, for a protein      |
| FASTA      | `.fa` `.fasta` `.fna` `.faa` `.seq` `.txt` | yes  | export                  |
| SnapGene   | `.dna`, `.rna`, and `.prot` for a protein  | yes  | yes, from the File menu |
| AB1        | `.ab1` `.abi`                              | yes  | as GenBank, or FASTQ    |
| FASTQ      | `.fastq` `.fq`, gzipped or not             | yes  | as GenBank, or FASTQ    |
| Bare bases | `.txt`, or pasted                          | yes  | as GenBank              |
| ZIP        | `.zip` of any of the above                 | yes  | no                      |

The format is sniffed from the content first, so a GenBank record in a
`.txt` file still opens as GenBank. If a file holds several records, the first
one is opened, and a warning in the status bar says how many others there
were. AB1 and FASTQ files are sequencing reads, with a quality for every
base: see [Sequencing reads](15-reads.md).

A WGS, TSA or TLS **master record** (a `CONTIG` line, no `ORIGIN`, a LOCUS
length counted in `rc`) holds no sequence of its own. It opens as an empty
document, with a warning, and saving it writes a valid header only; the
`CONTIG` line is not kept.

**GenBank** is the native format: sequence, topology, definition, accession,
references, and every feature with its full location (`complement(...)`,
`join(...)`, `order(...)`, partial ends, ranges that wrap the origin) and
qualifiers. An `order(...)` stays one, through edits and back out to a file;
the one location PlasmidPop cannot keep is one operator nested inside the
other, such as a `join(...)` inside an `order(...)`, which is read as the
outer one with a warning.
A download writes a standard GenBank flat file that other programs can read.
Anything PlasmidPop does not understand in a record is reported as a warning
in the status bar rather than silently dropped. So is a record that
contradicts itself: a CDS whose stored `/translation` is not the protein its
own bases give (see
[Checking a record against itself](09-translate.md#checking-a-record-against-itself)).
A qualifier whose quotes do not pair up — `/note="One missing ""quotation
mark" here"`, written by hand or by another program — is closed at the next
feature, or at the next qualifier when its line ends in a quote, with a
warning naming where; the features after it are read as usual.
A REFERENCE line that gives no number or no location in parentheses
(`REFERENCE   .`) is written back as a plain numbered reference, and loose
text on it goes to the reference's REMARK with a warning, so the file
written is one other programs (Biopython among them) read.

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
a FASTA export leaves it out. Gaps and digits are stripped with a warning.
A record whose letters are amino acids opens as a protein; see
[Proteins](16-proteins.md).

**SnapGene `.dna`** files are read for sequence and topology, features
(including segmented features and their colours), primers (as `primer_bind`
features), sticky ends, notes (description, organism, references) and the
file's own **history**: how SnapGene recorded the construct being made shows
in [Made from](13-history.md#made-from), with the oligos of a PCR and a
mutagenesis, and SnapGene's own word for anything PlasmidPop does not run
(`flip`, `newFileFromSelection`, `changeMethylation`). SnapGene stores no
checksums, so each molecule in that tree reads as _not in this browser_
unless you have the file yourself. Enzyme sets, alignments and appearance
settings are skipped. A `.dna` whose double-stranded flag is clear opens as
`ss-DNA`, otherwise as `DNA`. **File > Download SnapGene…**
writes a `.dna` back (see [Downloading a SnapGene file](#downloading-a-snapgene-file)).
Files from current SnapGene versions are what is tested; before version 1.2, primers were placed one base
to the left of where SnapGene has them, and a primer SnapGene stores twice
came in twice — reopen the `.dna` file to get them right. A feature or primer
whose position cannot be placed on the sequence (outside it, or backwards on a
linear one) is left out, and a warning in the status bar names it; the rest
of the file opens as usual.

**SnapGene `.prot`** files open as [protein documents](16-proteins.md): the
residues, every feature (domains, regions, sites, with their colours) on the
residues SnapGene shows them on, and the notes, as a `.dna` file's are. A
protein downloads as GenPept, or as a `.prot`.

**SnapGene `.rna`** files open as a nucleotide document with the molecule type
RNA: the bases, every feature (rRNA, tRNA, modified bases, variations) and the
notes, as a `.dna` file's are. SnapGene writes an RNA with T where the RNA has
U, and so does the editor underneath, as GenBank does: the stored sequence, every
download and the clipboard keep T, and the molecule type `RNA` (named on a
GenBank download's LOCUS line) says it is RNA. The
sequence view draws it with U (see [Viewing](03-viewing.md)). The file does not say whether the RNA is
single- or double-stranded, so nothing here does either, and it opens linear.

**Geneious** files are not supported. Export them as GenBank first.

## Opening several files, or a ZIP

**File ▸ Open** takes several files at once (select them in the picker), and
so does dropping them on the window. Each sequence opens in a tab of its own,
and one summary says how many documents opened, which files were skipped and
why, and any warnings the reader had about each record.

A **`.zip`** is opened the same way: a lab moving off Benchling, or another
tool, can export all its sequences as a ZIP of GenBank files and open that one
file. Every sequence file inside becomes a document. Files that are not
sequences (a spreadsheet of metadata, say), empty or unreadable files, and the
hidden files macOS and Windows add to archives are left out; the ones that
could have been a sequence are listed under **Skipped** with the reason. A
file with several records (a multi-FASTA) opens every record; an AB1 or FASTQ
opens its first record only, as it does on its own.

The folder a file sat in is kept: it is added to the document's keywords
(GenBank `KEYWORDS`) as `Projects/Plasmids`. Files with the same name from
different folders are different documents and stay apart; a file that is
identical to one already open, or to another in the batch, is not opened a
second time and is counted as already open.

Opening hundreds of files gives hundreds of tabs, and the archive is read in
the browser: nothing is uploaded. An archive that holds more than 5,000 files,
or that would expand to more than 512 MB, is refused rather than opened, and
a single file over 64 MB inside one is skipped. Detect features on open
(if you have turned it on) does not run for a batch.

## Opening a record from NCBI

**File ▸ Open from NCBI…** (or **From NCBI…** in the toolbar when nothing is
open) fetches a GenBank record by its accession number, so a published
plasmid, gene or protein opens without downloading it first.

1. Type the accession: `L09137` (pUC19), `NC_001422` (phiX174),
   `NM_000581.2`, or a protein's, `NP_000509` (haemoglobin β). The version
   after the dot is optional; without it you get the current one. A pasted
   NCBI address such as
   `https://www.ncbi.nlm.nih.gov/nuccore/L09137.2` works too.
2. Press **Open** (or `Enter`). The record opens in a tab of its own, as if
   you had downloaded it from NCBI and opened the file: every feature, the
   references and the comments. The tab takes the name on the record's LOCUS
   line, as it would from the file — `L09137` opens as `SYNPUC19CV` — and
   **Recent files** lists it as from `L09137.gb`. Click the name in the
   toolbar to rename it. Opening the same accession again goes to its tab.

- **Several at once**: separate them with spaces or commas (up to 20). Each
  opens in its own tab, the last one in front. One NCBI has no record for is
  named in the status bar; the others still open.
- **Cancel** stops a fetch under way; press it again, or `Escape`, to close
  the dialog.
- **Proteins** (`NP_000509`, `XP_…`, `WP_…`, or a GenBank protein id such
  as `AAA12345`) come from NCBI's protein database as GenPept and open as
  [protein documents](16-proteins.md), their tab listed in **Recent files**
  as from `NP_000509.gp`. Nucleotide and protein accessions can be mixed in
  one list: PlasmidPop then sends two requests, one to each database, and
  opens the nucleotide records first. If one of the two fails, the records
  the other brought still open, and the status bar says which accessions
  did not and why.
- Anything that does not look like an accession is refused before anything
  is sent, so a typo costs no request.
- **Records up to 10 Mb.** A longer one — a bacterial chromosome's
  scaffold, a whole contig set — is turned away as soon as its first line
  arrives, since PlasmidPop is not a genome browser.
- NCBI takes three requests a second from any one address without an API
  key. PlasmidPop sends all the accessions typed in one request (two when
  they mix nucleotide and protein, spaced apart) and tries
  once more after two seconds if NCBI is busy; if it still is, the dialog
  says so. It needs a connection: offline, it says that instead.

**What is sent.** This is the one feature that reaches a server other than
the one the app is loaded from, and only when you press **Open**. What goes
to NCBI (`eutils.ncbi.nlm.nih.gov`) is the accession numbers you typed and
the name `PlasmidPop`, which NCBI asks every program using its service to
send. No document, sequence or file name goes, no cookies, and not the
address of the page you are on; there is no API key and no e-mail address.
NCBI sees the request come from your network, as it would if you opened the
record on its website. The usage statistics count that a record was opened
from NCBI, never which (see [Usage statistics](#usage-statistics)).

## Several documents at once

Every document you open gets a tab in the strip under the toolbar, so a
vector and its insert can be open side by side. **Open file**, **New**,
**Open example**, **Open from NCBI…**, a dropped file (or a [ZIP of them](#opening-several-files-or-a-zip)), a pasted record, a ligation product and a
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
Downloads are GenBank, or SnapGene on request.

- **Download GenBank…** (`Ctrl+S`, and `Ctrl+Shift+S` out of habit) writes
  the document in front.
- **Download SnapGene…** writes it as a SnapGene file instead; see
  [below](#downloading-a-snapgene-file).
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

### Downloading a SnapGene file

**File > Download SnapGene…** writes a `.dna` file that SnapGene and SnapGene
Viewer are meant to open: the sequence and topology, the Dam and Dcm
methylation of the host, the overhangs of a linear fragment, every feature
with its segments, colour, direction, reading frame and qualifiers, primers
(a `primer_bind` that holds a primer's own sequence and notes goes into
SnapGene's primer list; one with other qualifiers stays a feature), and the
notes: name, description, accession, organism, comments, references and date.
A protein goes out as `.prot`, and a linear RNA as `.rna` (with T for U, as
SnapGene writes it). A circular RNA has no file of its own and goes out as a
`.dna`. The double-stranded flag is set for DNA and left off for `ss-DNA` and for
an RNA written as a `.dna`, so a single-stranded molecule re-opens as `ss-DNA`.
A feature with no colour of its own gets the colour the
map draws it in. `source` features stay in the file and in SnapGene's Features
list but are marked hidden, as SnapGene does, so they do not draw as rings
over the genes on its map; read back here they are the same features.

SnapGene's format has no place for everything a document can carry. Before
the file is written a dialog lists what it will leave out or change, so
nothing goes silently: GenBank-only header fields (keywords, version,
lineage, database links), a molecule type SnapGene cannot keep (`mRNA` and
`ss-RNA` come back as `RNA`, `ds-DNA` as `DNA`, a circular RNA as `ss-DNA`),
an empty note on a primer, base colours and sizes, the bases and qualities of
a sequencing read, partial-end marks (`<` and `>`), locations between two
bases, `order(...)` locations (written as joined), the record of what a
molecule was made from, and the enzymes behind a fragment's ends. If there is
nothing to list, and the document is not a working copy, the file is written
at once. A working copy still shows what it changed first, as for GenBank.

SnapGene's history tree is not written: the file records the molecule as it
is, not how it was made. The file's format is not published, so it was
written from SnapGene's own sample files and checked by reading the output
back with PlasmidPop and with Biopython; it has not been opened in SnapGene
itself. If SnapGene complains about a file, GenBank is the format to fall
back on, and an issue with the file attached helps.

## Verifying clones

**File ▸ Verify clones…** checks a plate of whole-plasmid sequencing
consensuses against the open constructs they should be, and says which match;
see [Verifying a plate of clones](11-align.md#verifying-a-plate-of-clones).

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
The page says "Opening the shared sequence…" for the moment it takes to
unpack the link, which a slower phone can take a second or so over.

Nothing is uploaded. The document travels inside the link itself, in the part
after the `#`, which browsers never send to a server: not to the site the app
is served from, not to us, not into anyone's logs. There is no account, no
expiry and no server holding your plasmid, because there is no server.

What follows from that is worth knowing.

- **Anyone with the link can open it.** The link _is_ the document, not a
  pointer to it. Treat it the way you would treat the file.
- **A link cannot be withdrawn or updated.** It is a snapshot of the document
  as it was when you copied it; edit the document and copy a new one.
- **Links are long, and chat apps do not all carry them.** An ordinary
  annotated plasmid makes one of four to twelve thousand characters. Slack
  refuses to send a link that long, and Teams sends it but covers the screen
  with its tooltip when the pointer passes over it, so it is hard to click.
  Past 2,000 characters the notice says so. For those apps, download the
  file and attach it, or share a link to just the part that is needed (below).
  In plain-text mail such a link wraps badly — paste it as a link where you
  can.
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

- **Export figure…**: the circular map or the sequence rows as a picture
  for figures, slides and posters. One dialog, with a preview of what will
  be written and its size under it, asks three things:
  - **What** — **Map** or **Sequence view**; a protein, which has no map,
    gets the sequence view alone. For the map, what is on it: the
    **restriction enzymes** (the cut sites of the enzymes ticked in the
    Enzymes tab — none while the toolbar's **Cut sites** toggle is off), the
    **GC ring**, the **name and length in the middle**, and which **feature
    types** are drawn. These options belong to the figure only; the map on
    screen is not changed. For the sequence view, which bases: **Whole
    sequence**, **Selection** (chosen for you when there is one, and
    highlighted in the file) or **From–to**, two base numbers counted from
    1 as the ruler counts, both included. On a circular sequence a "to"
    before "from" runs through the origin — 4301 to 60 of a 4,361 bp
    plasmid is its last 61 bases and then its first 60, drawn as two
    stretches one under the other, each numbered as in the document. So
    does a selection across the origin. The rows are whole rows, so the
    first and last may hold a few bases either side of the range. The rows
    — ruler, bases, features and cut sites, and a read's trace — are laid
    out as on screen: the figure follows the **Complement**,
    **Translations** and **Cut sites** toggles, the **Edits** marks, the
    enzymes ticked in the Enzymes tab and the **Format** menu's complement
    numbering and base colours; the text size is always the export's own.
    The preview shows the first four rows.
  - **How big** — for the map, the **text size**; for the sequence view,
    **Bases per row**, 10 to 200 (the Format menu's setting to start with,
    or 60 when Format is left at "Fit", so the file does not depend on the
    window width). Then the **file type**: **SVG** (the default), a vector
    file that is sharp at any size; **PNG**, a picture at a **scale** of
    1×, 2× or 4× the SVG's pixel size; or **PDF**, a document at the
    figure's own size (A4 or US Letter when split into pages) that is either **Vector**
    — text and lines as in the SVG, set in the PDF's standard Courier and
    Helvetica so the text can be searched and selected — or **Raster**,
    each page a picture at the chosen scale, as the PNG would be. The size
    in pixels is shown under the preview. The **background** is white or
    transparent for every type.
  - **Pages** — **Split into pages**, for the sequence view, on the paper
    chosen under **Paper size**: **A4** (210 × 297 mm) or **US Letter**
    (215.9 × 279.4 mm, 8.5 × 11 in), with 15 mm margins. The paper size
    starts as US Letter when the browser's language is from the United
    States, Canada, Mexico or another Letter country and as A4 otherwise;
    nothing is remembered, and it is greyed out until pages are asked for.
    Pages hold as many whole rows to a page as fit,
    scaled down to the page's width when the rows are wider and never
    scaled up. Each page's foot names the document, the bases on it and the
    page number. The dialog says how many pages it will be before you
    export, and they leave as one download: a PDF holds them as its pages;
    SVG and PNG pages come as one ZIP file holding `…_p01.svg`,
    `…_p02.svg` and so on (`.png` for a PNG). Even the longest sequence the
    export takes (100,000 bases at 10 to a row, about 830 A4 pages) goes in
    one export as SVG, PNG or a vector PDF. Pictures are limited by their
    pixels, summed over the pages: a ZIP of PNGs holds up to 3,000
    megapixels (all 830 pages at 2×), and so does a raster PDF. A raster
    PDF is slow because every page is a picture the PDF writer must
    re-encode, about a fifth of a second per megapixel — the 830 pages at 2×
    take some ten minutes, 139 A4 pages at 2× about two; the pages hint says
    so ("about 2 minutes to make") whenever it is a minute or more. The
    vector PDF of the same pages takes seconds.

  While the file is made, the dialog says so beside the buttons, with a
  spinner and the page it is on: "Getting your file ready: drawing page 12
  of 139…", then "writing the file…" (a raster PDF counts its pages a second
  time as they are written). The pages are drawn between the browser's
  turns and the file itself — the ZIP, or the raster PDF — is put together
  in the background, so the rest of PlasmidPop keeps answering while a long
  export runs. **Cancel** (or `Escape`) stops an export under way: nothing
  is downloaded and the dialog stays as it was, so you can change a setting
  and export again; press it again to close.

  The dialog checks as you change things. A range outside the sequence, a
  row width outside 10–200, too many pages, too many pixels in the PNG or
  raster PDF pages, or a PNG or raster PDF larger than a browser can draw
  (16,384 pixels on a side) is said in red beside
  the **Export** button, which stays off until it is put right; the message
  says what would fit — a smaller scale, Vector, more bases per row or fewer pages.
  Sequences longer than 100,000 bases are refused: export a range instead.
  The PDF writer is fetched the first time a PDF is exported and kept for
  offline use after that; if you are offline that first time, the dialog
  says so.

- **Export sequence as FASTA**.
- **Export read as FASTQ**, for a document opened from an AB1 or FASTQ
  file: the bases with their qualities. Offered only while the bases are
  the read's; see [Downloading a read](15-reads.md#downloading-a-read).
- **Export selection as GenBank** or **as FASTA**: just the selected bases,
  with the features that fall inside them trimmed to the selection. The
  selection may wrap the origin of a circular sequence; a site feature (a
  point between two bases) at the origin is kept when the selection runs
  across it, and left out at the selection's own ends. A selection that
  reaches an end of a linear fragment keeps that end's sticky overhang.

The **Translate** tab has its own **Export FASTA** for six-frame
translations, see [Translation](09-translate.md).

## Local storage and recent files

Every open document is written to the browser's storage (IndexedDB) half a
second after each change (a little later while you are scrolling or typing),
when you close its tab, and again when you leave the page, so a closed tab
or a crash loses nothing: reopen a closed tab from **Recent files** and its
last edit is there. Its undo history is written with it, so undo and
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
[Viewing and selecting](03-viewing.md). So is your primer list,
[My primers](10-primers.md#my-primers), which leaves the browser only as a
CSV or FASTA file you download.

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
your work lives while you are working, and on its own it is not a backup.
Download the documents you want to keep as files, or back everything up at
once, below.

### Backing up and restoring everything

The browser profile can go away: site data cleared, a new computer, a
reinstalled system, or Safari dropping the storage of a site you have not
visited for seven days. **File ▸ Back up all documents…** (also a button on
the Files tab, under **Storage and backup**) writes one ZIP file,
`plasmidpop-backup-YYYY-MM-DD.zip`, with every stored document and its undo
history, and the rest of what this browser keeps for you: your primers, your
parts, your own enzymes and imported tables, and the cloning shelf. It is an
ordinary download, so keep it somewhere other than this browser. The ZIP is
plain JSON inside; nothing is uploaded.

**File ▸ Restore from backup…** reads such a file back, here or on another
computer. It merges and never deletes:

- A document that is not here is added, with its undo history.
- A document that is here is replaced only by a _newer_ copy from the backup.
  If the copy here is the same or newer it is kept, and the report says how
  many. So restoring an old backup never takes back later edits.
- A document that is open in a tab is left alone; close its tab and restore
  again to bring the backup's copy.
- Primers, parts and the other collections are added where missing; a row
  that is already here is kept, except the shelf and imported tables, where
  the newer one wins.
- A backup made by a newer version of PlasmidPop is refused with a message;
  a damaged entry is skipped and listed, and the rest is restored.

A backup is not opened by **Open file…**: that opens a ZIP of sequence files
as new documents ([Opening several files, or a ZIP](#opening-several-files-or-a-zip)).

**Storage and backup**, on the Files tab, says how many documents are stored,
whether the browser has agreed to keep them, and when you last backed up. It
adds a warning when there are changes older than seven days that no backup
holds. In Safari, and any browser on an iPhone or iPad, that is not installed
to the home screen (or the Dock), it also says that the browser may drop the
documents after seven days without a visit, which a backup or installing the
app protects against. On an iPhone or iPad the installed app does not share
storage with the Safari tab: it starts empty. Before you add PlasmidPop to the
home screen, use **Back up all documents…** in Safari, then open the installed
app and use **Restore from backup…**. There the "agreed to keep them" line is left out, because
Safari's seven-day limit applies even when the browser has granted persistent
storage. The date of the last backup is remembered in this
browser only, so a restore on a new computer starts with "never backed up"
until you back up there.

## Usage statistics

The public build sends anonymous usage statistics to a self-hosted
[Matomo](https://matomo.org) instance: page views and coarse events such as
"opened a GenBank file", "ran a ligation" or "exported the map as SVG", and
which parts of the app a visit used at all — which sidebar tabs, views,
toggles and guide pages, which kinds of edit, which keyboard shortcuts —
each reported once per visit however often it is used. The version of the
app, and whether it runs on a phone or as an installed app, are sent once.
Never sent: sequences, feature names, file names, names you give your own
enzymes, hosts or standards (they are reported as "custom"), sequence lengths, where
in a sequence you worked, or anything else from your documents. The page address is reported without the part after the `#`, so
opening a [share link](#sharing-a-link) sends the tracker the app's address
and nothing of the document it carries. A record opened from NCBI is
counted as one (or, if it failed, why: not found, offline and so on), never
by its accession. The tracker sets no cookies and the instance anonymises IP
addresses. Nothing is sent at all if your browser sends a Do-Not-Track or
Global Privacy Control signal, or if you switch statistics off: the **Send
anonymous usage statistics** checkbox at the foot of this guide (Help) turns
them off at once and back on without a reload, and your choice is remembered
in this browser. When the browser's signal is on, the checkbox shows off and
cannot be turned on. Builds without a configured instance never send anything
and show no checkbox.

If Chrome asks whether the page may **access other devices on your local
network**, that is this tracker: the statistics server is on the lab's
network, and Chrome asks before a public page may reach a private address.
Refusing costs nothing but the statistics; the editor itself uses the
network only for [Open from NCBI…](#opening-a-record-from-ncbi), when you
ask it to.

## Offline use

PlasmidPop is a progressive web app. After the first visit it works without a
network connection, and the browser offers to install it. When installed,
sequence files can be opened with it from the file manager.

### Opening an attachment from another app

On **Android**, with PlasmidPop installed from Chrome (the menu's **Install
app** or **Add to Home screen**), PlasmidPop appears in the **Share** sheet of
other apps. To open a GenBank file someone mailed you, share the attachment
from the mail app (or a file from the Files app, or a chat) and pick
PlasmidPop: it opens with the file in a tab of its own, as if you had picked
it with **File ▸ Open**. Every format in the table above works, and several
files shared at once open in a tab each. Mail apps often label a `.gb` file as
plain text or as unknown data, so PlasmidPop is offered for those too and
decides from the file itself; a file it cannot read is reported in the status
bar as when opening one.

The file goes from the other app to PlasmidPop on the phone and nowhere else:
it is handed over inside the browser, kept only until it has been opened, and
never uploaded. **iPhone and iPad** do not support this (Safari has no share
target for web apps); save the attachment to Files and open it with **File ▸
Open** instead. Desktop browsers do not offer it either.
