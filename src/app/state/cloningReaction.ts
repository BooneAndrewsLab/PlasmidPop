/**
 * Which reaction the Cloning tab is showing.
 *
 * They are alternatives, not steps: nobody runs a Golden Gate and a Gibson on
 * the same bench at the same time. Rendering them stacked put 3,482 px of
 * panel in a 931 px column, so the tab asks which one instead.
 *
 * PCR is first because it is where a part comes from — the other three join
 * parts, and two of them join parts by homology that only a primer tail can
 * put there. It is also, with the digest above the picker, one of the two
 * things here that are about the document in front of you rather than about
 * the tube of open tabs.
 */
export type CloningReaction = 'pcr' | 'ligation' | 'golden-gate' | 'gibson';

export interface CloningReactionOption {
  readonly value: CloningReaction;
  readonly label: string;
  readonly title: string;
}

export const CLONING_REACTIONS: readonly CloningReactionOption[] = [
  {
    value: 'pcr',
    label: 'PCR',
    title: 'Amplify a stretch of this document with two primers',
  },
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
];

export function isCloningReaction(v: unknown): v is CloningReaction {
  return CLONING_REACTIONS.some((o) => o.value === v);
}
