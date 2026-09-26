# Getting started

PlasmidPop is a DNA sequence editor and plasmid viewer that runs entirely in
your browser. There is no account and nothing is uploaded: files you open stay
on your computer, and analysis runs on your own machine. The one request the
editor makes to anyone else is **Open from NCBI…**, when you ask it to, and
that sends NCBI the accession numbers you typed and nothing else.

## Open something

Any of these gets you a sequence on screen:

- **Drop a file** anywhere on the page. GenBank, GenPept, FASTA, SnapGene
  `.dna`, AB1 and FASTQ files are recognised by their content, so the
  extension does not matter much.
  (A file dropped on the [Align](11-align.md) box or the enzyme import is
  read there instead of opening a tab.)
- **Open file** in the toolbar (or **File ▸ Open file…** once a document is
  open) shows the usual file picker.
- **Paste** (`Ctrl+V`) a GenBank record, a FASTA record, bare bases or bare
  protein residues while nothing is open. A record opens as such; bare
  letters become a new untitled sequence, DNA or protein as they read.
- **New** asks for the new sequence's **Name** and whether it is **Linear**,
  **Circular** or a **Protein**, then opens it empty with the cursor placed,
  so you can type straight away. `Enter` takes "Untitled" and the topology you chose
  last; `Escape` opens nothing.
- **From NCBI…** in the toolbar (or **File ▸ Open from NCBI…**) fetches a
  GenBank record by its accession number, such as `L09137`, or a protein's
  GenPept record, such as `NP_000509`; see
  [Opening a record from NCBI](02-files.md#opening-a-record-from-ncbi).
- **Open example** loads pBR322 (4,361 bp, circular) to look around.

Each document opens in its own tab under the toolbar, so several can be open
at once; the **Files** tab is the start screen. Files opened earlier appear
there under **Recent files**, where they can be reopened, renamed or removed.
See [Files and storage](02-files.md).

## What is on the screen

- **Toolbar** (top): the logo, the document name (click it to rename), its
  length and topology, then the **File** menu, **Undo / Redo** with the
  history list, the view switcher (**Sequence**, **Map**, **Both**), the
  **Complement**, **Translations** and **Cut sites** toggles, the
  **Format** and **Edits** menus, and the **?** button that opens this
  guide.
- **Document tabs** (under the toolbar): **Files**, the
  [**Bench**](12-cloning.md#the-bench), then one tab per open document, and
  **+** for a new one. Tabs can be dragged into another order.
- **Edit bar** (under the tabs): Add feature, Delete selection, Reverse
  complement, Set origin here, Make circular / linear, Find.
- **Views**: the circular map on the left and the linear sequence view on the
  right. Both show the same selection and the same features.
- **Sidebar** (right): tabs for Features, ORFs, Translate, Primers, Enzymes,
  Cloning, Align and History (and Protein in front of a protein), in a narrow rail down the right-hand edge,
  each an icon above its label turned on its side. On a narrow window the
  rail becomes a row of tabs above the panel. From the keyboard the rail is
  one Tab stop: the arrow keys move along it and open the tab they reach,
  Home and End go to either end, and `Alt+[` / `Alt+]` do the same from
  anywhere.
- **Status bar** (bottom): what is selected, warnings raised while opening
  the file, and the file name.

A dot after the document name (and on its tab) means the document has
changed since you last downloaded it. Nothing is lost if you leave the page
with the dot showing: every open document is written to this browser as you
work and comes back when you return.

On a phone the screen is arranged differently: one pane at a time and no
editing controls. See [On a phone](03-viewing.md#on-a-phone).

## A two-minute tour

1. Click **Open example**.
2. In the **Features** tab click _tet_: the map and the sequence view jump to
   it and the selection is reported in the status bar.
3. Open the **Enzymes** tab. Enzymes that cut exactly once are ticked, and
   their cut sites are drawn on both views. Tick _EcoRI_ if it is not already.
4. Press `Ctrl+F`, type `GAATTC` and press `Enter` to step through the
   matches on either strand.
5. Click anywhere in the sequence view, type a few bases, and watch the
   features move with them. `Ctrl+Z` undoes it, and the **History** tab
   lists what you did.
6. Press `Ctrl+S` to download the result as a GenBank file.

## Where your data lives

Open documents are written to the browser's local storage half a second
after every change, and the tabs you had open come back when you return.
That storage is per browser and per device. PlasmidPop never writes to a file
on your disk: to get one, download it (`Ctrl+S`).
Your sequences never leave your device (Open from NCBI sends NCBI an
accession, not a sequence); the public build only counts
anonymous feature usage (see the usage statistics section of the files page).

PlasmidPop can be installed as an app from the browser's address bar. Once
installed it works offline, and `.gb`, `.fa` and `.dna` files can be opened
with it from the file manager.

## Citing PlasmidPop

If PlasmidPop helped with work you publish, please cite it as:

Usaj, M. PlasmidPop. Zenodo.
[doi:10.5281/zenodo.22907552](https://doi.org/10.5281/zenodo.22907552)

That DOI covers every version. The Zenodo record also lists a DOI for each
release, for a methods section that names the exact version used. The
version you are running is at the top of this guide, beside its title.
