import { createContext } from 'react';

/**
 * Where on the Bench a reaction's product is drawn (item 49): the third
 * column, which the reaction panels reach through a portal so each keeps
 * working out its own product. Null outside the Bench, where a panel shows
 * its one-line summary alone.
 */
export const BenchProductSlot = createContext<HTMLElement | null>(null);
