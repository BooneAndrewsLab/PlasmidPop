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
- **What is in it** (rebuilt 2026-09-26 for #94 and #98, and again for
  #94 in 1.10, six parts more): 175 core parts
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
  SP6 promoter (`X65327`, pSP64). The last six came in for #94 (1.10), 175
  core parts now, none from a SnapGene-annotated record:
  - the **tet operator**, a probe of the 19 bp TetR site found once in Tn10
    (`J01830`; the second operator differs in one base);
  - the **TRE**, the seven-operator array as annotated in Gossen and Bujard's
    own pTRE (pUHD10-3, `U89931`, Clontech 1997);
  - **lacUV5**, as annotated in the primary sequence of prophage DE3
    (`NC_042057`), where it drives T7 RNA polymerase; an _exact_ part (see
    below);
  - **T7lac**, the T7 promoter running into the lac operator, from
    `Z32692` (pT7T7, Chen 1994): a vector record, but one with no
    annotation of its own whose reference table places the T7 promoter and
    the lac operator (citing Dubendorff and Studier 1991); its 44 bases are
    those pET-11c annotates as T7lac. The vector record is only where the
    bounds were read; the bases themselves rest on primary records, and the
    note says so: the first 20 bp equal the T7 phi10 promoter of the T7
    genome (`V01146` 22887..22906; it annotates promoter phi10 at 22904, the
    transcription start), the next 22 (`GAATTGTGAGCGGATAACAATT`) equal the
    natural lac operator of the E. coli lac operon (`J01636` 1250..1271),
    and the last 2 (`CC`) are the vector junction;
  - the **H1 promoter**, from the human H1 RNA gene (`X16612`), which
    annotates only its TATA box and transcript: the part ends at the base
    8 bases short of the transcript (152..366, 215 bp), and starts where the
    H1 promoters of two shRNA vector records (`HQ416701`, `MH749464`) start
    — a convention, said so in the note. It stops short because pSUPER-type
    vectors replace those last 8 bases with their cloning site: in
    `HQ416701` the full 223 bp was found at 98% with 4 mismatches, all in
    the 8, and missed at 100%; the 215 bp part is found there exactly at
    every setting. `MH749464` is an H1/TO promoter with a tet operator
    inside its 3′ end: the full 223 bp was missed at 95%, and the shorter
    part is found there at 95% and 90% as a gapped near match (6 edits at
    95%), listed beside the tet operator. That reads right for an H1-derived
    promoter: the indel wording shows it is not the plain H1;
  - **ARSH4**, the 86 bp `rep_origin` the chromosome II RefSeq (`NC_001134`)
    annotates as ARS209, "originally referred to as H4 ARS". The pRS
    CEN/ARS vectors carry a longer stretch around it, which is found as
    containing this one.
    Of the FPs
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

## Homologues of every CDS (#219, 1.14)

Item 59 matched what a part codes for only for tags and fluorescent
proteins, and only with substitutions. A resistance marker recoded for another
host (Kan, Hyg, Bsd, Puro, Zeo are codon-optimised in every vector family) and
a diverged homologue (another aminoglycoside phosphotransferase, another
β-lactamase) read as too many mismatches in DNA. pLannotate finds them with a
DIAMOND search against Swiss-Prot; its method (McGuffie and Barrick, NAR 2021) is the model, its code (GPL-3.0) is not used, and Swiss-Prot is far too
large for the browser. The search is of the bundled list plus My parts.

- **Every CDS has a protein.** `codingProtein` (`library.ts`) translates a part
  of type CDS made of whole codons with no stop inside (a closing stop is
  dropped), when the part has no protein of its own. It is applied as the
  files are read and to My parts (`myPartToLibraryPart`), so nothing is typed
  in and the build and data files are unchanged: the protein is the
  part's own cited bases. That brings in about 60 CDS parts (markers, enzymes,
  repressors such as lacI and tetR, Cas9, reporters) to the 98% protein match
  of #93, which now finds them recoded.
- **A gapped search** (`homologue.ts`). The six translations are seeded with
  exact four-residue words, a hit being a cluster of three words within 16
  diagonals that an ungapped BLOSUM62 stretch (score 45, about 20 bits)
  confirms, the way BLAST's two-hit method and DIAMOND confirm theirs.
  A confirmed cluster is aligned locally, in a band around it, with
  `alignInBand` and the protein alphabet, so the scoring is `src/core/alignment`'s BLOSUM62 with gaps at
  11 to open and 1 to extend, not new code. A hit must reach its class's
  identity (of the alignment's columns), coverage (share of the part's
  protein spanned) and bit score (gapped statistics, λ 0.267, K 0.041), and
  also an expectation of 1e-5 or less over the six frames searched.
- **Thresholds per part class** (`homologueThreshold`). Proteins under 150
  residues: 50% identity, 80% coverage, 40 bits. Fluorescent proteins, a
  family of relatives sharing one fold: 60%, 90%, 60 bits, so only a near
  relative is named. The rest: 35%, 70%, 50 bits. Proteins under 50 residues
  are not searched (tags match exactly, #93). Validated on synthetic recoded
  and diverged variants and random sequence (`docs/perf-notes.md`); the oracle
  (#220) will measure recall on real homologues, and the thresholds are
  to be revisited then.
- **"Similar to", never "is".** A hit carries `similar` (its coverage and
  bits). The panel says "similar protein: 87% identical over 96% of the
  part's protein", and a feature added is named `similar to KanR`, never
  `KanR`, with the same words in its note and the part's record.
  `similar` hits are set aside from the rest: a part of the same type found
  over half of the same bases (by DNA or by its protein) is the answer and
  the "similar to" is dropped; among homologues the better score wins.
- **Speed.** 154 proteins (43,035 residues) against 1 Mb of random sequence: 0.8 s,
  about 8 ms for a plasmid, and no hit in 400 kb of random sequence.
  `DetectOptions.homologues: false` turns it off.

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
- **Substitutions first.** The diagonal check counts substitutions only;
  a copy with an indel is found by the gapped pass below (#94, 1.10), which
  offers an indel only where substitutions cannot explain the copy.
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

## Exact parts (follow-up of #94)

At the default 95% the 43 bp lacUV5 matched every wild-type lac promoter
with 2 mismatches, exactly the two -10 box changes (`TATGTT` to `TATAAT`)
that define it, so a plain lac promoter was also reported as lacUV5 (seen
in `HQ416701` and `Z32692`). A part that is a few-base variant of what
people usually have cannot be told from it by identity, so a spec entry may
say `"exact": true` (build script → data JSON → `LibraryPart.exact` →
`detect.ts`): the part is reported only when every base matches.

- No mismatches and no indels, at every **Match at least** choice: the part's
  mismatch budget and indel budget are both 0.
- An ambiguity code in the sequence where the part has a base rules it out
  too. A plain part reports it as an ambiguous base; here the point is that
  the variant bases are confirmed, and an `N` confirms nothing. (The part's
  own bases are always A/C/G/T, the build refuses others.)
- A hit cut off by a linear end is not offered: it cannot be shown to match in
  full, and the variant bases may be the ones missing.
- The plain parts are untouched. lacUV5 is the only part marked: a survey of
  every core part searched for in the whole library at 95% found no other
  pair of few-base variants. The cross hits it showed are one part inside
  another (CMV enhancer in CMV enhancer and promoter, 1 mismatch; SV40 ori
  in the SV40 promoter, 1 mismatch) or a primer/operator inside a longer part,
  none of them a variant of the same sequence. There is no lacI promoter part,
  so lacIq has no wild-type neighbour to be mistaken for.

## Indels (#94, 1.10)

A part with a base or two inserted or deleted — a frameshift, a filled-in
site, a vector's own small change — was not found at all: past the indel
every base is off the diagonal the seed named. The issue suggested
verifying seeds with a banded fill around them, as item 46 aligns reads.

- **A fill per seed was too slow.** The first version ran a banded
  edit-distance fill wherever a diagonal failed its check: 538 ms on the
  megabase against 146. A chance seed against a long part fails its
  diagonal after a few dozen bases, but in a band of 17 cells with the
  whole of a long part's budget to spend (43 edits for AmpR, 205 for Cas9)
  a fill runs hundreds of rows before giving up, and there are some 26,000
  chance seeds in a megabase.
- **So the fill only goes where the seeds have gathered.** The q-gram
  lemma holds for edit distance too: a match of L bases with k edits leaves
  at least L + 1 − 12(k + 1) of the part's 12-mers intact, all on diagonals
  within the indels' reach of each other. The seeds of each part are
  recorded during the scan and, after it, sorted by diagonal and swept with
  a window as wide as the band; only where a window holds that many seeds
  is the fill run, around the window's middle. A chance word never brings
  thirteen friends, so in practice the fill runs only on real copies.
- **The budget for a match with indels is one lower** where the seed cap
  binds (`indelBudget`: `floor(L / 12) − 2` against `− 1`), which is what
  makes the count at least 13 rather than 1, and a count of 1 would gate
  nothing. At the default 95% the identity binds first for any part over
  60 bases, so nothing changes there; at 90% a short part loses one edit
  when it has an indel; parts under 36 bases are not looked for with
  indels at all, as parts under 24 are only found exactly.
- **Up to 8 bases inserted and deleted in all** (`MAX_INDEL`), and never
  more than the part's budget: every one spends the budget as a mismatch
  does, so the identity setting still means what it says. The band is 8
  either side of the window's middle; a hit whose indels add up to more is
  dropped, since the band is not sure to hold such a match whole.
- **The fill is its own** (`gapped.ts`), not `alignInBand`: that one scores
  reads (affine gaps, a matrix), builds its band from a chain of anchors and
  allocates per call. Here only the count of edits matters, on the masks
  the diagonal check already uses, in one buffer kept for the search, and
  the fill gives up on the first row already over the budget. The whole
  part is aligned; the sequence's ends are free.
- **Substitutions first.** A window whose diagonals include one where the
  part was already found with substitutions only is skipped, and a gapped
  reading overlapping such a hit of the same part is dropped: an indel in
  the last few bases of a part costs no more as mismatches, and saying
  "2 mismatches" there is as true and less surprising. Of several gapped
  readings of one copy (a run of one base seeds every diagonal) the one
  with fewest edits is kept.
- **Not a cut-off part.** At the end of a linear sequence, a part running
  off it could be read as a run of deletions followed by a base or two
  that match by chance. Near an end, a gapped reading needs at least 12
  paired bases outside its outermost indels, and the partial match (#94,
  1.8) says what is really there. Away from the ends there is no such
  rule: an indel in a run of one base is placed as early in the run as it
  can go (or, if that leaves too short a flank at an end, as late), which
  can be anywhere. The cost is that a part at the very end of a linear
  sequence whose indel slides along a run to within 12 bases of that end
  is not found; the property test keeps its copies off the ends for that
  reason.
- **A circle's array has edges too.** A copy through the origin was at
  first also read at the array's start, as the part less its first bases,
  deleted, and preferred for being longer than the true copy found by
  substitutions a turn earlier. So the rule at the edges holds on a circle
  as on a line, the overhang is long enough (`GAPPED_OVERHANG`, the band
  twice and a seed past the longest part) for the copy a turn on to be
  found instead, which is moved back a turn, and `substitutionsFirst`
  compares ranges round the circle.
- **Through the origin** as before: a hit starts in the first turn and
  covers no base twice.
- **What the list says.** A gapped hit carries `insertions` and
  `deletions` (absent on every other hit), its range is where it lies in
  the sequence, and its identity is of the alignment's columns, so an
  insertion counts against it too. `describeMatch` names the indels first —
  "1 base deleted, 99.8%", "3 bases inserted, 1 mismatch, 98.7%" — so a
  gapped hit reads differently from a substitution-only one in the list
  and in the note on the feature it becomes.
- **Tests.** The slow listing of every placement still checks the
  substitution-only search hit for hit (with `gapped: false`); a second
  property test plants a part with random substitutions and indels within
  the budget, on either strand and through the origin, and checks it is
  found, that a gapped reading has no more edits than were planted, and
  that the part is within the edits each hit reports of the bases it
  names (an unbanded edit distance). fast-check's strings run to long runs
  of one base, where every diagonal is seeded and an indel can sit anywhere
  along the run; that is what found the faults at the edges, and 12,000
  runs over six seeds pass.
- **Measured** (`docs/perf-notes.md`): the megabase against the whole
  library, now 275 parts, takes 169–174 ms on its first full run (after a 50 kb warm-up)
  it against 146–154 ms before, and 101–103 ms against 99–103 ms once warm.
  Recording the seeds and sorting them (~26,000 in a megabase) is a few
  milliseconds; the rest of the first run's cost is the fill itself
  running cold on the few real copies.

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
