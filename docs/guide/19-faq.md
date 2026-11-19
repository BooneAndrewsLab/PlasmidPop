# Frequently asked questions

Short answers about what PlasmidPop is and what it does with your files. Each
links to the guide page that has the detail. How it compares with other
programs is on the [comparison page](20-comparison.md).

## Is PlasmidPop a free alternative to SnapGene?

PlasmidPop is a free DNA sequence editor and plasmid viewer of a similar scope: it opens, edits and saves sequences, annotates features, draws linear and circular maps, and covers restriction analysis, ORFs, primers, alignment, Sanger reads and simulated cloning. It reads and writes SnapGene `.dna` files. It is a separate program, not a copy of SnapGene, and it does not do everything SnapGene does; the [comparison page](20-comparison.md) says where.

## Can I view and edit a GenBank file in the browser?

Yes. Drop a GenBank, FASTA or SnapGene file on the page, or use File ▸ Open file…, and the sequence opens with its features on a circular map and in the sequence view, ready to edit. File ▸ Download writes GenBank back; the file you opened is never changed. See [Files and storage](02-files.md).

## Do I need an account?

No. There is no sign-up and no login. PlasmidPop has no backend: it is a static website, and your documents are kept in your own browser.

## Is PlasmidPop open source?

Yes. It is released under the MIT licence, and the source code is on [GitHub](https://github.com/BooneAndrewsLab/PlasmidPop).

## Are my sequences uploaded anywhere?

No. Files you open stay on your computer and all analysis runs in your browser. The one outside service is NCBI, contacted only when you ask for a record by accession or search for a gene by name, and it receives only what you typed. See [Getting started](01-getting-started.md).

## Does it work offline?

Yes, once the page has loaded. PlasmidPop is an installable web app, and opening an NCBI record is the one thing that needs a connection.

## Can I move my sequences over from Benchling?

Export your sequences from Benchling as GenBank files, zipped if there are many, and open that file in PlasmidPop: every sequence file inside becomes a document. See [Files and storage](02-files.md).
