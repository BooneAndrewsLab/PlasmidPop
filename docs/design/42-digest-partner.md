# 42. A double-digest partner for one enzyme

Done, 2026-09-23 (#22). Item 30's double digests pair the enzymes the list
shows, so "a partner for EcoRI" meant filtering the list down to EcoRI and
whatever might go with it — which is the answer being looked for.

- **One side fixed** (`bestPartners` in `core/analysis/gel.ts`): the same
  judgement as `bestPairs` — the merge of two sorted cut lists, the cheap
  `mayBeReadable` test first, `compareDiagnostic` to rank — factored into
  `pairJudge` so the two cannot drift apart. Fixing one side makes it
  linear, so it looks through a whole imported table (1,500 candidates in a
  few ms) with no `MAX_PAIR_CANDIDATES` cap.
- **Where the partners come from.** Every row that cuts one to three times
  (`MAX_PAIR_CUTS`), one per isoschizomer group, ignoring the name and
  cut-count filters: they are how you found the anchor, not a statement
  about its partner. Sold by still holds, because a partner you cannot buy
  from the supplier you order from is no answer.
- **Choosing the anchor** is a **Pair** menu in the Double digests section,
  local to the panel rather than remembered: it is a question about this
  construct. With exactly one enzyme ticked the section offers it as the
  anchor, because ticking EcoRI is how that question usually begins.
- Pairs found for an anchor keep it first ("EcoRI + PvuII") rather than
  the alphabetical order the listed pairs use.
