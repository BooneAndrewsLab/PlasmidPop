import { type GatewayReaction, type OverlapKit, GIBSON_DEFAULTS } from '@/core';

import { type BenchReaction, isBenchReaction } from './cloningReaction';

/**
 * What the Bench's reactions were left at: which one is open, which parts
 * each leaves out of its tube, the enzymes and molecules picked, and a name
 * being typed for the product (item 49). It lives in the store rather than
 * in the panels because the Bench is a tab: it goes away behind a document
 * and comes back, and what was ticked should come back with it. It is also
 * remembered across reloads with the view preferences, best effort.
 *
 * Parts are named by id, a tab's document id or a shelf part's id, so a tick
 * against something no longer open or shelved is simply never looked up.
 */
export interface BenchSettings {
  readonly reaction: BenchReaction;
  readonly ligation: {
    readonly excluded: readonly string[];
    readonly circular: boolean;
    readonly name: string;
  };
  readonly goldenGate: {
    /** Empty for the default enzyme of the set in use. */
    readonly enzyme: string;
    /** Empty for none: most reactions have one enzyme (#11). */
    readonly secondEnzyme: string;
    readonly excluded: readonly string[];
    readonly name: string;
  };
  readonly gibson: {
    readonly excluded: readonly string[];
    readonly minOverlap: number;
    readonly circular: boolean;
    readonly name: string;
  };
  /** In-Fusion / NEBuilder primer design (#63). */
  readonly overlap: {
    readonly kit: OverlapKit;
    readonly vectorId: string;
    readonly templateId: string;
    /**
     * What of the template is the insert: `''` for its tab's selection,
     * `'whole'` for all of a linear template, else a feature's id.
     */
    readonly insert: string;
  };
  readonly gateway: {
    readonly reaction: GatewayReaction;
    readonly insertId: string;
    readonly vectorId: string;
  };
}

export type BenchPanel = Exclude<keyof BenchSettings, 'reaction'>;

/** The homology lengths Gibson offers to insist on. */
export const GIBSON_OVERLAPS: readonly number[] = [12, 15, 20, 25, 30, 40];

export const DEFAULT_BENCH: BenchSettings = {
  reaction: 'ligation',
  ligation: { excluded: [], circular: true, name: '' },
  goldenGate: { enzyme: '', secondEnzyme: '', excluded: [], name: '' },
  gibson: { excluded: [], minOverlap: GIBSON_DEFAULTS.minOverlap, circular: true, name: '' },
  overlap: { kit: 'in-fusion', vectorId: '', templateId: '', insert: '' },
  gateway: { reaction: 'LR', insertId: '', vectorId: '' },
};

/** Toggles an id in a list of left-out parts. */
export function toggleExcluded(excluded: readonly string[], id: string): readonly string[] {
  return excluded.includes(id) ? excluded.filter((x) => x !== id) : [...excluded, id];
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function text(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, 200) : fallback;
}

function flag(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function ids(v: unknown): readonly string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
}

/**
 * Reads stored settings back, field by field: whatever is missing or of the
 * wrong type takes its default, so an older or hand-edited entry cannot put
 * a panel into a state it has no control for.
 */
export function normalizeBenchSettings(v: unknown): BenchSettings {
  const r = record(v);
  const d = DEFAULT_BENCH;
  const l = record(r['ligation']);
  const g = record(r['goldenGate']);
  const s = record(r['gibson']);
  const o = record(r['overlap']);
  const w = record(r['gateway']);
  const overlap = s['minOverlap'];
  return {
    reaction: isBenchReaction(r['reaction']) ? r['reaction'] : d.reaction,
    ligation: {
      excluded: ids(l['excluded']),
      circular: flag(l['circular'], d.ligation.circular),
      name: text(l['name'], ''),
    },
    goldenGate: {
      enzyme: text(g['enzyme'], ''),
      secondEnzyme: text(g['secondEnzyme'], ''),
      excluded: ids(g['excluded']),
      name: text(g['name'], ''),
    },
    gibson: {
      excluded: ids(s['excluded']),
      minOverlap:
        typeof overlap === 'number' && GIBSON_OVERLAPS.includes(overlap)
          ? overlap
          : d.gibson.minOverlap,
      circular: flag(s['circular'], d.gibson.circular),
      name: text(s['name'], ''),
    },
    overlap: {
      kit: o['kit'] === 'nebuilder' ? 'nebuilder' : 'in-fusion',
      vectorId: text(o['vectorId'], ''),
      templateId: text(o['templateId'], ''),
      insert: text(o['insert'], ''),
    },
    gateway: {
      reaction: w['reaction'] === 'BP' ? 'BP' : 'LR',
      insertId: text(w['insertId'], ''),
      vectorId: text(w['vectorId'], ''),
    },
  };
}
