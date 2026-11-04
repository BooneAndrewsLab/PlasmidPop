# 128. The multiple alignment's alphabet (#369)

**Asked:** the multiple alignment took nucleotide or protein scoring from
the open document, so a DNA plasmid open while protein records were aligned
silently scored them as bases. #369 also asks for a File-menu entry that
aligns records with no document; that second stage is left to #354's Align
workspace.

**Built (stage 1):**

- `src/app/msaAlphabet.ts`, pure and tested. `recordKind` reads one
  sequence: at least 90% A, C, G, T, U, N is nucleotide (or 80% of those with
  the other IUPAC codes bringing it to 97%); under 75% is protein (a real
  protein is about a quarter ACGTN); in between, or under ten letters,
  is unclear. `detectAlphabet` settles a set only when every record agrees;
  a mixed set or a doubtful record gives no alphabet and a message, rather
  than a guess. `alphabetInUse` applies the user's override.
  `documentJoins` decides whether the open document may join.
- `MsaControls` uses the records' alphabet. A "Letters are" menu offers
  Detected (X), Nucleotide, Protein. With no settled alphabet Align is
  disabled and the reason is shown.
- The group says in a line whether the document is included. A document in
  the other alphabet from the records is never included silently: its tick
  box is disabled and the line gives the reason. Unticking is also stated.
- The analytics `align / msa` event now names the alphabet used.

**Decisions:** the records alone vote, not the document: the document is the
one that is made to fit. The override applies to the records, and the
document then joins only if it matches the override.

The record parsing (`readRecords`, `readFile`) moved from `AlignPanel` into
`src/app/sequenceRecords.ts` unchanged, so that the later window can share
it.
