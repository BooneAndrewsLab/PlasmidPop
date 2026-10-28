# 108. Restriction-cloning ends: the engine

Issue #303, stage one (engine and tests; decided 2026-10-27, built the
same day). Mockups in `303-mockups/` (open `index.html`); the page itself
is stage two, on the primer workspace's Design and Results pages (note
107). Code: `src/core/cloning/cloningEnds.ts`, `endFlanks.ts`, and
`designAnchoredPrimers` in `src/core/primers/primerDesign.ts`.

## What was asked

With a plasmid open as the vector, design the two primers that amplify an
insert (a feature or selection in another tab, or a gene fetched from NCBI
into a tab) with 5′ tails carrying two restriction sites, so that after
PCR and a digest the insert's ends match the vector cut with the same two
enzymes, in one orientation. Suggest the enzyme pairs rather than have
them picked blind; let any two be picked anyway; simulate what the oligos
make.

## Decided (maintainer, 2026-10-27)

1. **Inputs.** The vector document and a region on it; the insert's source
   document (another tab; an NCBI gene opened as a tab takes the same
   path) with a range and a strand (`CloningInsert`); Flip; optionally two
   enzymes as an override.
2. **Region when none is given** (`resolveVectorRegion`): the one feature
   named as the cloning site (`MCS`, `multiple cloning site`,
   `polylinker`) if there is exactly one; else the whole plasmid, flagged
   `source: 'whole'` so the page can say "select a region to narrow". With
   the whole plasmid the candidates are the enzymes that cut once anywhere.
3. **Pair suggestions** (`suggestEnzymePairs`): every pair of the enzymes
   with a cut inside the region, oriented for Flip (the forward primer's
   enzyme is the lower cut's, or the higher one's when flipped). A pair is
   usable when each enzyme cuts the vector exactly once, inside the region,
   unblocked by the _vector's_ dam/dcm, leaves a sticky end, is not Type
   IIS, has room to cut beside the other, gives ends that cannot ligate to
   each other (so the vector cannot close and the insert cannot go in
   backwards), and cuts the amplified insert nowhere. Usable pairs come
   first, the wider stretch between the cuts first; the rest follow with
   their reasons as `PairIssue`s. One enzyme with itself is listed and
   excluded (not directional); Type IIS and blunt ends likewise. The
   override (`evaluateEnzymePair`, any two names in primer order) judges by
   the same rules, and `designCloningEnds` then designs all the same and
   turns each reason into a warning.
4. **The insert's digest** is of the stretch the primers copy, the insert
   alone, scanned linear; the PCR product carries no methylation, so the
   source document's dam/dcm are never consulted for it. The scans arrive
   as plain cut sites (`CloningScans`): `scanForCloning` takes them from
   the analysis worker's existing `cutSites` request (two requests, no
   worker change), `scanForCloningNow` here for tests; a page that already
   holds the vector's scan passes it.
5. **Primers** are padding + site (+ for a Type IIS enzyme the spacer and
   the vector's own overhang) + an annealing part the primer designer chose
   on the insert's end (`designAnchoredPrimers`: the forward primer starts
   at the insert's first base, the reverse ends at its last, every length
   judged by the designer's criteria and penalty, pairs by its Tm
   difference and cross-dimer rules; Tm is of the annealing part alone).
   Padding is 6 nt by default, a cloning-only setting, raised silently to
   the enzyme's minimum (`endFlanks.ts`, below) and reported
   (`paddingRaised`, a `paddingRaised` warning). Padding and spacer bases
   are free: they are drawn from a seeded generator (no run of three) until
   none of the two enzymes nor any the suggestions list has a site touching
   them; after 256 draws the first stands and a `junctionSite` caution
   says so.
6. **After the design** the expected amplicon is scanned for both enzymes:
   a cut beyond the two intended that the pair's own `cutsInsert` did not
   already report is an `extraSite` warning in red, since the digest will
   cut there. A site that the vector's site and the insert's own first or
   last bases happen to spell cannot be padded away; it is reported, and
   `simulate` shows the cut. So is a Type IIS site at the insert's edge
   whose cut falls in the tail, which the insert's own linear scan drops
   (`findCutSites` keeps no cut outside a linear molecule). The
   reading-frame check, Golden Gate and blunt/sticky mixes stay out of
   scope.
7. **Results** (`designCloningResults`): the picked pair and up to five
   other usable pairs in the suggestions' rank, each a `CloningDesign`
   with both primers (segments kept apart for the page's styling: padding,
   site, spacer, annealing; the oligo itself tail in lower case, annealing
   part in upper), Tm of the annealing parts, the amplicon and its length,
   warnings with a severity, and `simulate()`. Save-both names are
   `<insert>-F-<EnzymeA>` / `<insert>-R-<EnzymeB>` (`cloningPrimerNames`).
8. **A picked pair after the insert or region changed**:
   `suggestEnzymePairs(ctx, picked)` judges it again on the new context
   and returns it as `picked`, kept, with `usable: false` and its reasons
   when it no longer holds. Nothing is dropped silently.

## How the tails are built

The primer at the lower cut runs along the vector's top strand into the
insert; the one at the higher cut along the bottom strand. For a Type IIP
enzyme (cut inside the site) the primer copies the vector's own bases at
the site — as they are at the lower cut, reverse-complemented at the
higher — rather than the table's IUPAC site, so the overhangs match
whatever bases the vector has there (AccI's `GTMKAC`) and for a
non-palindromic site on either strand. For a Type IIS enzyme the site is
written pointing into the insert whichever strand the vector's is on, then
the spacer, then the vector's overhang at that cut (reverse-complemented
for the higher cut): the ends match, and the product keeps no site at a
junction whose vector site lay in the replaced stretch (Golden Gate's
trick, with the vector's own overhang). The product of a Type IIP pair is
therefore the vector to the end of the lower site, the insert, and the
vector from the start of the higher site; of a Type IIS end, the vector to
the far side of the lower cut or from the near side of the higher one. The
property tests check both by construction, with the region, a site or a
cut across the origin.

`simulate` runs the oligos rather than describing them: `pcr` on the
insert's document (an insert on the bottom strand comes back
reverse-complemented and is turned), `digest` of the amplicon with both
enzymes (all its sites: it is unmethylated), `digest` of the vector with
the sites its host lets cut (`cuttableSites`), the backbone being the
piece that starts at the higher cut (a linear vector gives two pieces),
the insert flipped when it reads the other way, `assemblyJunctions`
checked, `ligate`. The product keeps the vector's base 0 as its own unless
it was cut out, and is named `<vector>-<insert>`. Whatever stops it is a
sentence in `problem`: an enzyme blocked by Dam, a cut inside the insert,
ends that do not match.

## Spacing and padding: the source

Both come from one table, `END_FLANK` in `endFlanks.ts`: how many bases an
enzyme wants beyond its site to cut near the end of a fragment. It is read
off NEB's "Cleavage Close to the End of DNA Fragments (oligonucleotides)"
chart — short double-stranded oligos digested for 2 h and 20 h — as the
fewest flanking bases at which at least 75 % is cut after 20 h; the
archived 2011 copy of the chart was read on 2026-10-27 (the live NEB page
refuses automated reads). NEB's current chart, which rates 1–5 bp, says to
add 6 bp on either side for an enzyme it does not list, and that is the
default. The two uses:

- **Padding**: `max(setting, END_FLANK[enzyme])`, so a 6 nt setting is
  raised to 7 for NdeI and 8 for NotI, BstXI, PmeI.
- **Spacing**: NEB's own introduction to the chart says it is for choosing
  the order of a double digest "when cleaving sites close together in a
  polylinker": once one enzyme has cut, the other's site sits beside a
  fresh end and wants its flank there. So for the lower site A and the
  higher B the stretch from A's outermost cut to B's site, and from B's
  innermost cut to A's site end, must each reach that enzyme's flank. In
  pUC19 EcoRI · SacI and SacI · KpnI are too close, KpnI · BamHI (4 bases
  each way, both want 2) is not; the override still allows a too-close pair
  with "digest with one enzyme, then the other".

Verified against the chart: AflIII 2, AscI 0, AvaI 1, BamHI 2, BglII 2,
BssHII 3, BstXI 8, ClaI 2, EcoRI 1, HaeIII 2, HindIII 3, KpnI 2, NcoI 4,
NdeI 7, NotI 8, NsiI 3, PacI 2, PmeI 8, SacII 3, SalI 4, ScaI 3, SmaI 3,
SpeI 1, StuI 1, XbaI 2, XhoI 3, XmaI 3. Assumed (the chart never shows
them reaching 75 % within the three or four flanking bases it tested; 8 is
a guess on the safe side of the 6 default): AccI, NheI, PvuI, SphI.
Enzymes the chart tested at one or two flanks only (SacI, BstEII, MluI,
PstI, whose rows disagree) take the default. The chart's own caveat holds:
hairpins in short palindromic oligos depress some rows.

## The methylation rule

The vector's host (`vector.methylation`) decides whether a site on the
vector cuts: `hostMethylationAt` marks the site, `blockedByHost` reads the
marks against the host, and a blocked site is a `methylation` issue and,
in `simulate`, a cut that does not happen. The insert's source document's
host is never read: the amplified insert is a PCR product and `pcr` makes
it `UNMETHYLATED_HOST`, so a site in the insert cuts whatever the tab it
came from says. The unit and property tests put `TCTAGATC` (XbaI under a
Dam GATC) on both sides and check both ways.

## What stage two calls

```ts
resolveVectorRegion(vector, selection | null): VectorRegion
insertSequence(insert: CloningInsert): string
scanForCloning(analysisClient, vector, insert): Promise<CloningScans>   // worker
suggestEnzymePairs(ctx: CloningContext, picked?): EnzymePairSuggestions
evaluateEnzymePair(ctx, forward, reverse): EnzymePairReport           // override
describePairIssue(issue: PairIssue): string                           // reason column
designCloningEnds(ctx, { forward, reverse }, settings?): CloningDesign
designCloningResults(ctx, picked, settings?): CloningResults          // picked + ≤5
design.simulate(): CloningSimulation                                   // Simulate / Open product
cloningPrimerNames(insert, forward, reverse)                           // Save both
```

`CloningContext` is the vector, the resolved region, the insert, Flip, the
scans and (optionally) the enzyme table. `CloningSettings` holds padding,
`avoidJunctionSites`, the plain designer's criteria and `maxAlternatives`.
Everything is synchronous and pure but `scanForCloning`; a design of one
pair on a 5 kb vector is a few milliseconds, so the page can design on
every change of the picked row.

## Tests

`cloningEnds.test.ts` (pUC19 with U49845's AXL2 CDS and its reverse-strand
CDS: suggestions and their reasons, Flip, the whole-plasmid fallback,
decision 8, the design's segments and names, the product against an
independent construction, a GenBank round trip, the region across the
origin, the override that cuts the insert, one enzyme twice, BfuAI as a
Type IIS override, padding raised for NotI, Dam on either side);
`cloningEnds.property.test.ts` (random turned vectors with a two-site
polylinker, IUPAC sites, a Type IIS site at either end pointing either
way, the methylation rule); `designAnchored.test.ts`; `endFlanks.test.ts`;
and `src/test/oracle/cloningEnds.test.ts` against Bio.Restriction's cut
positions and pydna's cut-and-loop products
(`scripts/oracle/cloningends.py`, pinned venv, committed JSON).
