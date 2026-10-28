# 112. Cloning products open with the enzymes the reaction used

Issue #309. A new document opens with every enzyme that cuts once ticked
(34 for the insulin ligation product in `docs/tutorials/cloning`), so a
product's map was crowded with sites the user had not chosen. A separate
note rather than an addition to item 110: this is about the enzyme ticks,
not about how long a scratch document lives.

## What it does

`openDocument` takes an optional `shownEnzymes` in its storage argument
(`OpenStorage`). It is the opening state only: it is not in the document, the
undo history or the writers, does not change the dirty mark, and is held in a
store-side map until the document's first scan, where it replaces the
unique-cutter default and is dropped. Names are resolved against
`activeEnzymes()`, the table the Enzymes tab lists, imported tables included,
and spelled as the table spells them. Unknown names are ignored; when none is
known (or the set is empty) the default applies as before. A document opened
again from storage passes nothing, so it keeps the ticks it was left with.

## Which reaction ticks what

`src/core/cloning/productEnzymes.ts`, one small pure function per rule:

- Ligation (`ligationSeed`): the enzymes at the ends of the parts joined.
- Primer workspace Simulate (`cloningSeed`): the forward and reverse enzymes.
- Golden Gate and Modular (`goldenGateSeed`): the Type IIS enzyme, and the
  second when set. It is ticked although the product has no site of it left.
- Mutagenesis (`inheritedSeed`): the template's currently ticked enzymes.
- Gibson, PCR, Overlap PCR, Gateway, fragments, back-translate, compare,
  protein and consensus: unchanged.

`tutorialFiles.test.ts` asserts the seeded sets of the synthetic exercises
through the same functions and `resolveSeed`.
