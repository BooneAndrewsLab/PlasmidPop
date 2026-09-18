# Pairwise alignment

The **Align** tab aligns another sequence to the open document, for example
a Sanger read against the plasmid, or a synthesised fragment against its
design.

## How to align

1. Paste the other sequence into the box: bare bases, a FASTA record or a
   GenBank record all work.
2. Choose **Global (end to end)** to align the whole of both sequences
   (Needleman–Wunsch), or **Local (best region)** to find the best-matching
   stretch (Smith–Waterman). Local is the right choice for a read against a
   plasmid.
3. Tick **Against selection only** to align against the selected part of
   the document instead of all of it.
4. Click **Align**. Both orientations of the pasted sequence are tried and
   the better one is shown; the heading says when it was the reverse
   complement.

The result reports the score, percent identity, the number of columns and
of gap columns, then the alignment in blocks of 60 with the document
position (1-based) at the start of each line. `|` marks identical bases,
`.` a mismatch and a space a gap. **Select aligned region in this
document** selects the covered bases so you can annotate or copy them.

## Scoring and limits

Scores use match +5, mismatch −4, gap open −10 and gap extend −0.5 (the
EMBOSS DNAfull scheme). Alignment runs in a background thread and the
interface stays responsive; inputs whose product exceeds 30 million cells
(about 5.5 kb × 5.5 kb) are refused to protect the browser's memory. Align
against a selection, or a smaller region, for longer inputs.
