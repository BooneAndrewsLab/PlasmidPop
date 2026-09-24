# Sequencing reads

PlasmidPop opens the files a sequencing run gives you: **AB1** files from a
Sanger (capillary) sequencer, and **FASTQ** files of nanopore or Illumina
reads. Both carry a quality for every base; an AB1 file also carries the
trace, the four coloured signals the bases were called from. Some nanopore
services deliver their consensus as an AB1 file too.

## Opening a read

Open or drop the file like any other (see [Files and storage](02-files.md)).
A read opens as an ordinary document: its bases, with the enzymes, ORFs,
primers and everything else working on them. What it adds is kept with it,
in this browser, like the rest of the document:

- The status bar says **Read, 92% Q20+**: the share of bases whose quality
  is 20 or more. Quality is on the Phred scale, where 20 means one error in
  a hundred bases, 30 one in a thousand.
- An AB1 read shows its **trace** in the sequence view, above the bases:
  the four dye signals (in the colours the bases are coloured in), each
  base's peak over its letter, and its quality as a faint bar behind. A
  clean read is a row of single, evenly spaced peaks; a mixed or noisy one
  shows overlapping peaks, which is where a base call is doubtful. The
  trace shows on a phone too. **Format ▸ Trace** draws it **Short**, **Tall**
  (twice the height, for peaks close together) or **Hidden**, for a read
  whose features and translations already make tall rows; the choice is
  remembered. It can be set while a read with a trace is in front.
- To check a read against a plasmid with its qualities, open the plasmid
  and drop the read on the Align tab's box: see
  [Aligning a read with its qualities](11-align.md#aligning-a-read-with-its-qualities).

A gzipped FASTQ (`.fastq.gz`), as nanopore runs usually come, opens without
unpacking it first. A FASTQ file holds many reads and a tab holds one: the
first read is opened, and the status bar's warnings say how many were left.
To align another one, drop the file on the [Align](11-align.md) tab's box
and pick the read there.

An AB1 file with no base calls (a fragment-analysis `.fsa` run) cannot be
opened; there is no sequence in it.

## Editing a read

A read's qualities and trace describe its bases as they came off the
sequencer, and the trace is drawn only while they do. An edit that changes the bases — typing, deleting, pasting,
moving the origin — sets them aside, and a notice says so; **Undo** brings
them back with the bases. Edits that leave the bases alone (features, the
name, the description) keep them. **Reverse complement** keeps them too,
turned over with the bases.

## Downloading a read

A download is GenBank, which has a place for the bases and features but not
for qualities or a trace; a notice says so when you download a read.
**Export sequence view as SVG** (see [Exporting](02-files.md#exporting))
draws the trace as it is shown. The
read stays whole in the browser. A [share link](02-files.md#sharing-a-link)
carries the document the same way, so it too arrives without the read. To
keep the original, keep the file you opened: PlasmidPop never writes to it.
