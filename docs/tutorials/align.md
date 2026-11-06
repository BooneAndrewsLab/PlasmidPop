# Align: a read, four clones, proteins and a copied range

- **You will end with:** a read checked against a plasmid (99% identical, on the reverse strand, one base differing), four clones lined up with the five columns where they differ found, four proteins aligned, and a 12 column range copied out of the alignment as FASTA.
- **Time:** about 25 minutes.
- **Files:** [AL-Plasmid.gb](files/AL-Plasmid.gb), [AL-Read.fasta](files/AL-Read.fasta), [AL-Clones.fasta](files/AL-Clones.fasta), [AL-Protein.fasta](files/AL-Protein.fasta), [AL-Proteins.fasta](files/AL-Proteins.fasta) (all synthetic, plain downloads).
- **Before this:** nothing; [Before you start](before-you-start.md) helps if the sample files are new to you.

The **Align** tab of the sidebar aligns sequences you put in its box to the document in front of you. The box takes a file with **Choose file…** (or a drop), and a file put there does not open a tab. Each exercise starts with the files it names, and the reference sections of the [Align page](../guide/11-align.md) say the rest.

## Exercise 1 of 4: a Sanger read against a plasmid

1. Choose **File ▸ Open file…** and select `AL-Plasmid.gb`. Close every other tab.

   > [!NOTE]
   > You see `AL-Plasmid`, **480 bp**, circular, with a promoter, `synthORF` and a terminator in its **Features** list.

2. Click the **Align** tab.

   > [!NOTE]
   > You see **Reference: AL-Plasmid, 480 bp, circular.**

3. Click **Choose file…** and select `AL-Read.fasta`.

   > [!NOTE]
   > You see **From AL-Read.fasta.** under the box.

4. Click **Align**.

   > [!NOTE]
   > You see **Local alignment**: score 491, identity 99% over 100 columns, 0 gap columns, reverse complement of the pasted sequence.

   > [!TIP]
   > The read is 100 bp of a 480 bp plasmid, under half its length, so the mode was chosen for you as Local: Global would score the read across the whole plasmid. **Open Align workspace ›** opens the Align workspace, where the **Options** group shows the mode and says why. The read is given on the opposite strand, and both orientations are tried.

5. Click **Results ›**, then **Large view**.

   > [!NOTE]
   > You see the plasmid on top and the read under it, with one coloured column. It is red, because it falls inside the CDS `synthORF`: the plasmid has **A** there and the read **G**, at base **230**.

6. Close the large view (**Close** or `Esc`). In the workspace's **Results** page, point at the heading that reads **Local alignment** with the numbers beside it (score 491, 99%); it is the score line, and a button.

   > [!NOTE]
   > You see the region the read covers, bases **181** to **280**, drawn on the map and in the sequence view; click the score line and those bases are selected.

**Done when:**

- [ ] The summary says Local, 99% over 100 columns, with the reverse complement.
- [ ] The large view has one differing column, at base 230, and the selected region is 181 to 280.

A read from a sequencer carries base qualities; dropped as an AB1 or FASTQ file it also gets its poor ends trimmed and its differences sorted by confidence, as [Aligning a read with its qualities](../guide/11-align.md#aligning-a-read-with-its-qualities) says. These sample files are plain FASTA, so there are none.

## Exercise 2 of 4: four clones, and where they differ

`AL-Plasmid` is the first clone; `AL-Clones.fasta` holds three more. Clone 2 differs from it by one base, clone 3 by that base and a second one, and clone 4 lacks three bases.

1. Keep `AL-Plasmid` as the only tab, and click the **Align** tab.
2. Click **Choose file…** and select `AL-Clones.fasta`.

   > [!NOTE]
   > You see **From AL-Clones.fasta.** and **3 records; the one chosen is aligned, or choose All records to align each of them.**

3. Click **Multiple alignment ›**.

   > [!NOTE]
   > You see the workspace open on its **Multiple** page, with **Include this document** ticked, **Letters are** on **Detected (nucleotide)**, and a button that reads **Align 4 together**.

4. Click **Align 4 together**.

   > [!NOTE]
   > You see a window with four rows, `AL-Plasmid`, `AL-Clone2`, `AL-Clone3` and `AL-Clone4`, in one column space, with the consensus above them and a bar of how conserved each column is.

5. Look along the rows for the columns that are not shaded in full.

   > [!NOTE]
   > You see five: column **230** (clones 2 and 3 carry another base), columns **250, 251 and 252** (clone 4 has dashes), and column **400** (clone 3 only). The consensus is the plasmid's own sequence.

6. Open the **Shading** menu and choose **Base colours**.

   > [!TIP]
   > Each base now has its own colour, so the substitutions are easy to follow down the rows. **Save aligned FASTA**, **Save Clustal** and **Copy FASTA** take the alignment out.

**Done when:**

- [ ] The button read **Align 4 together**, and the window has four rows and 480 columns.
- [ ] Five columns are not conserved: 230, 250 to 252 and 400.

With no document open, **File ▸ Multiple alignment…** takes the same records in a window of its own: see [Without a document](../guide/11-align.md#without-a-document). The window closes with **Close** or `Esc`; do not close it yet if you go on to Exercise 4.

## Exercise 3 of 4: proteins

1. Close the alignment window, and close `AL-Plasmid`. Choose **File ▸ Open file…** and select `AL-Protein.fasta`.

   > [!NOTE]
   > You see `AL-Protein1`, **60** residues, opened as a protein.

2. Click the **Align** tab, click **Choose file…** and select `AL-Proteins.fasta`.
3. Under the box, choose `AL-Protein2` in the record list, and click **Align**.

   > [!NOTE]
   > You see **Global alignment**: score 339, identity 98% over 60 columns, 0 gap columns. Nothing is said about a reverse complement.

   > [!TIP]
   > The score is BLOSUM62's, not a count of matches, and a protein has no second strand to try. The one substitution is at residue 20, **N** against **L**. See [Aligning two proteins](../guide/16-proteins.md#aligning-two-proteins).

4. Click **Multiple alignment ›**, then **Align 4 together**.

   > [!NOTE]
   > You see **Letters are** on **Detected (protein)**, and a window with `AL-Protein1` to `AL-Protein4` in one column space.

5. Look for the columns that are not shaded in full.

   > [!NOTE]
   > You see five: residue **20**, residues **30 to 32** (protein 4 lacks three), and residue **45**. **Save Clustal** writes a file with a line under the rows marking the columns where every protein agrees.

**Done when:**

- [ ] The pairwise result is Global, score 339, 98% over 60 columns.
- [ ] The multiple alignment has four rows and five columns that are not conserved.

With a DNA plasmid open instead, **Include this document** would be greyed, and a line would say it is left out, because a nucleotide document is never scored as protein.

## Exercise 4 of 4: copy a range out of an alignment

Redo Exercise 2 first (the clones, **Align 4 together**), so the window with the four clone rows is open.

1. Find the dashes in the `AL-Clone4` row, columns 250 to 252. In the `AL-Plasmid` row, click the letter four columns to their left, and drag to the letter five columns to their right, so the selection is 12 columns.

   > [!NOTE]
   > You see the same 12 columns shaded faintly on every other row. A small bar appears beside the selection with **Copy**, **Advanced copy…** and **12 columns**.

2. Click **Copy**, or press `Ctrl+C` (`Cmd+C` on a Mac).

   > [!NOTE]
   > You see **Copied**. What went on the clipboard is `ACCAACGACCGA`, the row's own letters.

   > [!TIP]
   > `Ctrl+Alt+C` copies the row as drawn, gaps kept as `-`. On the `AL-Clone4` row the same columns give `ACCAACCGA` without the dashes, because only the row's own letters are copied.

3. Click **Advanced copy…**.
4. Under **Rows** choose **All 4**, leave **Columns** on **Selection (12)**, and under **Format** choose **FASTA**.

   > [!NOTE]
   > You see the **Gaps** choice greyed out, and the preview show four records, with `ACCA---ACCGA` for `AL-Clone4`.

   > [!TIP]
   > With more than one row the gaps are kept, so the rows stay in register.

5. Click **Copy** in the panel.

   > [!NOTE]
   > What went on the clipboard is:
   >
   > ```
   > >AL-Plasmid
   > ACCAACGACCGA
   > >AL-Clone2
   > ACCAACGACCGA
   > >AL-Clone3
   > ACCAACGACCGA
   > >AL-Clone4
   > ACCA---ACCGA
   > ```

**Done when:**

- [ ] The bar said **12 columns**, and the first copy was `ACCAACGACCGA`.
- [ ] The panel's copy has four FASTA records, the last with three dashes.

**Names** and **Coordinates** under **Extras** add the sequence names to text lines and the column and residue numbers to either format; **Columns** can take the whole alignment instead. `Esc` closes the panel, a second `Esc` clears the selection. See step 5 of [Aligning several sequences together](../guide/11-align.md#aligning-several-sequences-together).

Next: back to the [tutorials index](README.md).

## How it works

This is a **synthetic example** (invented sequence), so nothing here is a real read or a real clone.

`AL-Plasmid` is 480 bp, circular: `synthetic promoter` (21–120), `synthORF` (151–333, 61 codons with the stop) and `synthetic terminator` (344–403). `AL-Read` is bases 181 to 280 turned onto the other strand, with base 230 changed from A to G. The clones in `AL-Clones` are the plasmid with base 230 changed (clone 2), with bases 230 and 400 changed (clone 3), and with bases 250 to 252 deleted (clone 4). The proteins are 60 residues; protein 2 has residue 20 changed from N to L, protein 3 that and residue 45, and protein 4 lacks residues 31 to 33 (the alignment shows the gap at columns 30 to 32, which is the same change, because the residue before the gap repeats the last one in it).

Four words:

- **Local and Global:** Global aligns two sequences end to end; Local finds the best-matching stretch, which is what a short read against a plasmid needs.
- **Identity:** the identical columns over all columns of the alignment.
- **Consensus:** the commonest letter in each column, blank where most sequences have a gap.
- **Conserved column:** one where every sequence carries the same letter; the others are the places where the sequences differ.

The multiple alignment is the app's own, and it does not match the best programs column for column: see [Aligning several sequences together](../guide/11-align.md#aligning-several-sequences-together).
