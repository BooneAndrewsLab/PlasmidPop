/**
 * Which reaction the Cloning tab is showing.
 *
 * The three are alternatives, not steps: nobody runs a Golden Gate and a
 * Gibson on the same bench at the same time. Rendering all three stacked put
 * 3,482 px of panel in a 931 px column, so the tab asks which one instead.
 * The digest above the picker belongs to none of them — it is where the
 * pieces come from, and it is the only part of the tab that is about the
 * document in front of you.
 */
export type CloningReaction = 'ligation' | 'golden-gate' | 'gibson';

export interface CloningReactionOption {
  readonly value: CloningReaction;
  readonly label: string;
  readonly title: string;
}

export const CLONING_REACTIONS: readonly CloningReactionOption[] = [
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
