# PlasmidPop tutorials

Hands-on, step-by-step exercises in PlasmidPop, in three sections: **Cloning** (eleven methods, from a plain digest to Gateway and mutagenesis), **Analysis** (restriction enzymes, aligning sequences, and CRISPR guides) and a short **Reference** list. Each tutorial is one page with numbered steps, the numbers to expect, and sample files you can download ([all files](sample-files.md)). Every file is a **synthetic example**, and every number is checked by a test that runs the same files through the functions the app uses, so the pages cannot drift from the app. They are also published as plain web pages, readable without JavaScript, at `/tutorials/` on the PlasmidPop site.

New to the Bench or to the sample files? Read [Before you start](before-you-start.md) first (five minutes).

## Cloning

Suggested order: [Digest and PCR basics](digest-pcr.md), then [Ligation](ligation.md), then [Golden Gate](golden-gate.md) before [Modular cloning](modular.md), and [Gibson](gibson.md) before [In-Fusion](in-fusion.md) and [Overlap-extension PCR](overlap-pcr.md); [Yeast assembly](yeast-assembly.md) after [Gibson](gibson.md) and [In-Fusion](in-fusion.md); [Gateway](gateway.md) and [Site-directed mutagenesis](mutagenesis.md) stand alone.

| Method                     | Level        | Minutes | You end with                                                                              | Page                                                                  |
| -------------------------- | ------------ | ------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Digest and PCR basics      | Beginner     | 30      | fragments read from a digest, and a PCR product with EcoRI and BamHI sites cut            | [Digest and PCR basics](digest-pcr.md)                                |
| Ligation                   | Beginner     | 30      | a vector and an insert joined with EcoRI and BamHI, then the same with insulin from NCBI  | [Ligation: vector and insert](ligation.md)                            |
| Golden Gate                | Beginner     | 20      | one gene in a BsaI expression vector, a synthetic ORF and insulin from NCBI               | [One gene into one vector](golden-gate.md)                            |
| Golden Gate, several parts | Intermediate | 30      | promoter, coding part, tag and terminator in one tube, then three broken designs          | [Four parts and the warnings](golden-gate-parts.md)                   |
| Modular cloning (MoClo)    | Intermediate | 25      | a level-1 construct from three parts, then four constructs from one plan                  | [MoClo plant standard](modular.md)                                    |
| Gibson                     | Intermediate | 20      | a 2,379 bp circle from a vector and two inserts                                           | [Gibson: a vector and two inserts](gibson.md)                         |
| In-Fusion and NEBuilder    | Intermediate | 20      | one gene in an EcoRV-cut vector, with designed primer tails                               | [In-Fusion and NEBuilder: one gene into a vector](in-fusion.md)       |
| Overlap-extension PCR      | Intermediate | 20      | a 769 bp fusion of a promoter, a gene and a tag                                           | [Overlap-extension PCR: a promoter, a gene and a tag](overlap-pcr.md) |
| Gateway                    | Intermediate | 25      | a 1,412 bp entry clone, then a 1,551 bp expression clone                                  | [Gateway: a BP reaction, then an LR reaction](gateway.md)             |
| Yeast assembly             | Intermediate | 30      | a 2,797 bp circle joined in the cell, three designs with warnings, and 40 bp tail primers | [Yeast assembly: a vector and two inserts](yeast-assembly.md)         |
| Site-directed mutagenesis  | Beginner     | 25      | a point mutation, a tag, a deletion and a silent EcoRV site                               | [Site-directed mutagenesis](mutagenesis.md)                           |

## Analysis

Each stands alone; [Enzymes](enzymes.md) is the shortest.

| Method  | Level        | Minutes | You end with                                                                               | Page                                                                 |
| ------- | ------------ | ------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Enzymes | Beginner     | 20      | the enzymes that cut once, a 390 + 210 bp double digest, and a site blocked by Dam/Dcm     | [Enzymes: cut once, a double digest, and methylation](enzymes.md)    |
| Align   | Beginner     | 25      | a read checked against a plasmid, four clones and four proteins aligned, a range copied    | [Align: a read, four clones, proteins and a copied range](align.md)  |
| CRISPR  | Intermediate | 25      | a guide picked and ordered, guides saved as features, a 40 nt 5′ nickase pair, two pegRNAs | [CRISPR: pick a guide, features, nickases, prime editing](crispr.md) |

## Reference

- [Before you start](before-you-start.md): opening the files, enzyme ticks, what the Bench is, and what to do if a number does not match.
- [Sample files](sample-files.md): every file, what it is, and a plain download.
- The [user guide](../guide/README.md), and [Simulated cloning](../guide/12-cloning.md) in particular.
