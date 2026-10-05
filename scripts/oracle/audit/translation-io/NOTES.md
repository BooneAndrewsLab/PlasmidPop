# translation-io audit — STATE (paused by orchestrator)

Scratch dir: this directory. Vitest harnesses: `src/__audit__/translation-io/{genbank_dump,codes_dump,reads_dump}.test.ts`
(run: `export PATH=/home/matej/Programs/miniconda3/envs/node/bin:$PATH && npx vitest run src/__audit__/translation-io`).
Python oracles: `compare_codes.py`, `compare_genbank.py`, `rotate.py` (python = /home/matej/Programs/miniconda3/envs/primer3/bin/python).
Outputs in `out/` (`codes.json`, `<file>.json`, `<file>.pp.gb`, `compare_genbank_result.json`, `reads.json`, `oracle_snapgene.log`).
Reference data: `gc.prt` (NCBI), `gb/*.gb` (NCBI efetch, incl. esearch batches + `rotated_*.gb` made by rotate.py), `biopy/{GenBank,Abi,Quality}` (Biopython Tests).

## Done + results

1. Genetic codes (codes_dump + compare_codes): all 27 shipped tables identical to NCBI gc.prt v4.6 (aa + start strings) and to Biopython; only diff = double space in table 4 name in gc.prt (cosmetic). All 4096 IUPAC codons x 27 tables: 0 mismatches vs brute-force expansion (X when expansions disagree; Biopython gives B/Z/J there — convention). Lowercase + U fine; firstCodonAsMet TTG/CTG/ATT under tables 1/11/2 correct.
2. reverseComplement/complement: identical to Biopython for all 16 IUPAC codes, upper+lower; non-IUPAC passes through.
3. Six-frame: 0 mismatches vs Biopython on 46 sequences (incl. N-containing, tables 1/2/4/11).
4. ORFs vs brute force: 36/46 exact. 10 circular cases report an EXTRA ORF that is nested inside an origin-wrapping ORF (shares its stop codon mod L) — contradicts orf.ts doc "nested starts sharing a stop are reported once". Example: L=316 seq starting AGAGGGCGAGTGATAGC..., minCodons 4, table 4: reports (273,504,fwd) AND nested (122,188,fwd) (504 mod 316 = 188). Cause: scanStrand starts with orfStart=null at position 0 of the doubled copy, so a start before the first stop is taken although it sits inside the wrapping ORF. LOW severity (display duplicate; positions themselves correct). No missing ORFs anywhere.
5. SEGUID: lsseguid/csseguid/ldseguid/cdseguid identical to `seguid` 0.2.1 package on 14 seqs x 4 = 56 checks. Sticky-end ldseguid NOT yet checked (my hand-made strings were invalid). pydna oracle values computed (see below).
6. GenBank parse vs Biopython 1.88, 958 records (NCBI: NC_012920 t2, NC_001224 t3, NC_000908 t4, NC_000911 3.5Mb t11, NC_005816, NC_000932 plastid w/ transl_except, NG_017013 TP53 exons, NC_001133/NC_001144 yeast chr, NM_000581 Sec, pBR322, pUC19, lambda, ~700 partial-CDS records with codon_start 2/3 across tables 2,4,5,9; Biopython awkward test files; rotated records with 104 origin-spanning CDS on both strands): sequences 954/954 identical; features 18223 compared, 0 piece/strand/partial/order mismatches; 9 count differences all expected (bond(), one-of(), remote ACCESSION:, empty-sequence files, negative location — skipped with warnings) EXCEPT see finding B.
7. CDS translation vs NCBI /translation: 6276/6295 agree (X excused). 19 disagreements:
   - A. 17 are 3'-partial CDS (`<1..>N`) where NCBI translates an unambiguous trailing 2-base codon (GT->V, CC->P, GG->G) and PlasmidPop (and Biopython) drop it. Convention difference; effect: spurious translation ⚠ and "Update /translation" would delete a residue NCBI considers valid. LOW-MEDIUM. Examples: flatworm_mito.gb PZ765744.1 `<1..>778` codon_start=3 tail GT, stored ...SIV vs ours ...SI; partial_myco.gb OQ554331.1 `<1..>1281` cs=2 tail CC.
   - 2 = NC_000932 rps12 trans-spliced `join(complement(69611..69724),139856..140087,140625..140650)`: mixed-strand treated as forward (warned "trans-splicing not supported"). Known limitation, documented by warning. Biopython translates it right.
     All origin-spanning CDS (forward and complement, with codon_start, transl_except TERM in NC_012920) translated correctly. transl_except Sec (NM_000581) correct.
8. Round trip writeGenBank -> Biopython: 957/957 sequences identical, 18216/18216 features identical, 0 location changes. One rewritten file Biopython cannot read: bad_origin_wrap_CDS.gb (original has malformed `REFERENCE   .`; PlasmidPop writes `REFERENCE   2 .` which Biopython's scanner asserts on). LOW.
   - B. qualifier_escaping_read.gb (Biopython test): `/note="One missing ""quotation mark" here"` (odd quote count) makes PlasmidPop swallow the following 3 features (sig_peptide, Region, misc_feature) into the note; only warning is "Unterminated quoted value for /note"; Biopython reads all 5 features. parseGenBank.ts parseFeatureTable: FEATURE_KEY match is suppressed while a quote is open. MEDIUM (silent feature loss on unbalanced quotes).
9. Biopython site `a^b` -> SimpleLocation(a,a) == PlasmidPop siteSegment(a): consistent; `L^1` circular ok.
10. SnapGene: project's own oracle `npm run oracle:snapgene` (Biopython snapgene reader vs parseSnapGene over 203 bundled SnapGene 8.2 .dna files, sequence+topology+feature type/strand/pieces) passed: 8/8 tests, 0 differences (out/oracle_snapgene.log). Not yet: my own independent look at qualifiers/names/primers; pydna has no snapgene reader (uses Biopython).
11. reads_dump.test.ts ran (out/reads.json written: AB1 from biopy/Abi + fixtures/local/abif, FASTQ from biopy/Quality incl. example.fastq.gz via readSequenceData) — Python comparison NOT yet written/run.

## Left / next steps

- Write `compare_reads.py`: AB1 seq/phred (SeqIO 'abi': seq, letter_annotations phred_quality, abif_raw PLOC2/DATA9-12 lengths+sums, SMPL1) and FASTQ (SeqIO 'fastq' = Sanger phred+33; check how PlasmidPop handles Illumina-1.3/Solexa files — it assumes +33, so _*original_illumina/solexa will differ by design; check records count, ids/descriptions, wrapping, zero_length, tricky.fastq, dos line endings, error*_ files raise).
- Sticky-end SEGUID vs pydna: build SeqDocument with ends and compare `documentChecksum` to pydna values. Ends convention: `overhang` = top-strand bases 5'->3' over the overhang region. pydna oracle (Dseq.cut on 'AAGGAATTCGATCGCTGCAGTTGGATCCAAGGTACCTTCCCGGGAAGGTCTCAAGCTTAACC'):
  EcoRI frag2 watson AATTCGATCGCTGCAGTTGGATCCAAGGTACCTTCCCGGGAAGGTCTCAAGCTTAACC crick GGTTAAGCTTGAGACCTTCCCGGGAAGGTACCTTGGATCCAACTGCAGCGATCG ovhg -4 -> ldseguid=h_CKwptYaxYq3ICzFkeWce809zU (left 5' AATT, right blunt);
  PstI frag2 watson GTTGGATCCAAGGTACCTTCCCGGGAAGGTCTCAAGCTTAACC crick GGTTAAGCTTGAGACCTTCCCGGGAAGGTACCTTGGATCCAACTGCA ovhg 4 -> ymlSC2nkLlcJPirHwuKzCK2XRdY (left 3' overhang TGCA on bottom; top-strand terms: 'TGCA');
  EcoRI+PstI (circular cut) watson AATTCGATCGCTGCA crick GCGATCG ovhg -4 -> 2jF-S2gLRsqw7bpEbIbttHirLDI (left 5' AATT, right 3' TGCA);
  BsaI frag2 watson AGCTTAACC crick GGTTA ovhg -4 -> NplbAbkuYhsZXd8702lFnF-0fm4;
  circular whole molecule cdseguid=BUY5A9O91WrnGV3Lor6CETd-1jU.
  pydna canonical form: w = '-'_ovhg + watson + '-'_(-ovhg+len(crick)-len(watson)); c = '-'_(ovhg+len(watson)-len(crick)) + crick + '-'_(-ovhg).
- Optional: codon usage table counts vs Kazusa (kazusa_316407.html downloaded for E. coli W3110; shipped counts in src/core/analysis/codonUsageTables.ts, order TTT,TTC,TTA,TTG,TCT...; Kazusa html lists UUU etc. with counts in parentheses).
- Optional: openAsProtein.proteinFromCds / featuresOntoProtein vs stored translation (quick: add to genbank_dump).
- Then write final report via SubagentHandback (format per BRIEF.md: confirmed bugs A/B/ORF-dup/REFERENCE, suspicious, verified clean, file paths).

## Update (resumed)

- AB1 vs Biopython (8 files: biopy/Abi + fixtures/local/abif): sequence, phred qualities, PLOC peaks, DATA9-12 channels, SMPL1 all identical; fake.ab1 and test.fsa rejected with clear errors (Biopython too). CLEAN.
- FASTQ vs Biopython (18 files incl. example.fastq.gz via readSequenceData, DOS endings, wrapping, tricky, zero_length): sequences/qualities/ids identical for every Sanger file. Differences: (a) PlasmidPop uppercases bases (fastq.ts:49, deliberate; 454 lowercase adaptor marks lost) — cosmetic; (b) Illumina-1.3 (+64) and Solexa files are read as Phred+33 with NO warning (qualities 31..93) — LOW, obsolete encodings; (c) error_qual_space.fastq accepted with warning 'Quality characters below "!" read as 0' where Biopython rejects — lenient, fine; error_double_seq/error_trunc_in_qual rejected. CLEAN apart from (b).
- Sticky-end SEGUID vs pydna 5.5.16 Dseq.seguid(): 9 linear fragments (5'/3' overhangs on either end, blunt) + circular cdseguid all match (src/**audit**/translation-io/seguid_ends.test.ts, 10/10). CLEAN.
- Codon usage: shipped E. coli W3110 table (codonUsageTables.ts) = Kazusa species 316407, 64/64 counts identical (sum 1372057). CLEAN. (Other hosts not checked.)
- AUDIT COMPLETE; final report delivered via SubagentHandback.
