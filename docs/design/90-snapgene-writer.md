# 90. Write SnapGene files (#204)

**Asked:** PlasmidPop read `.dna`, `.rna` and `.prot` but could only hand back
GenBank, which drops what a SnapGene lab relies on (primer list, colours,
directionality, overhangs, methylation flags).

**Not verified: opening in real SnapGene.** Nobody has opened a file written
here in SnapGene or SnapGene Viewer, by hand or otherwise; the issue's
acceptance asks for that and it is still open. What was checked is that our
own reader and Biopython's read back what was written (below). The format is
reverse-engineered, so a file can pass both and still be refused or drawn
wrongly by SnapGene. Until someone has opened a handful (a circular plasmid
with a reverse CDS and primers, a linear fragment with overhangs, a `.prot`),
the guide says so too.

**What was built.**

- `io/snapgene/writeSnapGene.ts`: `writeSnapGene(doc, {colorOf, uuid})`
  returns the bytes, the extension (`dna`, `rna` or `prot`) and `losses`, one
  sentence per thing the file cannot hold. Packets in SnapGene 8.2's order and
  shape (cookie 1/15/19, 0x00 sequence, 0x08 properties, 0x0A features, 0x05
  primers, 0x06 notes), copied from its bundled files; the packets SnapGene
  derives itself (enzyme sets, display settings, history) are left out.
- **File > Download SnapGene...** (`persistence.downloadSnapGene`). The review
  dialog built for a working copy now also carries the loss list
  (`SaveReview.snapGene`); a document with nothing to list and no changes to
  review is written at once. An empty document is refused (SnapGene has no
  file for it, and Biopython cannot read one).
- Flags: 0x01 circular, 0x02 double-stranded, 0x04 Dam, 0x08 Dcm from the
  document's methylation; the default dam+dcm host gives 0x0E, what SnapGene
  writes.
- **Overhangs** are the inverse of the reader's `stickyEnds`: SnapGene's
  sequence spans both strands, so a left 3' overhang is put back in front of
  the sequence and a right 5' one behind, and the stickiness is written as
  +n (5') or -n (3'). Feature positions shift by what went in front. A
  feature the reader had cut short at those bases (partial mark at the edge)
  is made whole again, and a CDS's `codon_start` moves back by the same
  amount, so a fixture with a TA vector reads back identically.
- **Primers.** A single-segment `primer_bind` whose qualifiers are only the
  notes the reader makes (`sequence: ...` and at most one description) goes
  into the primer list, sites of one name and sequence merged into one primer.
  Anything else, a labelled `primer_bind` from GenBank for one, stays a
  feature, so nothing about it is lost. The sequence is the note's, else the
  bases (reverse-complemented on the bottom strand).
- **Features.** Directionality 1/2 (omitted for a forward `misc_feature` and
  `source`, as SnapGene does); joins get explicit `gap` segments between the
  pieces; a CDS with `codon_start` gets `readingFrame` (negated on the
  reverse strand) and `translated="1"`. The colour is the segment's: a
  `color: #rrggbb` note (what the reader makes of it) becomes the attribute and
  is not written as a note; without one the app's own colour for the type is
  used (`colorOf`), and with no callback `noColor`, which 73 of SnapGene's
  bundled segments carry. `codon_start`/`transl_table` go as `int`, the rest as
  `text`, XML-escaped.
- **Notes**: description, accession, organism, comments, references, date
  (`LastModified`), division (`SequenceClass`, `Type` Synthetic for SYN) and
  the name (`CustomMapLabel`).
- The reader's one change: a `codon_start` qualifier that already agrees with
  `readingFrame` stays where the file has it, instead of moving to the end,
  so a written file reads with its qualifiers in order.

**Listed as not representable (the dialog):** GenBank keywords, version,
taxonomy, DBLINK and other header lines; a source name that differs from the
organism; reference remarks, consortia and ranges; several comments (joined
into one); base colours/highlights/sizes; a sequencing read's qualities and
trace; partial-end marks; locations between two bases (a feature with only
those is left out, named); `order(...)` (written joined); the made-from
record; the enzymes behind ends; U to T in an RNA.

**Checked.**

- `writeSnapGene.test.ts`: read -> write -> read equality on every committed
  fixture, and on every local file under a SnapGene installation and
  `fixtures/local` (203 `.dna`, the `.prot` and `.rna` samples; compared as
  documents, with the colour note and feature order set aside), plus the
  packet layout, overhangs of each kind, primers, colours, text with quotes,
  newlines and non-ASCII, and each loss message.
- Biopython 1.85 (`scripts/oracle/run.sh snapgene-writer`,
  `npm run oracle:snapgene-writer`): reads 481 files our writer produced, the
  GenBank oracle records, the committed fixtures, 203 real SnapGene files
  parsed and written again, and 300 random editing sessions, and sees the same
  stored sequence, topology and, for each feature and primer, type, strand,
  label and bases. Findings that are Biopython's, not ours, and that the
  check works around: it reads a whole circle that starts after base 1
  (`14-13`) as an empty location and refuses the file (we keep writing that
  form, because our reader takes it as a whole circle and nothing says
  SnapGene does otherwise; such documents are left out of the check);
  it joins the two halves of a reverse-strand feature that crosses the origin
  in forward order, so its extract is the wrong way round (compared as bases);
  and it has no reader for `.rna` or `.prot`.

**Known limits.**

- A feature whose colour was `noColor` gets the app's colour for its type on
  the way out, so it is no longer uncoloured in SnapGene.
- Packets are written without SnapGene's `recentID` bookkeeping beyond a
  running count, and without melting temperatures for primers; SnapGene
  recomputes those on opening as far as is known.

**Literal markup (#237).** `stripHtml` used to decode entities a second time
(`parseXml` has already decoded once) and strip anything tag-shaped, so a
note saying `<b>` or `&amp;` did not survive a read. It now unwraps only a
value that starts with `<html>` (SnapGene's rich text), decoding the entities
inside that wrapper once; any other value is taken as it is. The writer
never produces the wrapper, so its output reads back unchanged.
