# PlasmidPop compared with SnapGene, ApE, Benchling and Serial Cloner

People looking for a plasmid editor often ask how PlasmidPop differs from the
programs they already know. This page states what is true of PlasmidPop and
only well-known, general facts about the others, and says where they do more.
It is not a feature-by-feature benchmark: check each program's own
documentation for what it offers today.

## PlasmidPop in short

- Runs in a web browser; nothing to install. Installable as a web app, and
  works offline once loaded.
- Free, open source (MIT licence), no account.
- No backend: documents are kept in your browser and leave it only as a
  download or as a share link that carries the document in the link itself.
- Reads and writes GenBank and SnapGene `.dna`; reads FASTA, GenPept, AB1 and
  FASTQ. See [Files and storage](02-files.md).
- Maps, features, restriction analysis, ORFs, primers, alignment, Sanger
  reads, CRISPR guides and simulated cloning: see the [guide](01-getting-started.md).

## What is widely known about the others

- **SnapGene** is commercial software that you install on a computer.
- **ApE** (A plasmid Editor) is a free desktop program; PlasmidPop reads and
  writes the GenBank files it uses, including its `.ape` extension.
- **Benchling** is an online platform; using it means having an account.
- **Serial Cloner** is a desktop program for molecular biology work on a
  computer.

PlasmidPop makes no claim beyond this about what they cost or which features
or file formats they have today: look that up in their own documentation.

## Where the others do more

- **SnapGene** is a mature, commercial product with a long history, vendor
  support and wide use in labs. PlasmidPop is newer, developed by one lab, and
  has no vendor support. If your lab already relies on SnapGene, PlasmidPop can
  open and write its `.dna` files, but it does not claim to do everything
  SnapGene does.
- **ApE** is a long-established desktop editor. PlasmidPop
  does not claim to cover everything it does, and it is not an installed
  program.
- **Benchling** is an online platform with accounts, shared projects and team
  workflows. PlasmidPop has no accounts, sync, team libraries or real-time
  collaboration, and will not: it has no server. Sharing is a link or a file.
- **Serial Cloner** is a long-established desktop program. PlasmidPop does
  not claim to cover everything it does, and it is not an installed program.

## What PlasmidPop does not do

No accounts, sync or team libraries; no server-side computation; sequences
much above 10 Mb are out of scope; it never writes to your disk except as a
download. Its [validation page](18-validation.md) lists what is cross-checked
against independent tools and the known limits.

## Moving over

A ZIP of GenBank files opens as one document per sequence, which is how a lab
leaving another tool can bring its library across; see
[Files and storage](02-files.md).
