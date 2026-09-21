# Getting started

PlasmidPop is a DNA sequence editor and plasmid viewer that runs entirely in
your browser. There is no account and nothing is uploaded: files you open stay
on your computer, and analysis runs on your own machine.

## Open something

Any of these gets you a sequence on screen:

- **Drop a file** anywhere on the page. GenBank, FASTA and SnapGene `.dna`
  files are recognised by their content, so the extension does not matter much.
- **Open file** in the toolbar (or **File ▸ Open file…** once a document is
  open) shows the usual file picker.
- **Paste** (`Ctrl+V`) a GenBank record, a FASTA record or bare bases while
  nothing is open. A record opens as such; bare bases become a new untitled
  sequence.
- **New** starts an empty linear sequence called "Untitled" with the cursor
  placed, so you can type straight away.
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
- **Document tabs** (under the toolbar): **Files**, then one tab per open
  document, and **+** for a new one.
- **Edit bar** (under the tabs): Add feature, Delete selection, Reverse
  complement, Set origin here, Make circular / linear, Find.
- **Views**: the circular map on the left and the linear sequence view on the
  right. Both show the same selection and the same features.
- **Sidebar** (right): tabs for Features, Enzymes, ORFs, Translate, Primers,
  Align, Cloning and History, in a narrow rail down the right-hand edge with
  the labels turned on their side. On a narrow window the rail becomes a row
  of tabs above the panel.
- **Status bar** (bottom): what is selected, warnings raised while opening
  the file, and the file name.

A dot after the document name (and on its tab) means the document has
changed since you last downloaded it. Nothing is lost if you leave the page
with the dot showing: every open document is written to this browser as you
work and comes back when you return.

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
Your sequences never leave your device; the public build only counts
anonymous feature usage (see the usage statistics section of the files page).

PlasmidPop can be installed as an app from the browser's address bar. Once
installed it works offline, and `.gb`, `.fa` and `.dna` files can be opened
with it from the file manager.
