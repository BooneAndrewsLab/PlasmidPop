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
- **What is in it** (rebuilt 2026-09-26 for #94 and #98): 169 core parts
  (nine of them peptide tags with no DNA) and 100 fluorescent proteins, 26 of which
  are proteins without a coding sequence. Before #93 it was 153 core parts (markers 28, promoters
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
- **What is not, yet.** The short tags are in since #93 and #98, matched on
  the protein. Of the parts #94 listed, seven came in from primary records
  in 1.8: Cas9 (the CDS of `NC_002737`), CEN4 (`NC_001136`), the RSV 5' LTR
  (`J02342`), oriP (`V01555`, the family of repeats through the dyad
  symmetry), RK2's oriV (`BN000925`), R6K's gamma origin (`M65025`) and the
  SP6 promoter (`X65327`, pSP64). Still out: TRE/tetO arrays, T7lac, lacUV5
  and the H1 promoter, and ARSH4. Every vector record that annotates them
  and was looked at carries SnapGene-generated annotation, which item 59
  rules out as a source; they need a primary record or a probe against one. Of the FPs
  FPbase lists, those without a GenBank protein, with a partial `/coded_by`
  or whose CDS does not translate to FPbase's sequence (EYFP, ECFP,
  mTurquoise2, mScarlet, sfGFP, mKate2, TagBFP…) were dropped by the
  build's own checks. Most of these are short protein tags and FPs whose
  codons vary between vectors anyway, the case protein-level matching is
  for.

## Matching what a part codes for (#93, 1.8)

The DNA search cannot see two kinds of part: a short peptide tag, which
every vector spells in its own codons and no public record annotates as
DNA, and a protein carried between constructs with synonymous changes,
which reads as a string of mismatches. So a part may carry a `protein` as
well as (or instead of) its bases, and `detectProteinFeatures` looks for
those in all six translations.

- **The data is still never typed in.** A tag that exists in DNA somewhere
  gets its peptide from its own cited bases (`alsoProtein` in the spec:
  the build translates the part and checks it is whole codons with no stop
  inside), so FLAG, Myc, 8xHis, the PreScission and thrombin sites, the 2A
  peptide, GST and MBP are now matched either way. A tag with no DNA record
  at all is a `proteinProbe`: the peptide must occur exactly once in the
  protein record cited, which is how the SV40 NLS (NP_043127.1) and the T7
  tag (NP_041998.1) came in. A misremembered peptide fails the build.
- **FPbase without a coding sequence.** `buildFp` no longer drops a protein
  whose `/coded_by` is missing, partial or disagrees with FPbase; it keeps
  the protein alone, citing the GenBank protein record. That brought in 26
  of the proteins people actually use — EYFP, ECFP, mTurquoise2, mScarlet,
  Superfolder GFP, mKate2, TagBFP, Clover, mRuby2/3, Citrine, Venus,
  Cerulean, YPet, mEmerald, Dendra2, mEos2 and others — which is what the
  issue was mostly about. The bases are still only ever kept when they
  translate to FPbase's protein.
- **Seeded like the DNA search**, and for the same reason: five residues,
  the q-gram lemma capping the budget at `floor(L / 5) − 1`, so a match
  within the budget always shares a seed. Parts of 12 residues or fewer must
  match exactly — a FLAG tag with one residue changed is not a FLAG tag, and
  an inexact short peptide would be everywhere. The identity is stricter
  than the DNA default (98%): a protein match is already a near-certain one.
- **In codes, not strings.** The first version translated to six strings and
  took a `slice` per position: 780 ms over the DNA search on a megabase,
  nearly all of it allocation. The frames are now `Uint8Array`s of five-bit
  residue codes, the seed is a rolling 25-bit word, and a 4 MB bitmap
  answers "in no part" before the map is asked — 16 ms over the DNA search
  (`docs/perf-notes.md`). A stop codon, or any codon with an ambiguous base,
  is not a residue and breaks the run, so no match reads through a stop.
- **The hits join the rest.** A protein hit is an ordinary `FeatureHit` with
  `viaProtein` set, in bases on the forward strand, and goes through the
  same `keepBest`: a part found both ways is offered once, the DNA match
  preferred as the more exacting. The panel says which it was (`exact
protein match`), and so does the note on the feature added.
- **The rest of the tags** (#98, 1.8). Each needed a public protein record
  carrying the peptide exactly once, which the build checks; a search of
  NCBI for engineered proteins, filtered to records of at least a hundred
  residues so the citation is a real protein rather than a deposited tag,
  found one for each: 6xHis and Avi-tag in `XZY19134.1` (a construct whose
  own name is `AviTag-His6-…`), Strep-tag II in `AMR75014.1`, HA in an
  anti-CD20 scFv (`AAO22134.1`), V5 in a tagged HCV polyprotein
  (`AHD25925.1`), the S-tag in bovine pancreatic ribonuclease
  (`NP_001014408.2`, where the S-peptide comes from), and the TEV site in
  the TEV polyprotein itself (`P04517.1`). A Swiss-Prot header names the
  record `sp|P04517.1|POLG_TEV`, so the build takes the accession out of
  it. SUMO is still out: the "tag" is the whole SMT3 protein, which is a
  sequence to fetch rather than a probe to check.

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
- **A part cut off by the end of a linear sequence** (#94, 1.8) is offered
  for the piece that is there: a fragment cut out of a vector ends in the
  middle of whatever it ends in, and saying "the first 380 bases of AmpR"
  is more use than saying nothing. A placement may hang off either end of a
  linear sequence (never a circle, which has no ends), the comparison and
  the identity are of the overlapping piece, and the budget is scaled to it
  so a piece is held to the same identity as a whole part. To keep chance
  out, at least 30 bases and a fifth of the part must be there. The hit
  carries `partialStart`/`partialEnd`, the feature is marked partial at that
  end (GenBank's `<`/`>`), the list says "exact as far as it goes, cut off
  at the end", and a whole part beats a piece over the same bases in
  `keepBest`. The property test's slow listing enumerates the same
  placements, so the two still agree hit for hit.
- **IUPAC in the sequence.** A code that allows the part's base is counted
  as `ambiguous`, one that rules it out as a mismatch; both spend the
  budget, and identity counts only definite matches. A word containing a
  code seeds nothing, which looked like a hole (#94): a sequence peppered
  with N seemed able to hide a part the budget allowed. It cannot. A code
  spends the budget exactly as a mismatch does, and the budget is capped at
  `floor(L / 12) − 1`, so by the q-gram lemma a match within it always
  leaves a window of twelve positions with neither — which is a seed. The
  test puts a code every thirteenth base, as dense as 90% identity allows,
  at each of the thirteen offsets, and the part is found every time. No
  code was needed; the guarantee was already there.
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
