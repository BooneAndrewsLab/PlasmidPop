# 35. A feature whose type changed reads as a removal and an addition

Fixed 2026-09-22, reported the same day: change a feature's type and
**Compare with…** listed it twice, removed and added, at the same name and
the same location. Not a bug in the pairing so much as its limit. Within
one document the edit keeps the feature's id, so it was already reported
as changed; across two files every id is fresh (item 33), so leftovers are
paired by _content_, and both `bucketKey` and `sameFeature` required the
type to be equal. A feature differing only in type paired with nothing.

- **`pairByContent` has a second, looser pass now**
  (`src/core/diff/documentDiff.ts`). The first pairs features that agree
  about everything, which says nothing to the user; the second asks the
  weaker question of whatever is left over — is this the same feature with
  something changed about it? A feature is _somewhere_, so the mapped
  location has to match, and it has to still be recognisable: the same
  name, or failing that the same type. That catches an edited type (the
  name matches) and a rename (the type matches), and the pair is reported
  as one change rather than a loss and a gain at one place. Two lines read
  as "you have lost a feature", which is the frightening reading and the
  wrong one.
- **A shared location alone is not enough**, which is the rule that keeps
  it honest: pBR322 carries a `gene` and the `CDS` inside it over exactly
  the same bases, twice, and they are not versions of one another. That is
  a test.
- **`featuresChanged` carries the before**, mapped into the newer
  document's coordinates as `featuresRemoved` already was, rather than
  being a bare set of ids: a paired feature has a different id on each
  side, so there is nothing to look the older version up by, and the
  review wants to say what changed anyway. `.has` and `.size` are what the
  renderers and the Edits tally use, so a Map was a drop-in.
- **The review says what changed**, not merely that it did:
  `~ tet type gene → CDS` (`describeFeatureChange` in
  `src/app/featureChanges.ts`), naming the fields that are one thing each
  — type, name, strand, whether it moved — and counting qualifiers, since
  a `/note` can be a paragraph. Where it went is the column every row
  already has.
- **The outline says which kind of change it was** (2026-09-22): solid
  where the feature covers different bases than it did, broken where it
  covers the same ones under another label — retyped, renamed, a
  qualifier edited. That is the one distinction a line can carry and the
  one worth carrying, since the first can break a construct and the
  second cannot. `sameFeatureLocation` answers it off the before the diff
  now holds, which is already mapped into the newer document's
  coordinates, so a feature that only _shifted_ under an edit elsewhere
  is not called moved. Both renderers and so both review dialogs and both
  SVG exports get it from the one helper.
- Not yet: a feature that both moved _and_ was renamed pairs with nothing,
  since the location is the one thing the looser pass will not give up.
