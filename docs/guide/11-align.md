# Pairwise alignment

The **Align** tab aligns another sequence to the open document, for example
a Sanger read against the plasmid, or a synthesised fragment against its
design.

## How to align

1. Paste the other sequence into the box: bare bases, a FASTA record or a
   GenBank record all work. Or drop a file on the box, or click **Choose
   file…**: GenBank, FASTA and SnapGene files are read into the box without
   opening a tab.
2. If the box holds several records (a FASTA file of several reads, say),
   pick the one to align from the list that appears.
3. Choose **Global (end to end)** to align the whole of both sequences
   (Needleman–Wunsch), or **Local (best region)** to find the best-matching
   stretch (Smith–Waterman). Local is the right choice for a read against a
   plasmid.
4. Tick **Against selection only** to align against the selected part of
   the document instead of all of it.
5. Click **Align**. Both orientations of the other sequence are considered
   and the better one is shown; the heading says when it was the reverse
   complement.

The result reports the score, percent identity, the number of columns and
of gap columns, then the alignment in blocks of 60 with the document
position (1-based) at the start of each line. `|` marks identical bases,
`:` a base matched only through an ambiguity code (an `N` in a read, or
`R` in the document against an `A`), `.` a mismatch and a space a gap.
Identity counts only the `|` columns. **Select aligned region in this
document** selects the covered bases so you can annotate or copy them.

## Scoring and limits

Scores use match +5, mismatch −4, gap open −10 and gap extend −0.5 (the
EMBOSS DNAfull scheme). Ambiguity codes score by the same scheme, by the
bases they stand for: `A` against `R` (A or G) +1, `A` against `N` −2. An
`N` is therefore neither a match nor a full mismatch, and a run of them does
not attract the alignment.

Alignment runs in a background thread and the interface stays responsive.
Inputs whose product exceeds 150 million cells (about 12 kb × 12 kb, a few
seconds) are refused to protect the browser's memory; align against a
selection for longer inputs. For large inputs the orientation is picked
first from the short words the two sequences share, so only one alignment
runs; when neither orientation clearly wins, both are aligned.
