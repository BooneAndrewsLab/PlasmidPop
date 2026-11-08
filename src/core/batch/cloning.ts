import { getEnzyme } from '../analysis/restriction';
import {
  type FidelityTable,
  type OverlapKit,
  type SetFidelity,
  KIT_NAMES,
  KIT_OVERLAP,
  YEAST_OVERLAP,
  clampYeastOverlap,
  destinationOverhangs,
  formatFidelity,
  homologyVectorProblem,
  opensNothing,
  overhangWarnings,
  readExtraBases,
  setFidelity,
  whyNotGoldenGate,
} from '../cloning';
import { type SeqDocument } from '../document';
import { type PrimerCriteria } from '../primers/criteria';
import { type Range } from '../range';
import { type DesignRow, usedNameMessage } from './rows';

/**
 * What a cloning batch checks before it designs anything, and how a row's own
 * columns change the recipe (#360, item 141). All pure: the checks that need
 * the vector alone are made once per batch (once per distinct enzyme or kit a
 * row asks for), so a hundred rows do not repeat them and do not each say
 * the same thing.
 */

/** The recipe a batch designs every row with; a row's columns override parts of it. */
export type CloningBatchRecipe =
  | {
      readonly recipe: 'restriction';
      readonly forward: string;
      readonly reverse: string;
      /** Where on the vector the insert goes; null is its cloning site, else the whole vector. */
      readonly region?: Range | null;
      /** The insert's 5′ end goes to the higher cut, as the page's Flip. */
      readonly flipped?: boolean;
    }
  | {
      readonly recipe: 'golden-gate';
      readonly enzyme: string;
      readonly secondEnzyme?: string;
      /** The overhang pair; the destination's own when absent. */
      readonly left?: string;
      readonly right?: string;
      readonly includeStart?: boolean;
      readonly includeStop?: boolean;
    }
  | {
      readonly recipe: 'homology';
      readonly kit: OverlapKit;
      /** Bases of homology; only the yeast kit takes it. */
      readonly overlap?: number;
      readonly flipped?: boolean;
    };

/** What every recipe's designer takes beyond the recipe: the Cloning workspace's settings. */
export interface CloningBatchSettings {
  readonly padding?: number;
  readonly avoidJunctionSites?: boolean;
  readonly criteria?: Partial<PrimerCriteria>;
  /** Bases between the first primer's tail and its annealing part (restriction and Golden Gate only). */
  readonly extra5?: string;
  /** Bases after the insert, as they read on the top strand (restriction and Golden Gate only). */
  readonly extra3?: string;
}

// ------------------------------------------------------------------ kits and enzymes

const KIT_ALIASES: readonly (readonly [OverlapKit, readonly string[]])[] = [
  ['in-fusion', ['in-fusion', 'in fusion', 'infusion']],
  ['nebuilder', ['nebuilder', 'nebuilder hifi', 'hifi', 'neb', 'gibson']],
  ['yeast', ['yeast', 'yeast assembly']],
];

/** A kit as a table cell writes it: its id, its name, or an obvious short form; case aside. */
export function readKit(text: string): OverlapKit | undefined {
  const t = text.trim().toLowerCase();
  return KIT_ALIASES.find(([kit, names]) => kit === t || names.includes(t))?.[0];
}

/** The names a `kit` cell may use, for the message a bad one gets. */
const KIT_CHOICES = (Object.keys(KIT_NAMES) as OverlapKit[])
  .map((k) => `“${KIT_NAMES[k]}”`)
  .join(', ');

/** Enzyme names as a cell lists them: separated by `/`, `,`, `+`, `;` or spaces. */
function enzymeNames(text: string): string[] {
  return text
    .split(/[\s/,+;]+/)
    .map((n) => n.trim())
    .filter((n) => n !== '');
}

/** The enzyme list's own spelling of `name`, or why it is not one. */
function known(name: string): { readonly name: string } | { readonly problem: string } {
  return getEnzyme(name) ?? { problem: `${name} is not in the enzyme set.` };
}

// ------------------------------------------------------------------ a row's recipe

/** A row's recipe: the batch's with the row's columns over it, or what is wrong with them. */
export type RowRecipe =
  | {
      readonly ok: true;
      readonly recipe: CloningBatchRecipe;
      readonly settings: CloningBatchSettings;
      /** Columns the recipe has no use for; the row is told they were left alone. */
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

/**
 * The batch's recipe with a row's `enzyme`, `left`, `right`, `include_start`,
 * `include_stop` and `kit` over it, each checked against the real enzyme list
 * and kit names (packet 1 left them as text). What the columns mean depends
 * on the recipe:
 *
 * - restriction: `enzyme` is the pair, two names (`EcoRI/BamHI`), the
 *   forward primer's first; `left` and `right` are `extra5` and `extra3`;
 * - Golden Gate: `enzyme` is one name, or two when a second enzyme shares the
 *   tube; `left` and `right` are the two overhangs; `include_start` and
 *   `include_stop` as the page's;
 * - homology: `kit`.
 */
export function rowRecipe(
  row: DesignRow,
  batch: CloningBatchRecipe,
  settings: CloningBatchSettings = {},
): RowRecipe {
  const o = row.overrides;
  const ignored = (columns: readonly (readonly [string, boolean])[]): string[] =>
    columns
      .filter(([, set]) => set)
      .map(([column]) => `The ${column} column is not used by this recipe and was ignored.`);
  const fail = (message: string): RowRecipe => ({ ok: false, message });

  switch (batch.recipe) {
    case 'restriction': {
      let pair = { forward: batch.forward, reverse: batch.reverse };
      if (o.enzyme !== undefined) {
        const names = enzymeNames(o.enzyme);
        if (names.length !== 2) {
          return fail(
            `The enzyme column needs two enzymes for a restriction pair, forward first (for example EcoRI/BamHI); “${o.enzyme}” has ${names.length}.`,
          );
        }
        const [a, b] = names.map(known);
        if (a === undefined || b === undefined) return fail('The enzyme column is empty.');
        if ('problem' in a) return fail(a.problem);
        if ('problem' in b) return fail(b.problem);
        pair = { forward: a.name, reverse: b.name };
      }
      const extra5 = o.left ?? settings.extra5;
      const extra3 = o.right ?? settings.extra3;
      return {
        ok: true,
        recipe: { ...batch, ...pair },
        settings: {
          ...settings,
          ...(extra5 === undefined ? {} : { extra5 }),
          ...(extra3 === undefined ? {} : { extra3 }),
        },
        warnings: ignored([
          ['kit', o.kit !== undefined],
          ['include_start', o.includeStart !== undefined],
          ['include_stop', o.includeStop !== undefined],
        ]),
      };
    }
    case 'golden-gate': {
      let enzymes = { enzyme: batch.enzyme, secondEnzyme: batch.secondEnzyme };
      if (o.enzyme !== undefined) {
        const names = enzymeNames(o.enzyme);
        if (names.length < 1 || names.length > 2) {
          return fail(
            `The enzyme column needs one Type IIS enzyme, or two that share the tube; “${o.enzyme}” has ${names.length}.`,
          );
        }
        const resolved = names.map(known);
        for (const r of resolved) if ('problem' in r) return fail(r.problem);
        const [first, second] = resolved;
        if (first === undefined || 'problem' in first) return fail('The enzyme column is empty.');
        enzymes = {
          enzyme: first.name,
          secondEnzyme: second === undefined || 'problem' in second ? undefined : second.name,
        };
      }
      const left = o.left ?? batch.left;
      const right = o.right ?? batch.right;
      const includeStart = o.includeStart ?? batch.includeStart;
      const includeStop = o.includeStop ?? batch.includeStop;
      return {
        ok: true,
        recipe: {
          recipe: 'golden-gate',
          enzyme: enzymes.enzyme,
          ...(enzymes.secondEnzyme === undefined ? {} : { secondEnzyme: enzymes.secondEnzyme }),
          ...(left === undefined ? {} : { left }),
          ...(right === undefined ? {} : { right }),
          ...(includeStart === undefined ? {} : { includeStart }),
          ...(includeStop === undefined ? {} : { includeStop }),
        },
        settings,
        warnings: ignored([['kit', o.kit !== undefined]]),
      };
    }
    case 'homology': {
      let kit = batch.kit;
      if (o.kit !== undefined) {
        const read = readKit(o.kit);
        if (read === undefined) {
          return fail(`The kit “${o.kit}” is not one of ${KIT_CHOICES}.`);
        }
        kit = read;
      }
      // Extra bases are written on a restriction or Golden Gate oligo; a homology primer's tail is the vector's.
      const { extra5: _e5, extra3: _e3, ...rest } = settings;
      return {
        ok: true,
        recipe: { ...batch, kit },
        settings: rest,
        warnings: ignored([
          ['enzyme', o.enzyme !== undefined],
          ['left', o.left !== undefined],
          ['right', o.right !== undefined],
          ['include_start', o.includeStart !== undefined],
          ['include_stop', o.includeStop !== undefined],
        ]),
      };
    }
  }
}

// ------------------------------------------------------------------ the vector

export interface CloningVectorCheck {
  /** Why no row can be designed on this vector with this recipe; the designer's own words where it has them. */
  readonly problem: string | null;
  /** Once-per-batch warnings: the overhang pair's, for Golden Gate. */
  readonly warnings: readonly string[];
  /** Golden Gate: the pair the destination asks of a part, the same for every row. */
  readonly overhangs: { readonly left: string; readonly right: string } | null;
  /** Golden Gate with a fidelity table: how the overhang pair ligates. */
  readonly fidelity: SetFidelity | null;
}

const refused = (problem: string): CloningVectorCheck => ({
  problem,
  warnings: [],
  overhangs: null,
  fidelity: null,
});

/** What a fidelity score says that is worth saying once, in the words `overhangWarnings` uses for the rest. */
function fidelityWarnings(overhangs: readonly string[], f: SetFidelity, label: string): string[] {
  const out: string[] = [];
  for (const [a, b] of f.ambiguous) {
    out.push(`${a} and ${b} can be the same junction, so the parts at them can swap.`);
  }
  if (f.unknown.length > 0) {
    out.push(
      `${f.unknown.join(', ')} ${f.unknown.length === 1 ? 'is' : 'are'} not covered by ${label}.`,
    );
  } else if (f.ambiguous.length === 0) {
    out.push(
      `The destination's overhangs ${overhangs.join('…')} ligate with a fidelity of ${formatFidelity(f.fidelity)} (${label}).`,
    );
  }
  return out;
}

/**
 * Whether `vector` can take the recipe at all, checked once for a batch:
 *
 * - homology: the vector must be linear and hold the kit's homology, with
 *   the designer's own reason when it does not (`homologyVectorProblem`);
 * - Golden Gate: the enzyme must make parts, and open the destination
 *   (`destinationOverhangs`); the pair of overhangs it asks for is read
 *   once and is every row's, and is scored with `setFidelity` when the user
 *   has imported a table, or by `overhangWarnings` when not;
 * - restriction: the two enzymes must be in the enzyme set, and the extra
 *   bases A, C, G or T. Whether they cut the vector inside the region is
 *   each row's design to say (`vectorCuts`, `outsideRegion`).
 */
export function checkCloningVector(
  vector: SeqDocument,
  batch: CloningBatchRecipe,
  settings: CloningBatchSettings = {},
  fidelity: FidelityTable | null = null,
): CloningVectorCheck {
  switch (batch.recipe) {
    case 'homology': {
      const overlap =
        batch.kit === 'yeast'
          ? clampYeastOverlap(batch.overlap ?? YEAST_OVERLAP.default)
          : KIT_OVERLAP[batch.kit];
      const problem = homologyVectorProblem(vector, batch.kit, overlap);
      return problem === null
        ? { problem: null, warnings: [], overhangs: null, fidelity: null }
        : refused(problem);
    }
    case 'restriction': {
      for (const name of [batch.forward, batch.reverse]) {
        const enzyme = known(name);
        if ('problem' in enzyme) return refused(enzyme.problem);
      }
      const problem =
        readExtraBases(settings.extra5 ?? '', 'extra5').problem ??
        readExtraBases(settings.extra3 ?? '', 'extra3').problem;
      return problem === null
        ? { problem: null, warnings: [], overhangs: null, fidelity: null }
        : refused(problem);
    }
    case 'golden-gate': {
      const enzyme = getEnzyme(batch.enzyme);
      if (enzyme === undefined) return refused(`${batch.enzyme} is not in the enzyme set.`);
      const why = whyNotGoldenGate(enzyme);
      if (why !== null) return refused(why);
      let second;
      if (batch.secondEnzyme !== undefined && batch.secondEnzyme !== '') {
        second = getEnzyme(batch.secondEnzyme);
        if (second === undefined) return refused(`${batch.secondEnzyme} is not in the enzyme set.`);
      }
      const problem =
        readExtraBases(settings.extra5 ?? '', 'extra5').problem ??
        readExtraBases(settings.extra3 ?? '', 'extra3').problem;
      if (problem !== null) return refused(problem);
      const found = destinationOverhangs(vector, enzyme, second);
      if (found === null) return refused(opensNothing(enzyme.name, vector.name));
      const overhangs = {
        left: (batch.left ?? found.left).toUpperCase(),
        right: (batch.right ?? found.right).toUpperCase(),
      };
      const pair = [overhangs.left, overhangs.right];
      // A pair the table does not cover (another length) comes back as `unknown`, which is said.
      const score = fidelity === null ? null : setFidelity(pair, fidelity);
      const warnings =
        score !== null && fidelity !== null
          ? fidelityWarnings(pair, score, fidelity.label)
          : overhangWarnings(pair).map((w) => w.text);
      return { problem: null, warnings, overhangs, fidelity: score };
    }
  }
}

// ------------------------------------------------------------------ names

/** A row refused before any design: which one, and why. */
export interface NameClash {
  readonly index: number;
  readonly message: string;
}

/** What a name becomes in the primers' and the constructs' names: spaces turned to underscores. */
function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, '_').toLowerCase();
}

/**
 * Rows whose insert name an earlier row already took. The name shows in every
 * primer and construct (`ACT1-F-EcoRI`), and an order sheet refuses two
 * oligos of one name, so the later row is the bad one, as `validateBatch`
 * judges it: with its message for the same name, and its own for names that
 * differ only in spaces, which the primers' names do not keep apart.
 */
export function insertNameClashes(rows: readonly DesignRow[]): NameClash[] {
  const taken = new Map<string, { readonly name: string; readonly line: number }>();
  const out: NameClash[] = [];
  rows.forEach((row, index) => {
    const key = nameKey(row.name);
    const before = taken.get(key);
    if (before === undefined) {
      taken.set(key, { name: row.name, line: row.line });
      return;
    }
    out.push({
      index,
      message:
        before.name.toLowerCase() === row.name.toLowerCase()
          ? usedNameMessage(row.name, before.line)
          : `The name “${row.name}” gives the same primer names as “${before.name}” on line ${before.line}.`,
    });
  });
  return out;
}
