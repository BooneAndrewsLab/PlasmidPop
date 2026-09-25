import { type SidebarTab } from '../state/editorStore';

/**
 * A line drawing for each sidebar tab, above its label on the rail (#35).
 * Drawn here rather than taken from an icon set: eight 16-unit glyphs are
 * less than a dependency, and nobody else's licence comes with them. They
 * are for recognising a tab at a glance and on a rail too short for every
 * label; the word stays, since a pictogram of "ORFs" is a guess.
 */
const PATHS: Readonly<Record<SidebarTab, string>> = {
  // An annotation arrow on a line of sequence.
  features: 'M1.5 12.5h13M3 6h7.5l2.5 2.5-2.5 2.5H3z',
  // A chain of residues, beads on a string.
  protein:
    'M3 8a1.5 1.5 0 1 0 0 .01M8 5a1.5 1.5 0 1 0 0 .01M13 8a1.5 1.5 0 1 0 0 .01M4.3 7.2 6.7 5.8M9.3 5.8l2.4 1.4M8 12.5a1.5 1.5 0 1 0 0 .01M12 9.2 9.2 11.6',
  // A frame open from start to stop.
  orfs: 'M2 8h10M9 5l3 3-3 3M2 5v6',
  // Codons over the letters they make.
  translate: 'M2 4h3M6.5 4h3M11 4h3M3.5 13 5 8.5 6.5 13M4 11.5h2M10 8.5v4.5h2.5',
  // A primer, and the strand it anneals to.
  primers: 'M1.5 11h13M3 7.5h6.5M7.5 5.5l2 2-2 2',
  // Scissors.
  enzymes: 'M4 4.5a2 2 0 1 0 0 .01M4 11.5a2 2 0 1 0 0 .01M5.6 5.6 14 12M5.6 10.4 14 4',
  // Two pieces joining.
  cloning: 'M1.5 8h5v3h-5zM9.5 5h5v3h-5zM6.5 9.5h1.5V6.5h1.5',
  // Two sequences, lined up.
  align: 'M2 5h12M2 11h5M9 11h5M7.5 7v2.5',
  // A clock, going back.
  history: 'M8 2.5a5.5 5.5 0 1 1-5.2 3.7M2.5 3v3.3h3.3M8 5v3l2 1.5',
};

export function SidebarIcon({ tab }: { readonly tab: SidebarTab }) {
  return (
    <svg className="sidebar__tab-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[tab]} />
    </svg>
  );
}
