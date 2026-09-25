# 59. Detect common features

Issue #60, milestone 1.7. SnapGene and Benchling mark the common parts of a
plasmid on their own when it is opened; a bare FASTA or an Addgene sequence
opened here had no features at all. Asked for: a bundled database of common
parts matched on both strands in a worker, exactly and with a few
mismatches, through the origin of a circle; **Detect features** offering the
hits as a list to take all of or pick from, as one undoable edit; perhaps a
setting to run it on every file opened without features.

## The database, and its licences

Decided 2026-09-25 (issue comment): a hand-curated core, Rfam if useful, and
FPbase for fluorescent proteins in a file of its own. pLannotate's databases
are out: GPL-3.0, and its main set is SnapGene's features.

- **No sequence is typed in.** `scripts/build-feature-db.mjs` reads two
  specs and fetches every sequence from NCBI (efetch) or FPbase (its API),
  caching the records in `scripts/feature-db/.cache` (not committed) so a
  rebuild is reproducible and `--offline` works from the cache. The
  generated files are committed, one part per line so a rebuild's diff reads.
- **The core** (`scripts/feature-db/core-parts.json` →
  `src/core/annotate/data/core-parts.json`): each part names an accession and
  where in it the part lies, in one of three ways: a feature of the record
  picked by key and qualifiers (a CDS is checked to translate to its own
  `/translation`); a GenBank location (with a note saying where it came from
  when the record does not annotate it); or a probe, a short known sequence
  (primer sites, operators, short tags) that must occur exactly once in the
  record, so a probe misremembered fails the build instead of shipping. The
  output cites `accession.version` and the location of every part. The
  build refuses ambiguous bases, parts under 15 bp, two parts of one name
  and two names for one sequence (on either strand).
- **FPbase** (`scripts/feature-db/fpbase-proteins.json` →
  `src/core/annotate/data/fpbase.json`): FPbase stores proteins, and matching
  is on DNA, so for each protein its GenBank protein accession is followed
  through `/coded_by` to a nucleotide CDS, which is kept only when it
  translates exactly to FPbase's sequence. FPbase's data is CC BY-SA 4.0, so
  the file says so in its header, credits FPbase (Lambert 2019) and links
  each protein's FPbase page and paper; `DATA-LICENSES.md` sets the data
  licences apart from the MIT code, and the README points to it.
- **Rfam was not used.** Its families are covariance models and seed
  alignments of structured RNAs, not the stretches of DNA plasmid parts are;
  the RNA elements that matter here (the ColE1-type origins' RNA I/RNA II
  region) are already in the core from the records they were described in.
  Matching an Rfam model would need Infernal-style search, a different tool.
- **What is in it** (built 2026-09-25): 153 core parts (markers 28, promoters
  25, primer sites 22, origins 16, regulatory 16, terminators 10, tags 8,
  recombination sites 8, reporters 8, operators 5, other 7) and 74
  fluorescent proteins, 131,847 bp. Classic vector records (pBR322 J01749,
  pUC19, pACYC184, pGEX-4T-1, pGL3, pTrc99A, pBluescript II, pEGFP-N1…)
  and primary records (Tn5, Tn9, Tn10, Tn903, lambda, SV40, T7, M13, the
  lac and ara operons, S288C mRNAs…). Vector submissions whose annotation
  SnapGene generated were avoided as sources. Where a record does not
  annotate a part and its bounds were taken from neighbouring annotations
  (an intergenic promoter, a poly(A) signal downstream of a CDS) the part's
  note says so.
- **What is not, yet.** No public record annotated the usual DNA of several
  short tags (6xHis, HA, V5, Strep-tag II, TEV site, SV40 NLS…), TRE/tetO
  arrays, SP6/T7lac/lacUV5/H1 promoters, R6K/RK2/oriP origins, or a
  CDS-only Cas9, and they were left out rather than typed in. Of the FPs
  FPbase lists, those without a GenBank protein, with a partial `/coded_by`
  or whose CDS does not translate to FPbase's sequence (EYFP, ECFP,
  mTurquoise2, mScarlet, sfGFP, mKate2, TagBFP…) were dropped by the
  build's own checks. Most of these are short protein tags and FPs whose
  codons vary between vectors anyway, the case protein-level matching is
  for.

## Matching (`src/core/annotate/detect.ts`)

Every part is indexed by its 12-mers on both strands, once per library; a
bit per possible 12-mer (2 MB) answers "in no part" for nearly every word of
the sequence before the map is asked. Each word the sequence shares with a
part names a diagonal, which is checked once, base by base, and dropped as
soon as it has more mismatches than allowed. A circle is read on past its
origin by the longest part's length (and never so far that a part could
cover a base twice), so a hit through the origin is an ordinary range whose
end passes the length.

- **The budget.** A part may have `floor(L × (1 − identity))` mismatches,
  95% identity by default (98%, 90% and exact offered), capped at
  `floor(L / 12) − 1`: by the q-gram lemma a match with fewer mismatches
  than that always shares a 12-mer with the part, so the search never misses
  a match within its budget. The consequence is that parts under 24 bp match
  exactly, which is also what keeps a primer site from turning up by chance.
- **Substitutions only.** An indel in a part is not found. For plasmid parts
  copied from one vector to the next this is the common case; a gapped
  check (the banded fill of item 46 around the seed) is the step after.
- **IUPAC in the sequence.** A code that allows the part's base is counted
  as `ambiguous`, one that rules it out as a mismatch; both spend the
  budget, and identity counts only definite matches. A word containing a
  code seeds nothing, so a sequence peppered with N can hide a part that the
  budget would have allowed (said, not fixed).
- **Overlaps.** A part found twice over the same bases (a palindrome on both
  strands, a repetitive tag a codon along) is kept once, where it fits best.
  Otherwise a hit is dropped when one of the same type, at least as long and
  matching at least as well, covers 90% of it: the pBR322 origin wins over
  the pUC one that differs from it by the copy-number mutation, lacZ over
  the lacZα inside it. Hits of different types never
  displace each other.

Align's seeding (items 45, 46) was looked at, as the issue suggested. It
chains 15-mer anchors of one read against one reference to band an
alignment; here there are hundreds of short queries against one long
target, so the index is of the queries and each diagonal is verified
directly. Only the idea (words of definite bases, rolled two bits at a time)
is shared.

## The worker and the lazy chunk

The library is not in the app's bundle: `loadFeatureLibrary` imports the two
JSON files as `?raw` strings, which Vite puts in chunks of their own, and it
is only called in the worker (`handleAnalysisRequestAsync`), on the first
`detectFeatures` request. The main thread is told of each hit's part
without its bases. Every other request goes through unchanged; the inline
fallback (tests) takes the same async path.

## The offer, and the edit

`src/app/state/detection.ts` keeps each tab's search apart from its
document and history: it is an offer until taken. It holds while the bases
searched are the same (feature edits leave it standing, so a hit the user
annotated by hand meanwhile turns into "already annotated"); once the bases
change the panel asks for a new search instead of offering positions that
no longer mean anything. A closed tab's search is dropped.

- **Duplicates** are hits the document already has: a feature on the same
  strand, of the same type or the same name, sharing 90% of the bases of
  each, so a CDS annotated without its stop codon still counts. They are
  counted in the summary, never offered.
- **One edit.** A new `EditOp`, `addFeatures`, adds all of them or none (it
  validates each), labelled "Add N features" in History, so one undo takes
  a whole detection back; the first one forks a working copy like any edit
  (item 22). A plural op rather than a run of coalesced `addFeature`s,
  because it is one intent, and a CRDT layer will want to see it as one.
- **The feature** takes the part's type and name as its `/label`, its
  description as a `/note`, and a second `/note` "Detected by PlasmidPop:
  exact to J01749.1 complement(3293..4153)" (with "via FPbase …" for a
  fluorescent protein), so an annotation the app made can be told from one
  the file came with, and the source checked.
- **On open.** `detectOnOpen` (a tick box in the list, off by default,
  remembered with the view preferences) searches a file opened from disk
  with no features but `source`, and brings the Features tab forward when
  something is found. It never adds anything by itself: that would fork a
  working copy of a file the user has only opened.

Usage statistics: `detect / run` (`command` or `open`), `detect / add`
(`all` or `picked`), `detect / setting` (`on`/`off`), and the edit itself as
`edit / addFeatures`.

## Measured

See `docs/perf-notes.md`: a 1 Mb sequence against the whole library.
