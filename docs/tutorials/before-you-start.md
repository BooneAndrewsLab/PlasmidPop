# Before you start

- **You will end with:** the sample files open in tabs, the enzyme ticks cleared, and a picture of what the Bench is.
- **Time:** about 5 minutes.
- **Files:** [the synthetic sample files](sample-files.md).
- **Before this:** nothing.

What every tutorial assumes. Nothing to install: PlasmidPop runs in the browser,
and the files stay on your device. If digesting a plasmid or amplifying a gene
with primers is new to you, do [Digest and PCR basics](digest-pcr.md) next: it
is the basics the other tutorials build on.

## Opening the sample files

The tutorials come with [synthetic sample files](sample-files.md): invented
sequences, no catalogue or database records. Download the ones a tutorial names.
Either drag them onto the PlasmidPop window, or use **File ▸ Open** and select
several at once. Each opens in a tab of its own; **File ▸ Show files** (the
**Files** tab) lists them. Open only what an exercise names, in the order it
names, and close the rest.

> [!WARNING]
> The Golden Gate panel puts every open tab in the tube, so close the tabs an exercise does not name.

## What the Bench is

The Bench is a tab beside **Files** in the tab strip, where cloning is
simulated. It has three columns: the **shelf** of parts on the left, the
**reaction** in the middle (**Ligation**, **Golden Gate** and the others,
picked at the top), and **what it makes** on the right once the parts go
together, with a check digest. A product opens as a document of its own. The
[Bench](../guide/12-cloning.md#the-bench) page of the user guide is the
reference.

## Enzyme ticks

**Hide all** in the Enzymes tab clears the ticks. A file you open yourself opens
with every enzyme that cuts once ticked, so clear them and tick only what the
exercise says; the **Filter** box finds an enzyme by name. A product the app
makes (Assemble, Simulate) opens with only the enzymes the reaction used
ticked, and the exercises say which.

## Scratch documents

A tutorial changes nothing on disk: the app never writes to your files. Products
and edits live in tabs until you close them or download them, so try things
freely, and close a tab you do not want to keep.

## A gene from NCBI

Each exercise is done once with a synthetic ORF and, where it makes sense, once
with a real gene, human insulin (`INS`), that you fetch from NCBI inside the app.
Only the accession you type goes to NCBI. A gene off NCBI has no cloning sites
at its ends, so those exercises start by designing primers that add them.

## If a number does not match

The numbers in the tutorials are for the bundled enzyme set (the default) and for
the documents with their default host methylation (dam+ dcm+). None of the sites
in these files lies in a dam or dcm context, so the numbers are the same with
either; the ranking of the check digest's enzymes depends on the enzyme set in
use, the band sizes of the named enzymes do not.

Back to the [tutorials index](README.md).
