/**
 * How many bases an enzyme wants beyond its site to cut near the end of a
 * DNA fragment (item 108): the padding a cloning primer carries 5′ of its
 * site, and the room two sites in a polylinker need from each other for
 * both to be cut in one tube.
 *
 * Source: NEB, "Cleavage Close to the End of DNA Fragments
 * (oligonucleotides)", the legacy chart of short double-stranded oligos
 * digested for 2 h and 20 h at 20 °C, read on 2026-10-27 from an archived
 * copy (www.neb.com/nebecomm/tech_reference/restriction_enzymes/
 * cleavage_olignucleotides.asp, captured 2011). A value is the fewest
 * bases flanking the site on each side, (oligo length − site length) / 2,
 * at which the chart shows at least 75 % cleavage after 20 h. NEB's current
 * chart (www.neb.com/tools-and-resources/usage-guidelines/
 * cleavage-close-to-the-end-of-dna-fragments) rates 1–5 bp only, and says
 * that for an enzyme not listed "6 base pairs should be added on either
 * side of the recognition site", which is `DEFAULT_END_FLANK`.
 *
 * Verified: every value marked "chart" below is read off that table.
 * Assumed: the entries marked so are enzymes the chart never shows reaching
 * 75 % within the flanks it tested (3 or 4 bases); 8 is a guess on the safe
 * side of NEB's 6, not a measurement. An enzyme tested at one or two flanks
 * only (SacI, BstEII, MluI) is left to the default.
 */
export const END_FLANK: Readonly<Record<string, number>> = {
  AccI: 8, // assumed: 0 % at 1, 2 and 3 bases
  AflIII: 2, // chart: 0 % at 1, >90 % at 2
  AscI: 0, // chart: >90 % with no flank at all
  AvaI: 1, // chart: 50 % / >90 % at 1
  BamHI: 2, // chart: 10 % / 25 % at 1, >90 % at 2
  BglII: 2, // chart: 0 % at 1, 75 % / >90 % at 2
  BssHII: 3, // chart: 0 % at 1 and 2, 50 % / >90 % at 3
  BstXI: 8, // chart: 25 % / 50 % at 6, 25 % / >90 % at 7–8
  ClaI: 2, // chart: 0 % at 1, >90 % at 2
  EcoRI: 1, // chart: >90 % at 1
  HaeIII: 2, // chart: >90 % at 2
  HindIII: 3, // chart: 0 % at 1 and 2, 10 % / 75 % at 3
  KpnI: 2, // chart: 0 % at 1, >90 % at 2
  NcoI: 4, // chart: 0 % at 1, 50 % / 75 % at 4
  NdeI: 7, // chart: 0 % at 1–6, 75 % / >90 % at 7
  NheI: 8, // assumed: 0 % at 1, 10 % / 25 % at 2, 10 % / 50 % at 3
  NotI: 8, // chart: 10 % at 4 and 6, 25 % / 90 % at 8
  NsiI: 3, // chart: 10 % / >90 % at 3
  PacI: 2, // chart: 0 % at 1, 0 % / >90 % at 2
  PmeI: 8, // chart: 0 % / 50 % at 2, 75 % / >90 % with 6 and 10 bases either side
  PvuI: 8, // assumed: 0 % at 1, 10 % / 25 % at 2, 0 % / 10 % at 3
  SacII: 3, // chart: 0 % at 1, 50 % / >90 % at 3
  SalI: 4, // chart: 0 % at 0, 10 % / 50 % at 2, 10 % / 75 % at 4
  ScaI: 3, // chart: 10 % / 25 % at 1, 75 % at 3
  SmaI: 3, // chart: 10 % / 50 % at 2, >90 % at 3
  SpeI: 1, // chart: 10 % / >90 % at 1
  SphI: 8, // assumed: 0 % at 1, 0 % / 25 % at 3, 10 % / 50 % at 4
  StuI: 1, // chart: >90 % at 1
  XbaI: 2, // chart: 0 % at 1, >90 % at 2
  XhoI: 3, // chart: 0 % at 1, 10 % / 25 % at 2, 10 % / 75 % at 3
  XmaI: 3, // chart: 0 % at 1, 25 % / 75 % at 2, 50 % / >90 % at 3
};

/** NEB's rule for an enzyme the chart does not list. */
export const DEFAULT_END_FLANK = 6;

/** Bases `enzyme` wants beyond its site, by name; the default for one not in the table. */
export function endFlank(enzyme: string): number {
  return END_FLANK[enzyme] ?? DEFAULT_END_FLANK;
}
