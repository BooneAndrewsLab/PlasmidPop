import {
  type BatchTemplate,
  type CloningBatchRecipe,
  type CloningBatchSettings,
  type CloningDesign,
  type CloningSimulation,
  type CloningVectorCheck,
  type DesignRow,
  type FidelityTable,
  type GoldenGatePartDesign,
  type GoldenGatePartSimulation,
  type OverlapKit,
  BATCH_ROW_LIMIT,
  SeqDocument,
  checkCloningVector,
  insertNameClashes,
  recordOverlapDesign,
  rowRecipe,
} from '@/core';
import {
  type CloningInsertRequest,
  type CloningRequest,
  type CloningResult,
} from '@/workers/analysisProtocol';
import { AnalysisCancelledError, type LongRequestOptions } from '@/workers/analysisClient';
import { analysisClient } from '@/workers/analysisClient';
import { type DocumentSnapshot, snapshotOf } from '@/workers/saveProtocol';

import { TM_HALF_WINDOW, findTemplate } from './primerBatch';

/**
 * A batch of cloning rows designed one after another (#360, item 141): each
 * row is one insert into the one vector, by the batch's recipe (restriction
 * ends, a Golden Gate part, or a kit's homology), and its own request to the
 * analysis worker. The shape is `primerBatch.ts`'s: a failed row goes on, a
 * cancel keeps the rows done, progress is (i+f)/n.
 *
 * What is the same for every row is checked once, before the first request:
 * whether the vector can take the recipe at all, and the overhang pair of a
 * Golden Gate destination. A vector that cannot is the batch's refusal, said
 * once in `refused`, not a hundred failed rows.
 */

/** What a designed row has, whichever recipe designed it. */
interface DesignedRow {
  readonly index: number;
  readonly line: number;
  readonly name: string;
  readonly status: 'designed';
  /** The construct, or null when the simulation could not make one (its reason is in `warnings`). */
  readonly product: SeqDocument | null;
  /** The row's own, the design's and the simulation's, in that order. */
  readonly warnings: readonly string[];
}

export type CloningBatchRow =
  | (DesignedRow & {
      readonly recipe: 'restriction';
      readonly design: Omit<CloningDesign, 'simulate'>;
      readonly simulation: CloningSimulation;
    })
  | (DesignedRow & {
      readonly recipe: 'golden-gate';
      readonly design: Omit<GoldenGatePartDesign, 'simulate'>;
      readonly simulation: GoldenGatePartSimulation;
    })
  | (DesignedRow & {
      readonly recipe: 'homology';
      readonly kit: OverlapKit;
      readonly design: Extract<CloningResult, { recipe: 'homology' }>['design'];
    })
  | {
      readonly index: number;
      readonly line: number;
      readonly name: string;
      readonly status: 'failed';
      readonly message: string;
    };

/** The one request a row needs, as `analysisClient` has it; a stand-in in tests. */
export interface CloningBatchClient {
  designCloning(cloning: CloningRequest, long: LongRequestOptions): Promise<CloningResult>;
}

export interface CloningBatchOptions {
  readonly recipe: CloningBatchRecipe;
  readonly settings?: CloningBatchSettings;
  /** What a row's `template` cell can name. */
  readonly templates: readonly BatchTemplate[];
  /** The user's imported ligation-fidelity table, which scores a Golden Gate batch's overhang pair. */
  readonly fidelity?: FidelityTable | null;
}

export interface CloningBatchHooks {
  /** Told each row as it is done, in the rows' order. */
  readonly onRow?: (row: CloningBatchRow) => void;
  /** Told the fraction of the whole batch done. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  readonly client?: CloningBatchClient;
}

export interface CloningBatchOutcome {
  readonly rows: readonly CloningBatchRow[];
  /** True when a cancel stopped it; `rows` are those done before. */
  readonly cancelled: boolean;
  /** Why the vector cannot take the recipe, when it cannot: no row was designed. */
  readonly refused: string | null;
  /** The batch-level check of the vector: the overhang pair and what it warns of, once. */
  readonly vector: CloningVectorCheck;
}

interface Base {
  readonly index: number;
  readonly line: number;
  readonly name: string;
}

/** The same recipe has the same vector check; a row asking for another enzyme or kit gets its own. */
function recipeKey(recipe: CloningBatchRecipe, settings: CloningBatchSettings): string {
  return JSON.stringify([recipe, settings.extra5 ?? '', settings.extra3 ?? '']);
}

/** The columns a cloning design has no use for, so a row that sets one is told it was left alone. */
function unusedColumns(row: DesignRow, recipe: CloningBatchRecipe): string[] {
  const o = row.overrides;
  const named: [string, boolean][] = [
    ['size', o.size !== undefined],
    ['change', o.change !== undefined],
    ['tm', recipe.recipe === 'homology' && o.tm !== undefined],
  ];
  return named
    .filter(([, set]) => set)
    .map(([column]) => `The ${column} column is not used by this recipe and was ignored.`);
}

/**
 * Designs `rows` into `vector`, in order. A row that cannot be designed (no
 * such template, an enzyme not in the set, a region the designer refuses, a
 * worker error) is a failed row and the next goes on; a cancel stops the batch
 * and keeps what was done. Throws only for more than `BATCH_ROW_LIMIT` rows.
 */
export async function runCloningBatch(
  rows: readonly DesignRow[],
  vector: SeqDocument,
  options: CloningBatchOptions,
  { onRow, onProgress, signal, client = analysisClient }: CloningBatchHooks = {},
): Promise<CloningBatchOutcome> {
  if (rows.length > BATCH_ROW_LIMIT) {
    throw new Error(
      `At most ${BATCH_ROW_LIMIT} rows are designed at once; this has ${rows.length}`,
    );
  }
  const settings = options.settings ?? {};
  const fidelity = options.fidelity ?? null;
  const checks = new Map<string, CloningVectorCheck>();
  const checkFor = (recipe: CloningBatchRecipe, rowSettings: CloningBatchSettings) => {
    const key = recipeKey(recipe, rowSettings);
    let found = checks.get(key);
    if (found === undefined) {
      found = checkCloningVector(vector, recipe, rowSettings, fidelity);
      checks.set(key, found);
    }
    return found;
  };
  const batchCheck = checkFor(options.recipe, settings);
  if (batchCheck.problem !== null) {
    return { rows: [], cancelled: false, refused: batchCheck.problem, vector: batchCheck };
  }

  const clashes = new Map(insertNameClashes(rows).map((c) => [c.index, c.message]));
  const vectorSnapshot = snapshotOf(vector);
  const snapshots = new Map<SeqDocument, DocumentSnapshot>();
  const done: CloningBatchRow[] = [];
  const n = rows.length;
  const outcome = (cancelled: boolean): CloningBatchOutcome => ({
    rows: done,
    cancelled,
    refused: null,
    vector: batchCheck,
  });
  for (let index = 0; index < n; index++) {
    if (signal?.aborted === true) return outcome(true);
    const row = rows[index];
    if (row === undefined) continue;
    const base: Base = { index, line: row.line, name: row.name };
    const long: LongRequestOptions = {
      ...(onProgress === undefined
        ? {}
        : {
            onProgress: (f: number) => {
              onProgress((index + f) / n);
            },
          }),
      ...(signal === undefined ? {} : { signal }),
    };
    let result: CloningBatchRow;
    try {
      const clash = clashes.get(index);
      result =
        clash !== undefined
          ? { ...base, status: 'failed', message: clash }
          : await designRow(row, base, options, settings, {
              client,
              long,
              checkFor,
              vector: vectorSnapshot,
              vectorDocument: vector,
              snapshots,
            });
    } catch (e: unknown) {
      if (e instanceof AnalysisCancelledError) return outcome(true);
      result = { ...base, status: 'failed', message: e instanceof Error ? e.message : String(e) };
    }
    done.push(result);
    onRow?.(result);
    onProgress?.((index + 1) / n);
  }
  return outcome(false);
}

interface Run {
  /** The vector as a document, for the lineage of a homology product. */
  readonly vectorDocument: SeqDocument;
  readonly client: CloningBatchClient;
  readonly long: LongRequestOptions;
  readonly checkFor: (r: CloningBatchRecipe, s: CloningBatchSettings) => CloningVectorCheck;
  readonly vector: DocumentSnapshot;
  readonly snapshots: Map<SeqDocument, DocumentSnapshot>;
}

/** The row's insert: its own bases, a stretch of its template, or the whole template. */
function insertOf(
  row: DesignRow,
  templates: readonly BatchTemplate[],
  run: Run,
): { readonly request: CloningInsertRequest; readonly document: SeqDocument } | string {
  const source = row.source;
  if (source.kind === 'sequence') {
    const doc = SeqDocument.create({ name: row.name, sequence: source.bases });
    return {
      document: doc,
      request: {
        name: row.name,
        template: snapshotOf(doc),
        range: { start: 0, end: source.bases.length },
        strand: 'forward',
      },
    };
  }
  const doc = row.template === null ? undefined : findTemplate(templates, row.template);
  if (doc === undefined) return `No template named “${row.template ?? ''}”.`;
  let snapshot = run.snapshots.get(doc);
  if (snapshot === undefined) {
    snapshot = snapshotOf(doc);
    run.snapshots.set(doc, snapshot);
  }
  return {
    document: doc,
    request: {
      name: row.name,
      template: snapshot,
      range: source.range,
      strand: source.kind === 'region' ? source.strand : 'forward',
    },
  };
}

/** The designers' settings from the batch's, the row's `tm` as the primer batch reads it. */
function designSettings(
  settings: CloningBatchSettings,
  tm: number | undefined,
): CloningBatchSettings {
  const { criteria, ...rest } = settings;
  const window = tm === undefined ? {} : { minTm: tm - TM_HALF_WINDOW, maxTm: tm + TM_HALF_WINDOW };
  const merged = { ...criteria, ...window };
  return {
    ...rest,
    ...(Object.keys(merged).length === 0 ? {} : { criteria: merged }),
  };
}

async function designRow(
  row: DesignRow,
  base: Base,
  options: CloningBatchOptions,
  settings: CloningBatchSettings,
  run: Run,
): Promise<CloningBatchRow> {
  const failed = (message: string): CloningBatchRow => ({ ...base, status: 'failed', message });
  const chosen = rowRecipe(row, options.recipe, settings);
  if (!chosen.ok) return failed(chosen.message);
  const check = run.checkFor(chosen.recipe, chosen.settings);
  if (check.problem !== null) return failed(check.problem);
  const made = insertOf(row, options.templates, run);
  if (typeof made === 'string') return failed(made);
  const insert = made.request;

  const given = designSettings(chosen.settings, row.overrides.tm);
  const recipe = chosen.recipe;
  let request: CloningRequest;
  switch (recipe.recipe) {
    case 'restriction':
      request = {
        recipe: 'restriction',
        vector: run.vector,
        region: recipe.region ?? null,
        insert,
        forward: recipe.forward,
        reverse: recipe.reverse,
        flipped: recipe.flipped ?? false,
        settings: given,
      };
      break;
    case 'golden-gate':
      request = {
        recipe: 'golden-gate',
        destination: run.vector,
        insert,
        settings: {
          ...given,
          enzyme: recipe.enzyme,
          secondEnzyme: recipe.secondEnzyme ?? '',
          left: check.overhangs?.left ?? '',
          right: check.overhangs?.right ?? '',
          ...(recipe.includeStart === undefined ? {} : { includeStart: recipe.includeStart }),
          ...(recipe.includeStop === undefined ? {} : { includeStop: recipe.includeStop }),
        },
      };
      break;
    case 'homology':
      request = {
        recipe: 'homology',
        vector: run.vector,
        insert,
        kit: recipe.kit,
        ...(recipe.overlap === undefined ? {} : { overlap: recipe.overlap }),
        flipped: recipe.flipped ?? false,
      };
      break;
  }

  const result = await run.client.designCloning(request, run.long);
  const own = [...row.warnings, ...chosen.warnings, ...unusedColumns(row, recipe)];
  switch (result.recipe) {
    case 'restriction': {
      const { design, simulation } = result;
      if (design.problem !== null) return failed(design.problem);
      return {
        ...base,
        status: 'designed',
        recipe: 'restriction',
        design,
        simulation,
        product: simulation.product,
        warnings: [
          ...own,
          ...simulation.warnings.map((w) => w.text),
          ...(simulation.problem === null ? [] : [simulation.problem]),
        ],
      };
    }
    case 'golden-gate': {
      const { design, simulation } = result;
      if (design.problem !== null) return failed(design.problem);
      return {
        ...base,
        status: 'designed',
        recipe: 'golden-gate',
        design,
        simulation,
        product: simulation.product,
        warnings: [
          ...own,
          ...simulation.warnings.map((w) => w.text),
          ...(simulation.problem === null ? [] : [simulation.problem]),
          ...(simulation.missing === null ? [] : [simulation.missing]),
        ],
      };
    }
    case 'homology': {
      const { design } = result;
      if (design.problem !== null) return failed(design.problem);
      return {
        ...base,
        status: 'designed',
        recipe: 'homology',
        kit: design.kit,
        design,
        product: withOverlapLineage(design, run.vectorDocument, made.document),
        warnings: [...own, ...design.warnings],
      };
    }
  }
}

/**
 * The homology circle with how it was made, by `recordOverlapDesign` (what
 * the Bench's insert-primer designer opens): the engine's product has no
 * lineage, and the batch protocol is built from it. Null when there is no
 * circle.
 */
function withOverlapLineage(
  design: Extract<CloningResult, { recipe: 'homology' }>['design'],
  vector: SeqDocument,
  template: SeqDocument,
): SeqDocument | null {
  if (design.primers === null) return design.product;
  return recordOverlapDesign(
    {
      kit: design.kit,
      forward: design.primers.forward,
      reverse: design.primers.reverse,
      amplicon: design.amplicon,
      product: design.product,
      warnings: design.warnings,
      problem: design.problem,
    },
    vector,
    template,
    design.kit,
  );
}
