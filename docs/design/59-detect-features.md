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
  exact four-residue words (an index of the proteins in typed arrays). A word
  counts only when a second lies within 48 residues on the same diagonal
  band, which is BLAST's two-hit rule and takes a megabase of unrelated
  sequence from 677,000 words to a few thousand. A pair's cluster is confirmed
  by an ungapped BLOSUM62 extension (X-drop 20) scoring 45 or more (about 20
  bits), and then aligned locally in a band around it with `alignInBand` and
  the protein alphabet, so the scoring is `src/core/alignment`'s BLOSUM62 with
  gaps at 11 to open and 1 to extend, not new code. A hit must reach its
  class's identity (of the alignment's columns), coverage (share of the part's
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
- **Speed.** 154 proteins (43,035 residues) against 1 Mb of random sequence: 0.35 s,
  a few ms for a plasmid, and no hit in 1 Mb of random sequence.
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

## Against pLannotate (#220, 1.14)

Nothing had measured how much Detect features misses, so pLannotate 2.0.0 is
the outside oracle. It is run as a separate program only (it is GPL-3.0;
nothing of it is linked or copied here), from its own conda env with its own
databases, outside the repository:

```
mamba create -n plannotate -c conda-forge -c bioconda plannotate
plannotate setupdb                                  # databases stay in the env
python3 scripts/plannotate/fetch_corpus.py          # NCBI -> ~/.cache/plannotate-corpus
python3 scripts/plannotate/run_plannotate.py        # -> src/test/oracle/plannotate.json
```

- **Corpus:** 83 vectors by NCBI accession (`scripts/plannotate/accessions.txt`):
  pUC, pBR322, pET, pGEX, pcDNA, pEGFP, pRS yeast shuttles, pBAD, pLKO and
  lentiviral backbones, AAV, binary plant vectors, reporters and others.
  Only the sequence and the record's topology are kept, so the annotations
  are gone before either tool runs. NCBI records are redistributable, so the
  sequences are committed in `src/test/oracle/plannotate.json` (700 kB) with
  pLannotate's version and database versions (snapgene 2021-07-23,
  fpbase and Rfam 15.1 of the 2026-07-05 bundle, Swiss-Prot 2026_02) and its
  hits: name, type, 0-based location, strand, identity, database.
  Five records are marked linear by NCBI and are run, and compared, as such.
- **Test:** `src/test/oracle/plannotate.test.ts` runs Detect features (the
  bundled list, default options) on the same sequences, in about six
  seconds. A pLannotate hit counts as **found** when a hit of ours on the
  same strand shares half of the shorter of the two; an origin is compared
  without strand, since SnapGene draws an origin in the direction of
  replication and a GenBank record as its author did. Fragments of larger
  features (pLannotate's `fragment` flag, 400 of 1388 hits) are left out.
  The test asserts that per-class recall, and overall, stays at or above the
  baseline below, a ratchet: after a change that raises it, raise the
  baseline too. `PLANNOTATE_REPORT=file.md` writes the tables for a re-run.
  CI reads only the JSON.
- **Aliases:** `src/test/oracle/plannotate-aliases.json` maps the SnapGene
  names pLannotate reports to our parts where the names differ (`ori` to
  `pUC ori`, `lacZα` to `lacZ-alpha`). It is oracle data; the app keeps no
  SnapGene names. It decides only whether a miss is "not in our list".
- **Classes:** pLannotate's type, database and name give the class (origin,
  marker, promoter, tag, FP, terminator, RNA); everything else (MCS,
  enhancers, LTRs, introns, operators, other CDS) is `other`.

Baseline, 2026-10-11 (bundled list at 1.14, after the triage of #233 and the RNA parts of #235 below; it was 787 of 988, 79.7%, on 10-10):

| Class      | pLannotate hits | Found | Recall |
| ---------- | --------------: | ----: | -----: |
| origin     |             137 |   129 |  94.2% |
| marker     |             113 |   106 |  93.8% |
| promoter   |             277 |   244 |  88.1% |
| tag        |              13 |    12 |  92.3% |
| FP         |              32 |    29 |  90.6% |
| terminator |              92 |    72 |  78.3% |
| RNA        |              12 |    11 |  91.7% |
| other      |             312 |   211 |  67.6% |
| **all**    |             988 |   814 |  82.4% |

Misses by cause, then the most frequent names of each:

| Cause of a miss     | origin | marker | promoter | tag |  FP | terminator | RNA | other | all |
| ------------------- | -----: | -----: | -------: | --: | --: | ---------: | --: | ----: | --: |
| not in our list     |      8 |      0 |       26 |   1 |   3 |         16 |   0 |    72 | 126 |
| homologue           |      0 |      3 |        0 |   0 |   0 |          0 |   0 |    22 |  25 |
| RNA only            |      0 |      0 |        0 |   0 |   0 |          0 |   1 |     0 |   1 |
| strand differs      |      0 |      0 |        0 |   0 |   0 |          0 |   0 |     0 |   0 |
| below threshold     |      0 |      0 |        0 |   0 |   0 |          0 |   0 |     0 |   0 |
| different extent    |      0 |      1 |        5 |   0 |   0 |          4 |   0 |     6 |  16 |
| recoded or diverged |      0 |      3 |        2 |   0 |   0 |          0 |   0 |     1 |   6 |

- not in our list: MCS (11), bom (10), RBS (9), NOS terminator (6), chimeric intron (5), poly(A) signal (5), RRE (5), LB T-DNA repeat (4), RB T-DNA repeat (4), URA3 promoter (4), AAV2 ITR (3), CaMV 35S promoter (3), EM7 promoter (3), hGH poly(A) signal (3), pVS1 oriV (3), pVS1 StaA (3), 2μ ori (2), attB (2), CMV IE94 promoter (2), gag (truncated) (2), hSyn promoter (2), iFP1.4 (2), NOS promoter (2), pVS1 RepA (2), 3' LTR (1), 5' LTR (1), AOX1 promoter (1), AOX1 terminator (1), CaMV 35S promoter (enhanced) (1), CaMV poly(A) signal (1), cat promoter (1), CloDF13 ori (1), hrGFP (1), hybrid intron (1), IS1 (1), LEU2 promoter (1), MESV Ψ (1), minimal CMV promoter (1), minP (1), MMLV Ψ (1), nucleoplasmin NLS (1), oriT (1), oriV (1), Pc promoter (1), pol region (1), Tn7L (1), Tn7R (1), traJ (1), trfA (1), TRP1 promoter (1), β-globin intron (1)
- homologue: YPB1_ECOLX (6), ermC (2), bar (1), ectD (1), gli4 (1), hH1 (1), ho1 (1), IGK_HUMAN (1), L3 (1), luxS (1), nfsB (1), pcyA (1), PRNP (1), rnc (1), RPOL_BPT7 (1), S (1), tra (1), TUBA1 (1), xyl1 (1)
- RNA only: tRNA (1)
- strand differs:
- below threshold:
- different extent: lacZα (4), PGK promoter (2), tet promoter (2), β-globin poly(A) signal (2), attL1 (1), H1 promoter (1), his3 (1), rrnB T1 terminator (1), rrnB T2 terminator (1), small t intron (1)
- recoded or diverged: KanR (3), CMV enhancer (1), TEF1 promoter (1), UbC promoter (1)

How the causes are decided, in this order: **RNA only** is an Rfam hit (or
a SnapGene RNA) with no part of ours; **homologue** is a Swiss-Prot hit we
have no part for; **not in our list** is no part of ours by that name or
alias; **strand differs** is a hit of that same part of ours there on the other strand;
**below threshold** is a hit only at 90% identity, the lowest offered
(none); **different extent** is our part over a third longer or shorter than
SnapGene's feature of that name, so no hit shares half of both (SnapGene's
HSV TK poly(A) signal is 48 bases, ours is 359); **recoded or diverged** is
a same-sized part not found even at 90%.

What the numbers say:

- The classes the list was built for are found well (origins, markers,
  promoters, tags and FPs, 88 to 94%). The gap is in `other` and in
  terminators.
- Most misses (126 of 201 after #233) are parts the bundled list does not have: the
  plant and yeast promoters and terminators (NOS, CaMV 35S, URA3, LEU2 and
  TRP1 promoters, AOX1), T-DNA borders, AAV ITRs, RBS, MCS, introns, pVS1
  and other origins. They are additions to the list, not matcher faults.
- 25 are found by pLannotate through Swiss-Prot homology (ermC, bar, luxS,
  nfsB and the like); the bundled list carries no such proteins.
- 26 were our part and SnapGene's feature cut differently and 14 the same
  part on the other strand (both triaged below; 16 and 0 remain); 6 are
  Rfam RNAs.
- Nothing is lost to the identity threshold: lowering it to 90% finds no
  further hit.
- **Extras:** 254 of our 1358 hits (253 of 1385 after #233) have no pLannotate hit at the place.
  Primer binding sites are 213 of them, which pLannotate never reports.
  The rest were spot-checked: the SV40 late poly(A) signal (15, an exact
  match; pLannotate calls the early signal where the two overlap), the
  rabbit beta-globin poly(A) signal, the pUC19 and pGEX MCS, and tags
  found in the translation (6xHis, FLAG, thrombin and PreScission sites;
  pLannotate reports peptide tags rarely). None is wrong as far as
  checked; none was removed.

### Triage of the 26 extent and 14 strand misses (#233)

The oracle is a diagnostic here, not a target: its list is SnapGene's, which
is not bundled, so no boundary was copied from it. Where a part was changed
the new bounds come from our own cited NCBI record and from where the copies
in the corpus vectors begin and end (the precedent of the H1 promoter), and
the record's coordinates are in the data file. Which were artifacts and which
fixes:

**Strand (14): none was a wrong strand in our data.**

- _SV40 poly(A) signal x7 (genuine app gap, fixed)._ The SV40 early signal
  is the reverse complement of the late one, so in these vectors both are
  there, on opposite strands. Our 75-base early part was displaced by the
  222-base late part, because the rule that drops a part inside a longer one
  of the same type (meant for variants and sub-parts) ignored strand.
  `keepBest` now displaces only on the same strand (a test in
  `detect.test.ts`; the guide's Detect features page says so). 27 more hits
  appear in the corpus, every one at a place pLannotate also reports.
- _lacZα x4, CYC1 terminator x2 (artifact of the diagnosis)._ Marked
  "strand differs" because a primer of ours overlapped; we had no hit of the
  part at all. They are extent cases (below). The cause now needs a hit of
  the same part on the other strand, and there are none.
- _attL2 x1 (convention)._ Our record (MN047938, annotation read as is)
  reads attL2 in the direction of the vector, SnapGene draws it the other
  way. Our strand is the record's; the comparison ignores strand for Gateway
  att sites, as it does for origins.

**Extent (26): 10 fixed, 16 remain.**

- _HSV TK poly(A) signal x9 (data fix)._ Vectors carry 49 bases of our
  359 (41 bases in, V00470 1482..1530; one has a base fewer). The part is
  now those 49, found wherever the 359 were.
- _HIV-1 5' LTR (truncated) x4 (data fix)._ Vectors that replace U3 carry the
  last 181 bases of the HXB2 LTR, which our 634-base part never matched. New
  part `HIV-1 5' LTR (R-U5)`, K03455 454..634.
- _CYC1 terminator x2 (data fix)._ The vectors share the last 194 of our 219
  bases (with a few single-base gaps); the first 25 differ. Part trimmed to
  Z49548 1309..1502.
- _hPGK promoter x2 (artifact of the alias table)._ hPGK is the human
  promoter, ours is the mouse one (15 bases in common), and the alias said
  they were one. Alias removed; it is now "not in our list" (a human PGK
  part is a follow-up).
- _Accepted, our part is right, no change:_
  - lacZα x4: pBluescript-type vectors carry 15 + 158 bases of our 348 with
    a 79-base MCS in between, past what an indel can span.
  - β-globin poly(A) signal x2: our part ends at the cleavage site; SnapGene's
    runs 31 bases beyond, so the hits share 25 of its 56 bases (45%, just
    under the half the comparison asks).
  - H1 promoter x1: the vector has the last 87 of our 215 bases, the
    shRNA-cloning cut we chose on purpose.
  - his3 x1: a 1110-base HIS3 of another species, no similarity to our
    S. cerevisiae CDS.
  - PGK promoter x2: 427 of our 852 bases, plus 73 beyond its end; a part
    that matches in the middle of a vector needs sub-region matching, below.
  - tet promoter x2, rrnB T1 and T2 x2, attL1 x1, small t intron x1: pieces
    or variants of our parts (attL1 and the rrnB terminators differ by
    several bases; the small t intron is the last 66 bases of our large T
    intron). Not resolved, because the bounds would have to be taken from
    SnapGene's list; they stay as misses.
- _Not done, for a follow-up issue:_ letting a part match on a large,
  well-defined sub-region in the middle of a sequence (as #94 does at linear
  ends) would take lacZα, PGK and the like, but is a matcher change with a
  false-positive cost that wants measuring first.

### RNA parts (#235)

Six of the 12 RNA hits were missed: the Cas9 gRNA scaffold (3, SnapGene's
list) and tRNA (3, Rfam covariance models). A further six, the E. coli 5S
rRNA, were "found" only because the rrnB T1/T2 terminator part overlaps
them. Infernal is still out of scope, so these are plain sequence parts like
the rest, each read from an NCBI record (item 59's rule; nothing from
SnapGene's or pLannotate's lists, nor Rfam's models), with category `RNA` and
the GenBank feature key the data model already colours (`misc_RNA`, `tRNA`,
`rRNA`):

- **gRNA scaffold** (`misc_RNA`, 76 bases), a probe in KX151731, which carries
  it once. The sequence is the published one (Jinek 2012; Mali 2013).
- **5S rRNA** (`rRNA`) and **tRNA-Glu** (`tRNA`), the rrnB operon's, selected
  by product from J01695.
- **tRNA-Gly** (`tRNA`, 72 bases), the one the tRNA-gRNA array vectors use
  (Xie 2015), bases 105..176 of MW827169.

Recall of the RNA class is 11 of 12 (91.7%), all 814 of 988 (82.4%); the
bundled data grew by 1.5 kB. The one miss is a tRNA in a Neurospora vector
(JX156633) found by an Rfam model at 80% coverage, for which no record we
could cite gave the sequence; it stays an Rfam-only hit.
