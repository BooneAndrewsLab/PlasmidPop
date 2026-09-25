# 54. Changing the case of bases

Done, 2026-09-25 (#90; `SeqDocument.changeCase`, `src/app/components/CaseMenu.tsx`).
Colleague feedback: _allow changing case of selected nucleotides – all
upper, all lower, flip current case_. Case is a common way to mark a stretch,
such as an insert in capitals inside a lowercase vector, and the document
has always kept the case it was given.

## The op

`changeCase { range, mode }`, with `mode` `upper`, `lower` or `toggle`,
rewrites the letters of the range in place, across the origin too. It is not
a `replace`, for two reasons:

- A `replace` drops a sequencing read's qualities and trace, since new bases
  make them wrong. A change of case leaves the bases as they were, so
  `changeCase` keeps the read.
- It says what it did in the History: _Uppercase_, _Lowercase_, _Toggle
  case_.

Features, base styles (item 53) and the ends are untouched, since nothing
moves. A range whose letters are already in the case asked for gives back
the same document, so the History gets no empty step.

## The diff is blind to case

`diffDocuments` compares the two sequences upper-cased. Before this, a case
change marked every base of the range as changed, and Compare between a
lowercase file and an uppercase copy of it marked the whole molecule. A
letter's case says nothing about the base: the checksum already treats `a`
and `A` alike, and so do the analyses. The one thing this gives up is seeing
case changes as edits. That seemed right, since case is how the user marks
bases, not a change to the molecule. A changed feature is still judged by its
bases upper-cased, as before.

## Where it is

**Case ▾** is on the floating selection bar and on the edit bar, which
answers `Alt+U`. It closes after a choice, unlike the Style menu, since the
choices do not combine.
