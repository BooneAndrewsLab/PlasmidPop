# 34. Turning a sticky-ended molecule over loses the window shift

Fixed
2026-09-22. Found the same day by the checksum of item 22, which is what a
checksum is for: `ldseguid` is invariant to which strand is on top, so
turning a fragment over and getting a different one says the _turn_ is
wrong, not the checksum. `SeqDocument.reverseComplement` reverse-complemented
the top strand and swapped the ends (`flipEnds`), but the new top strand is
the old _bottom_ strand, which starts and ends elsewhere: a molecule with an
EcoRI 5′ overhang at the left and a PstI 3′ one at the right has 4 bases at
each tip with nothing under them, and after the turn the document claimed
all of them were double-stranded and 8 bases that are not there at all.
Same molecule in, different molecule out.

- **The window is one calculation now, in `ends.ts`.** `flipWindow(ends)`
  gives the bases a bottom-strand overhang carries just outside the
  sequence and that come into it (`head`, `tail`) and the bases of the
  sequence that only the top strand has and that leave it (`trimStart`,
  `trimEnd`), with `windowShift` and `flippedLength` derived from them.
  `flipFragment` (`src/core/cloning/ligate.ts`), which had the arithmetic
  right all along and inline, now asks the same function — the fragment
  and the document were never going to be two different questions, and
  `FragmentEnd` is `StrandEnd`.
- **The document reframes itself before it reverses.** `onBottomStrand` is
  four existing ops — insert the two bottom-strand overhangs, delete the
  two top-strand ones, then put the ends back, since each of those edits
  reaches a tip and `endsAfterEdit` rightly blunts what it reaches — and
  `reverseComplement` runs over what comes out. So the trimming carries a
  feature annotated on an overhang away with the overhang, through the
  same `delete` as everywhere else, rather than through a second copy of
  extract's logic (`extractRange` cannot be imported here: it imports
  `SeqDocument`).
- **A sticky flip changes the length**, which is the visible part and the
  reason this was its own decision rather than part of the checksum work.
  `selectionAfterOp` mirrors about the _new_ length and about the moved
  window, clamping each end, so a selection on an overhang that has gone
  collapses to the tip it was at instead of pointing past the document.
  The caret path (`mapPositionThrough`) is untouched: it has never mirrored
  a reverse complement, and the store already clamps it.
- `seguid.test.ts` has the invariance test for a sticky molecule beside the
  blunt one, `ends.test.ts` the window, the round trip and the clipped
  feature, and `editing.test.ts` the selection. All four fail without the
  fix, which was checked by taking it out.
- Followed up 2026-09-23 (#7). The History step says the length when a
  turn changes it (`describeEditStep`, "Reverse complement: 1,000 → 992
  bp"), since the length is the one visible consequence. `diffDocuments`
  recognises a turn: when the forward diff is coarse or marks at least
  half the molecule, it diffs again against `baseline.reverseComplement()`
  and keeps the smaller answer, flagged `reversed`. The window moves the
  same way for the baseline as it did for the document, so a sticky flip
  marks nothing — the molecule is the same, read from its other strand —
  and edits either side of the turn are marked as edits. `isEmptyDiff` is
  false for a turn even with no marks, so the Edits summary and the save
  review say "turned over" rather than "nothing differs". The second diff
  runs only when the first came back large, so ordinary typing pays
  nothing; a heavily edited document pays a second capped diff (≤ ~20 ms).
  A feature that sat only on an overhang the turn dropped is in neither
  version compared, so it is not listed as removed.
