# Files and storage

## Formats

| Format     | Extensions                             | Open | Save       |
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
Saving writes a standard GenBank flat file that other programs can read.
Anything PlasmidPop does not understand in a record is reported as a warning
in the status bar rather than silently dropped.

**ApE** files are GenBank with extra colour qualifiers; those colours are
used for the features.

**FASTA** gives a bare sequence. A header ending in `[topology=circular]`
makes the sequence circular. Gaps and digits are stripped with a warning;
protein FASTA is rejected.

**SnapGene `.dna`** files are read for sequence and topology, features
(including segmented features and their colours), primers (as `primer_bind`
features) and notes (description, organism, references). Enzyme sets,
history, alignments and appearance settings are skipped. PlasmidPop cannot
write `.dna`; save as GenBank instead.

**Geneious** files are not supported. Export them as GenBank first.

## Saving

Saving always produces GenBank.

- **Save** (`Ctrl+S`). In Chromium browsers that let a page write to files,
  Save writes straight back to the GenBank file you opened. The first time it
  would overwrite a file you merely opened, it asks for confirmation. When the
  document came from FASTA, SnapGene, a paste or the example, Save behaves
  like Save as.
- **Save as…** (`Ctrl+Shift+S`) asks where to write a new `.gb` file. In
  browsers without file-system access it downloads the file instead.

The dot after the document name disappears once the document matches the
saved file.

## Exporting

From the **File** menu:

- **Export map as SVG**: the circular map as a standalone vector file for
  figures, with the cut sites of the enzymes ticked in the Enzymes tab —
  none of them while the toolbar's **Cut sites** toggle is off.
- **Export sequence view as SVG**: the sequence rows as a vector file —
  ruler, bases, features and cut sites, laid out as on screen but always 60
  bases to a row so the file does not depend on the window width. It follows
  the **Complement**, **Translations** and **Cut sites** toggles and the
  enzymes ticked in the Enzymes tab. Sequences longer than 100,000 bases are refused: export a
  range instead.
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

Every open document is saved to the browser's storage (IndexedDB) half a
second after each change, so a closed tab or a crash loses nothing. On the
start screen, **Recent files** lists these documents with size, topology,
feature count and when they were last changed. Opening the same file twice
does not create a second entry.

- Click an entry to reopen it. If the browser remembers the file it came
  from, Save writes back to that file.
- **Rename** changes the stored name (and the document name, when it is
  open).
- **Remove** deletes it from the browser. This does not touch files on disk.
- **File ▸ Show files** goes back to this list while keeping the current
  document stored.

Local storage is per browser profile and per device, and the browser may
clear it when space runs low. Treat it as a scratchpad and keep your files
with Save.

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
