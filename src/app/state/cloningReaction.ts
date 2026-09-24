/**
 * Which reaction the Cloning tab and the Bench are showing.
 *
 * They are alternatives, not steps: nobody runs a Golden Gate and a Gibson on
 * the same bench at the same time. Rendering them stacked put 3,482 px of
 * panel in a 931 px column, so each place asks which one instead.
 *
 * Since item 49 they are in two places. The digest, PCR and Mutate stay in
 * the sidebar's Cloning tab: they are about the document in front of you and
 * draw on its views, which share one preview channel, so one at a time. The
 * reactions that join parts from several documents are on the Bench, a tab
 * of their own.
 */
export type SidebarReaction = 'digest' | 'pcr' | 'mutagenesis';

export type BenchReaction = 'ligation' | 'golden-gate' | 'gibson' | 'gateway';

export type CloningReaction = SidebarReaction | BenchReaction;

export interface ReactionOption<R extends CloningReaction> {
  readonly value: R;
  readonly label: string;
  readonly title: string;
}

/**
 * The digest and PCR come first because they are where a part comes from —
 * the reactions on the Bench join parts, and two of them join parts by
 * homology that only a primer tail can put there.
 */
export const SIDEBAR_REACTIONS: readonly ReactionOption<SidebarReaction>[] = [
  {
    value: 'digest',
    label: 'Digest',
    title: 'Cut this document with the enzymes ticked in the Enzymes tab',
  },
  {
    value: 'pcr',
    label: 'PCR',
    title: 'Amplify a stretch of this document with two primers',
  },
  {
    value: 'mutagenesis',
    label: 'Mutate',
    title: 'Design the primers for a substitution, insertion or deletion in this document',
  },
];

export const BENCH_REACTIONS: readonly ReactionOption<BenchReaction>[] = [
  {
    value: 'ligation',
    label: 'Ligation',
    title: 'Join fragments you have collected, by their overhangs',
  },
  {
    value: 'golden-gate',
    label: 'Golden Gate',
    title: 'One Type IIS enzyme, every part in one tube',
  },
  { value: 'gibson', label: 'Gibson', title: 'No enzyme: parts that end in each other' },
  {
    value: 'gateway',
    label: 'Gateway',
    title: 'BP and LR recombination between the att sites two plasmids annotate',
  },
];

export function isSidebarReaction(v: unknown): v is SidebarReaction {
  return SIDEBAR_REACTIONS.some((o) => o.value === v);
}

export function isBenchReaction(v: unknown): v is BenchReaction {
  return BENCH_REACTIONS.some((o) => o.value === v);
}
