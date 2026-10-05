# 63. Analysis results after an edit (#138)

**Found:** the 2026-10-05 correctness audit. After an edit the store keeps
the previous cut sites and ORFs, shifted through the edit, as a
`provisional` result so the views have something to draw while the worker
rescans (`carryAnalysis` in `editorStore.ts`). It dropped a site only when
its positions stopped lining up, so a same-length substitution that rewrote
a site (EcoRI `GAATTC` → `GAATTA`) carried it unchanged. The Cloning tab's
digest checked only `analysis.doc === doc`, so in that window it listed two
fragments and **Add** shelved a 700 bp piece with an EcoRI end the sequence
no longer had. A failed worker request only showed an error once and never
asked again, so the provisional result could stay for good.

**Built:**

- A carried site is kept only while its recognition sequence is still
  spelled at `siteStart` on its strand (`siteStillMatches` in
  `restriction.ts`, IUPAC and through the origin). Only sites within a base
  of where the edit wrote are checked; the rest moved whole. This covers a
  replace, a paste over a range, a longer replace whose overwritten prefix
  hits a site, and an insertion inside a site that leaves the cut where it
  was.
- A carried ORF is dropped when a replace or a paste wrote over any of its
  bases (a substitution can put a stop in it without moving anything).
- Carrying cannot see what an edit _made_: a new site, or an ORF that grew
  because its bounding stop went. So whatever acts on the results waits for
  the worker: the digest treats a provisional result as not ready ("Scanning
  for restriction sites…", no fragments, nothing to shelve), **Add as CDS
  feature** is disabled, and the map and sequence exports
  (`visibleCutSites`) scan the ticked enzymes on the spot when the result is
  provisional. The views and the Enzymes and ORFs lists still show the
  carried result, which is now a subset of the truth rather than a mix;
  blanking them on every keystroke would flash the lists and lose their
  scroll.
- `useAnalysis` tries a failed scan again after 0.5 s and 2 s, then shows an
  error that names the document and says the digest is waiting. The next
  edit asks again.
