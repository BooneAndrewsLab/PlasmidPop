# 139. Yeast assembly: in vivo homologous recombination (#411)

**Asked:** there is no method for assembling in _S. cerevisiae_ by
homologous recombination — TAR cloning, gap repair into a linearised
vector. Gibson, In-Fusion/NEBuilder and overlap PCR already share the
end-homology engine (`gibson.ts`), and the Yeast Toolkit exists only as a
Golden Gate standard (#214). A first version: fragments joined by 30–60 bp
of homology (default ~40), a linearised vector whose ends carry it, checks
on homology length and uniqueness, a product document, a tutorial, a guide
section, this note.

## 1. A kit, not a new engine

**Decided: a fourth `HomologyKit`, not a new method kind.** The reaction the
app has to model is "which end matches which, and is that order forced",
which is exactly what `gibson()` answers, and `HomologyKit` in
`lineage.ts` already says in words that these are "the same reaction, at
different overlaps". So yeast assembly is `kit: 'yeast'` through the same
`gibson()` call, with its own defaults and its own warning pass.

What differs biologically, and what each difference costs:

- **No 5′ exonuclease chew-back.** The cell's own recombination machinery
  resects; there is no 15 bp floor set by a kit's enzyme mix, and the
  `short-part` warning ("the exonuclease may chew a piece away") is wrong
  here and must not fire.
- **No Tm.** Recombination happens at 30 °C in a nucleus, not at 50 °C in a
  tube. `GibsonJoin.tm` stays in the type (it is computed anyway) but the
  panel must not show it, and the `WEAK_TM` colouring in `GibsonPanel` has
  no meaning for this kit.
- **Repeats and mis-recombination matter much more.** A 40 bp homology that
  occurs a second time anywhere in the tube — including inside the vector,
  which is a whole plasmid here, not a trimmed end — gives a different
  circle at a decent rate. The existing repeat scan is the right scan; what
  changes is that it is the headline warning, not a footnote.
- **Both vector ends need homology.** Gap repair only works if the
  linearised vector's two ends are the two outer junctions.

**Rejected:** a separate `yeastAssembly.ts` engine. It would duplicate
`terminalOverlap`, the chain walk, the ambiguity refusal and the repeat
index — ~400 lines of the hardest-tested code in `src/core/cloning` — to
change three constants and one warning list. **Also rejected:** a checkbox
on the Gibson panel. The Bench's reactions are chosen by name; a scientist
looking for "yeast assembly" will not find it hidden under Gibson, and the
wording of every line (exonuclease, 50 °C, NEB's 5-fold excess) would have
to fork anyway.

Defaults: `minOverlap` 40, offered range 20–80, warn under 30 (the issue's
floor), warn over 80 as needless synthesis cost. `recommendedOverlap(n)`
(Gibson's "more pieces want longer overlaps") does not apply — yeast takes
many pieces at one homology length — so the `short-overlap` warning is
replaced by the flat 30 bp floor.

## 2. Inputs

Same shelf and tabs as every other Bench reaction: parts are shelf pieces
and open documents, ticked in a `PartsTube`, with `excluded` and `name` in
`benchSettings.yeast` beside `gibson`.

**The vector is named, not inferred.** A select on the panel marks one part
as the vector; the others are inserts. This is new (Gibson treats all parts
alike) and it is what gap repair needs: the checks in §3 that are about the
vector — ends carrying homology, marker and ARS/CEN presence — need to know
which part it is. With no vector chosen the panel behaves as Gibson does
and every part is an insert, which covers plain TAR.

**How the vector is linearised** is not re-modelled here. The two existing
routes already produce linear documents on the shelf: a digest with chosen
enzymes (Cloning tab → shelf), or inverse/opening PCR (`pcr`, or the
In-Fusion designer's vector handling). The panel says so in a line and
links the guide; it does not grow a cutter of its own.

**Which ends get the homology.** Both cases are supported and they are the
same case to the engine: homology already present in the parts (the shelf
pieces end in each other) is found by `terminalOverlap`; homology that is
not there yet is put on primer tails by the existing designer. Reuse
`designOverlapPrimers` (`overlapPrimers.ts`) with a longer tail by adding
`'yeast'` to `OverlapKit`/`KIT_OVERLAP` (40) and `KIT_NAMES` ("Yeast
assembly"), so the In-Fusion designer grows a third button and the Bench
panel embeds `OverlapPrimerDesign` exactly as `GibsonPanel` does.

## 3. Checks and warnings

A `yeastWarnings` pass beside `gibsonWarnings`, reusing its seed-indexed
repeat scan (factor the scan out; the warning text differs, the search does
not):

- **`short-overlap`** — a junction under 30 bp: "recombination falls off
  sharply below 30 bp".
- **`long-overlap`** — over 80 bp: no benefit, and longer oligos.
- **`repeat`** — the junction homology found anywhere else on either
  strand, in any part _including the vector's interior_; reported with the
  part and position, as Gibson reports it, worded as mis-recombination
  rather than mis-annealing.
- **`internal-repeat`** — a repeat of ≥ 30 bp _within_ a single part, or
  shared between two parts away from their junctions (direct repeats are
  what pop out as a deletion in yeast). Same index, different query set.
- **`gc`** — junction GC below 30% or above 70%.
- **`linear-product`** — the product is linear: a linear molecule without a
  telomere is lost, so say it plainly when `circular` is off.
- **`no-marker`** — no selectable marker found in the product's features
  (`URA3`, `LEU2`, `HIS3`, `TRP1`, `MET15`, `LYS2`, `KanMX`/`G418`), and
- **`no-origin`** — no `ARS`, `CEN` or 2-micron feature in the product.

The last two read features the product already carries. Detect features
knows these parts (item 59: `CEN6`, `ARSH4`, `URA3`, `LEU2`, `TRP1`, the
2-micron inverted repeat and `REP1`/`REP2`, `CYC1`/`ADH1` terminators), so
the check is a name/type match over `product.features`, not a new scan, and
the warning says "Detect features on the product first" when the product
has no features at all.

**E. coli shuttle: one line, no logic.** If the product has a yeast marker
and origin but no bacterial ori or resistance, one remark — "no bacterial
origin or resistance: the assembly can be recovered from yeast but not
propagated in _E. coli_". A shuttle-vector model is out of scope.

## 4. Output

The product is `GibsonAssembly.product` as today: one document, features
carried from the parts, circular by default, opened by `BenchProduct`
through the existing slot. Two additions:

- **Junction features.** The engine annotates each junction as a
  `misc_feature` named `homology 1`…`n` over the shared bases, with a note
  naming the two parts. Gibson does not do this; here the junction is the
  thing a user checks by eye on the map, and the repeat warnings point at
  it. Provenance marks them as app-made (item 73), so a round-trip keeps
  them and Detect features does not fight them.
- **Lineage.** `recordGibson(assembly, { kit: 'yeast', circular, overlap })`
  — no new `op`, no migration, and `describe.ts` grows one case so "made
  from" reads "assembled in yeast by homologous recombination".

Primers, when the designer was used, go to My primers by the existing
path, named `<part>-YA-F` / `-R`.

## 5. UI and wording

A seventh `BenchReaction`, `'yeast'`, after `gateway` in `BENCH_REACTIONS`:
label **Yeast assembly**, title "Join parts in _S. cerevisiae_ by
homologous recombination (TAR, gap repair)". `Bench.HEADINGS` gets
`yeast: ['Yeast assembly', 'in vivo, by homology']`. A `YeastAssemblyPanel`
modelled line for line on `GibsonPanel`: parts tube, vector select, an
overlap number input (20–80, default 40), a circular toggle, the ordered
part list, a junction list showing **bp and GC, never Tm**, and
`AssemblyWarnings`. Analytics gains `'yeast'` and `'yeast-oligos'` beside
`'soe'`/`'soe-oligos'`.

**Restyled (#414).** The designer in the Yeast and Gibson panels was a 12 px
grey `gg__left-out` footnote; it is now a `panel__details` card (as the PCR
Options) with the note "puts 40 bases of the vector's ends on an insert that
has no homology yet". Placement (note 133 R4), the summary strings and the
closed default are unchanged. After a "Nothing follows" error the Yeast panel
adds one quiet line pointing at it; "Nothing to assemble" gets none, since the
designer refuses a circular vector too.

## 6. Tutorial

`docs/tutorials/yeast-assembly.md`, sample files `YA-*` in
`docs/tutorials/files/`, all synthetic:

- `YA-Vector.gb` — circular ~2.2 kb yeast/E. coli shuttle: `URA3`, `CEN6`,
  `ARSH4`, `ori`, `AmpR`, one unique blunt cutter in the MCS.
- `YA-Insert1.gb`, `YA-Insert2.gb` — linear, meeting in 40 bp of homology
  and carrying 40 bp of the cut vector's ends.
- `YA-repeat-Insert2.gb` — `YA-Insert2` with its junction homology repeated
  once inside it, so the repeat warning fires and the exercise has a wrong
  answer to look at.
- `YA-gene.gb` — a plain ORF with no tails, for the primer-design exercise.

Exercises: cut the vector; assemble the three parts; read the junction list;
swap in the repeat file and read the warning; design tails for `YA-gene`.
Numbers pinned by `src/core/cloning/yeastTutorial.test.ts`, the shape of
`gibsonTutorial.test.ts`: the files parse, round-trip, say "synthetic", have
the stated lengths, their ends match at the stated lengths, and the assembly
gives the stated product length, feature names and warning kinds. A jsdom
`YeastTutorial.test.tsx` only if a number on the page comes from the panel
rather than the engine.

## 7. Tests and docs

- Core: `yeastAssembly.test.ts` (defaults, vector role, each warning kind,
  the marker/origin reads, the junction features), a property test for the
  repeat scan beside `gibson.property.test.ts`, and an oracle check of one
  assembly against pydna in the `primer3` conda env, written into the test
  as a committed expected sequence (no network, as elsewhere).
- UI: `YeastAssemblyPanel.test.tsx`, and the Bench reaction round-trip in
  `benchSettings`/`viewPrefs.test.ts`.
- Docs: `docs/guide/12-cloning.md` gains a **Yeast assembly** section after
  Gateway (and the Bench overview line lists seven reactions);
  `docs/guide/README.md` and `src/app/help/guide.ts` need no new page.
  `docs/tutorials/README.md`, `TUTORIAL_SECTIONS` in `staticTutorials.ts`
  (Cloning, after `gateway`) and `docs/tutorials/sample-files.md` gain the
  new page and the five `YA-*` rows.

## 8. Implementation plan

Three steps, each one Sonnet agent, in order:

1. **Engine + tests.** Factor the repeat scan out of `gibsonWarnings`; add
   `yeastAssembly.ts` (a thin `gibson()` wrapper: defaults, vector role,
   `yeastWarnings`, junction features), `'yeast'` in `OverlapKit`,
   `KIT_OVERLAP`, `KIT_NAMES` and `HomologyKit`, the `describe.ts` case.
   Files: `src/core/cloning/{gibson,yeastAssembly,overlapPrimers,index}.ts`,
   `src/core/lineage/{lineage,describe}.ts`, plus the tests in §7.
2. **UI.** `YeastAssemblyPanel.tsx`, the `'yeast'` entries in
   `cloningReaction.ts`, `Bench.tsx`, `benchSettings.ts`, `analytics.ts`,
   and the panel test.
3. **Tutorial + docs.** The five `YA-*` files, `yeast-assembly.md`,
   `yeastTutorial.test.ts`, and the doc edits in §7.

Each step is a branch off main, merged before the next starts; step 1 must
leave `gibson` behaviour byte-identical (its existing tests are the check).
