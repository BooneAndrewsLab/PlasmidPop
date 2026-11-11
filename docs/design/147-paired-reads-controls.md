# 147. Paired reads: show, correct, switch off (#421)

`findReadPairs` infers mates from names (note 130). It is conservative, yet a
name that merely ends in 1 and 2 can be taken for mates, and a wrong pair
biases repeat placement and the mate-based contig links.

## What was built

- `ReadPair` gained an optional `rule` (`casava`, `illumina`, `separated`,
  `joined`, `manual`). `findReadPairs` is unchanged in what it returns;
  `findRulePairs` is the same search with the rule on each pair, which the app
  uses. This kept every existing exact-match test on `findReadPairs` as it was.
- `applyPairEdits(inferred, edits, readCount)` (pure, in `pairing.ts`) is the
  one place the edits are applied: pairing off gives none (manual pairs too);
  broken inferred pairs (keyed by their two read indexes, `pairKey`) are
  dropped; manual pairs are added. A read has one mate, so a manual pair
  displaces any inferred pair, and any earlier manual pair, that shares a read
  with it. Self-pairs and indexes that are no read are ignored.
- The Assemble page has a Read pairs section (`ReadPairsPanel`): the on/off
  box, the list with each pair's rule and a Break button, two selects and
  Pair them, and a reset. The effective pairs, not the inferred ones, go to
  `assembleReads`, so placement and links follow them.

## Decisions

- The edits live in the align session, tagged with an identity of the records
  they were made on (names and lengths); other records start clean, since the
  edits are read indexes. Nothing is written to IndexedDB or the URL.
- A manual pair's first mate is the one read forward, as for a named pair, so
  the user chooses the order. Only the checks that read orientation care.
- Breaking a manual pair removes it; an inferred pair it had displaced
  returns. The reset button is the way back to the names' pairs.
- The note under the controls says "in use" instead of "found by name" once
  anything is edited.
