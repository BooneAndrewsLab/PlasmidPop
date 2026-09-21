/**
 * How often an enzyme may cut to be listed in the Enzymes tab.
 *
 * A unique cutter is what a cloner usually wants, and the tab could only ask
 * for that ("Single cutters only"). A diagnostic digest wants two — BsrGI
 * after an LR reaction, or checking a Golden Gate assembly — so the choice is
 * a small set of counts rather than a checkbox (item 30).
 */
export type CutCountFilter = 'any' | 'once' | 'twice' | 'once-or-twice' | 'up-to-three';

export interface CutCountOption {
  readonly value: CutCountFilter;
  /** What the control says, under a "Cuts" label. */
  readonly label: string;
  /** What a sentence says: "N enzymes <phrase>". */
  readonly phrase: string;
}

export const CUT_COUNT_OPTIONS: readonly CutCountOption[] = [
  { value: 'any', label: 'Any number', phrase: 'cut' },
  { value: 'once', label: 'Once', phrase: 'cut once' },
  { value: 'twice', label: 'Twice', phrase: 'cut twice' },
  { value: 'once-or-twice', label: 'Once or twice', phrase: 'cut once or twice' },
  { value: 'up-to-three', label: '3 times or fewer', phrase: 'cut 3 times or fewer' },
];

export function isCutCountFilter(v: unknown): v is CutCountFilter {
  return typeof v === 'string' && CUT_COUNT_OPTIONS.some((o) => o.value === v);
}

/** Whether an enzyme with `cuts` cut sites belongs in the list. */
export function matchesCutCount(filter: CutCountFilter, cuts: number): boolean {
  if (cuts === 0) return false; // The list is of enzymes that cut at all.
  switch (filter) {
    case 'any':
      return true;
    case 'once':
      return cuts === 1;
    case 'twice':
      return cuts === 2;
    case 'once-or-twice':
      return cuts <= 2;
    case 'up-to-three':
      return cuts <= 3;
  }
}

export function cutCountPhrase(filter: CutCountFilter): string {
  return CUT_COUNT_OPTIONS.find((o) => o.value === filter)?.phrase ?? 'cut';
}
