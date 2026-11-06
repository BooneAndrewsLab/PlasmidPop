import {
  type CutSite,
  type Enzyme,
  type EnzymeSites,
  type SeqDocument,
  cutLabel,
  formatInt,
  getEnzyme,
  isDoubleCutter,
  isHostMethylationSensitive,
  overhangKind,
} from '@/core';

import { editorStore } from '../state/editorStore';

/** What a row of the Enzymes list says and does, for the slim panel's rows and the enzyme table's (item 133). */

/**
 * Cut positions listed in one row before the rest become a count. An imported
 * REBASE table has four-base cutters that hit a plasmid a hundred times, and
 * a hundred numbers in a row is not a list anyone reads.
 */
export const MAX_SITES_SHOWN = 12;

/** The first `cap` sites of an enzyme, made one by one rather than all of them (#281). */
export function firstSites(
  site: EnzymeSites['site'],
  count: number,
  cap = MAX_SITES_SHOWN,
): CutSite[] {
  const out: CutSite[] = [];
  for (let i = 0; i < Math.min(count, cap); i++) {
    const s = site(i);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/** How many of a row's sites carry a Dam or Dcm mark. */
export function countMarked(marks: Iterable<number>): number {
  let n = 0;
  for (const bits of marks) if (bits !== 0) n++;
  return n;
}

/**
 * How long a list "Show listed" will tick in one go. Ticking every enzyme of
 * an imported REBASE table is around 1,400 of them and 63,000 cut sites to
 * label, which no view can draw; past this the button asks for a narrower
 * list instead of taking the page down.
 */
export const MAX_SHOW_LISTED = 200;

export function describeSite(site: CutSite, doc: SeqDocument): string {
  return formatInt(cutLabel(site.cut, doc.length, doc.topology));
}

/**
 * What is known of an enzyme besides its site: the overhang, and whatever an
 * import added. The tooltip on a site keeps the first few isoschizomers and
 * the suppliers' codes; the enzyme table's detail pane names them all, and
 * the suppliers when it knows them.
 */
export function enzymeFacts(
  enzyme: Enzyme,
  isoschizomers = 8,
  suppliers?: readonly { readonly code: string; readonly name: string }[],
): string[] {
  const lines = [`${overhangKind(enzyme)} overhang`];
  if (isDoubleCutter(enzyme)) {
    lines.push(
      'Cuts on both sides of its site, so each site is two cuts and leaves on a short piece',
    );
  }
  if (enzyme.suppliers !== undefined && enzyme.suppliers.length > 0) {
    lines.push(
      suppliers === undefined
        ? `Suppliers: ${enzyme.suppliers.join('')}`
        : `Sold by ${enzyme.suppliers.map((c) => suppliers.find((s) => s.code === c)?.name ?? c).join(', ')}`,
    );
  }
  if (enzyme.methylation !== undefined) {
    lines.push(`Methylated by its own MTase at ${enzyme.methylation}`);
  }
  if (isHostMethylationSensitive(enzyme.name)) {
    lines.push(
      'Blocked or impaired by Dam or Dcm methylation where it overlaps the site (NEB); marked sites are those',
    );
  }
  const iso = enzyme.isoschizomers ?? [];
  if (iso.length > 0) {
    lines.push(
      `Isoschizomers: ${iso.slice(0, isoschizomers).join(', ')}${iso.length > isoschizomers ? ', …' : ''}`,
    );
  }
  return lines;
}

/** Tooltip for an enzyme. */
export function describeEnzyme(enzyme: Enzyme): string {
  return enzymeFacts(enzyme).join('\n');
}

/** "BstI, AliI and 3 more", a row's other names. */
export function describeOthers(shown: Enzyme, members: readonly Enzyme[]): string {
  const others = members.filter((e) => e !== shown).map((e) => e.name);
  const named = others.slice(0, 8);
  const rest = others.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  return named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`
    : named.join('');
}

/** Selects the recognition site of a cut site in the views, and scrolls to it. */
export function selectCutSite(site: CutSite): void {
  const enzyme = getEnzyme(site.enzyme);
  const len = enzyme?.site.length ?? 1;
  editorStore.setSelection({ start: site.siteStart, end: site.siteStart + len });
  editorStore.revealPosition(site.siteStart);
}

/**
 * Ticks or unticks a row. Unticking takes the whole group, or an
 * isoschizomer ticked earlier would keep it ticked.
 */
export function tickRow(
  enzyme: Enzyme,
  members: readonly Enzyme[],
  shownEnzymes: ReadonlySet<string>,
  on: boolean,
): void {
  if (on) {
    editorStore.setEnzymeShown(enzyme.name, true);
    return;
  }
  const names = new Set(members.map((m) => m.name));
  editorStore.setShownEnzymes([...shownEnzymes].filter((name) => !names.has(name)));
}
