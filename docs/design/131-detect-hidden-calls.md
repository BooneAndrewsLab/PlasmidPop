# 131. Detect features: show what the rules hid (#289)

**Asked:** #282, #284 and #286 made Detect features drop calls on purpose, and
nothing in the list said so. A user comparing a vector with SnapGene or
pLannotate could not tell a missed label from a hidden one. Code:
`detect.ts` (`keepBest`, `DetectOptions.hidden`, `FeatureHit.hidden`),
`bidirectional.ts` (`splitStrands`), `app/state/detection.ts`
(`offeredWithHidden`), `app/components/DetectFeatures.tsx`.

## What was built

- **Two rules, one flag.** A hit the rules drop is kept, with the reason as
  text. `keepBest` sets aside a segment displaced by its gene (`segmentOf`,
  #282) as `hidden: "a segment of AmpR"`, naming the part that displaced it;
  `splitStrands` (what `inUseStrands` is now a wrapper of) returns the SV40
  strand no gene runs into with `the SV40 late poly(A) signal strand no gene
runs into`. Other drops (an antisense hit inside an annotated CDS, #285;
  the worse of two variants of one locus) are different rules and stay
  dropped: the issue names only these two.
- **Default answer unchanged.** `detectFeatures` returns hidden segments only
  under `{ hidden: true }`, appended after the others; without it the result
  is identical to before, so the corpus and oracle tests are untouched. The
  worker always asks. `offered()` still returns only ordinary offers;
  `offeredWithHidden()` adds the hidden ones, each `Offer.hidden` the reason.
- **List.** Under the list, `N hidden. Show them` with a checkbox (shown only
  when there is something not yet annotated that is hidden). Shown, hidden
  rows sit in sequence order, with a `Hidden: reason` line. Nothing on the map
  and no setting, as the issue says.

## Decisions

- **Hidden rows start unticked and "Tick all" / "Untick all" ignore them.**
  The rules exist because those calls double-label a region; adding all of
  them silently would bring the clutter back. A hidden call is added only by
  ticking its own box. They count towards the "Add N features" button only
  while shown, and unshown ones are never added, whatever was ticked.
  The `all` statistic is true only when every ordinary offer was chosen and
  no hidden one.
- **Duplicates.** A hidden call the document already has is not counted or
  listed, as for ordinary ones.
- **The count is per search**, not remembered: the checkbox starts off each
  time the list is built.
- **No analytics event** for the checkbox: the catalogue (item 38) stays as is.
- A segment is hidden only because a gene hit displaced it in `keepBest`; if
  that gene is itself later removed from the answer (rare: a loser of the
  same-locus step) the segment still names it. Accepted.

## Known limitation: pCI-neo (KU870447.1)

The SV40 rule is unchanged (note 59, #282 case 3). KU870447.1
(pCI-neo-FLAG-SMN) gets the generic early `SV40 poly(A) signal`, while its
parent record (pCI-neo, U47120) labels the late strand. The insert's CDS
ends 646 bp before the signal, beyond `RUN_IN_BASES` (500), so no gene runs
in. No window fixes it: JX088702.1's AmpR ends 673 bp before a late strand
that is not used, and any window from 322 to 645 bp gives the same table on
the 16 corpus loci (14 have evidence, the rule agrees on 13). Showing both
strands whenever no gene is in reach would fix it but bring the clutter back
at all four such loci, where the early label is right in 3 of 4. So the rule
stays; with this note the late reading is one click away (the hidden list),
and the guide says so beside the rule.

## Tests

`detect.test.ts` (flag, only on request, default answer identical),
`bidirectional.test.ts` (`splitStrands` reason, same shown set),
`DetectFeatures.test.tsx` (count, reasons, unticked, Tick all, adding a hidden
call, adding without it).
