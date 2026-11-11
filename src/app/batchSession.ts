import {
  type BatchTemplate,
  type CloningBatchRecipe,
  type CloningBatchSettings,
  type CloningVectorCheck,
  type DesignOptions,
  type DesignRow,
  type FidelityTable,
  type OverlapKit,
  type PrimerCriteria,
  type SeqDocument,
  BATCH_ROW_LIMIT,
  YEAST_OVERLAP,
} from '@/core';

import { batchLanes, batchPool } from '@/workers/analysisPool';

import { analytics } from './analytics';
import { type BatchSortKey, DEFAULT_BATCH_SORT } from './batchResults';
import { type SortState } from './components/tableKeys';
import { type CloningBatchRow, runCloningBatch } from './cloningBatch';
import { type PrimerBatchRow, runPrimerBatch } from './primerBatch';
import { createDocumentSession } from './state/documentSession';

/*
 * What the Batch page holds, per document (#358, item 141): the table as
 * typed, the template picked, the records loaded, and the run with its rows.
 * In a store outside React for the reason `alignSession.ts` is: the run is a
 * chain of worker requests that goes on while the page is not on screen, and
 * its rows have to land somewhere a React setter of an unmounted page cannot
 * put them. In-process only: nothing here is written to disk, so a reload
 * starts clean and no sequence leaves the page.
 */

/** A batch run: the rows as they come in, and what it was asked. */
export interface BatchRun {
  readonly rows: readonly PrimerBatchRow[];
  /** The rows asked for, by the index a result row carries. */
  readonly source: readonly DesignRow[];
  /** The templates it saw, for the preview and the note on saved primers. */
  readonly templates: readonly BatchTemplate[];
  readonly running: boolean;
  /** The fraction of the batch done. */
  readonly progress: number;
  /** A cancel stopped it; `rows` are those done before. */
  readonly cancelled: boolean;
  /** The document in front when it started: a preview is drawn only while it is unchanged. */
  readonly ranOn: SeqDocument | null;
  /** The template the rows defaulted to, for the note on saved primers. */
  readonly templateName: string;
  /** The Settings' criteria it designed with, for the caption over the results (#428). */
  readonly criteria?: DesignOptions;
}

/** What the page designs: primer pairs and mutagenesis, or one of the cloning recipes (#360). */
export type BatchMethod = 'primers' | CloningBatchRecipe['recipe'];

/** A cloning run: the rows as they come in, and the vector and recipe they were designed with. */
export interface CloningRun {
  readonly rows: readonly CloningBatchRow[];
  readonly source: readonly DesignRow[];
  readonly recipe: CloningBatchRecipe['recipe'];
  /** The whole recipe it ran with (enzymes or kit), for the caption over the results (#427). */
  readonly ran: CloningBatchRecipe;
  /** The primer criteria it ran with, for the same caption (#428). */
  readonly criteria?: Partial<PrimerCriteria>;
  /** The vector's name and the document the rows were designed on. */
  readonly vectorName: string;
  readonly vector: SeqDocument;
  readonly running: boolean;
  readonly progress: number;
  readonly cancelled: boolean;
  /** Why the vector cannot take the recipe: no row was designed, and it is said once. */
  readonly refused: string | null;
  /** The once-per-batch check of the vector: the overhang pair and what it warns of. */
  readonly vectorCheck: CloningVectorCheck | null;
}

export interface BatchSession {
  /** What the page designs; the Cloning tab's door sets a cloning recipe. */
  readonly method: BatchMethod;
  /** The vector of a cloning batch, by template name; null is the document in front. */
  readonly vector: string | null;
  /** Restriction: the 5′ and 3′ enzymes, as typed. */
  readonly forwardEnzyme: string;
  readonly reverseEnzyme: string;
  /** Golden Gate: the enzyme, as typed. */
  readonly goldenGateEnzyme: string;
  /** Homology: the kit, and the yeast kit's bases of overlap. */
  readonly kit: OverlapKit;
  readonly overlap: number;
  readonly cloning: CloningRun | null;
  /** The rows as text, which the paste, a file and the scan helper fill and the user edits. */
  readonly text: string;
  /** True when the scan helper wrote the text and nothing replaced it since. */
  readonly generated: boolean;
  /** What the last paste, file or scan said, and what went wrong with a file. */
  readonly note: string | null;
  readonly error: string | null;
  /** The template a row without one uses; null is the document in front. */
  readonly template: string | null;
  /** Records loaded from files as templates, beside the open tabs. */
  readonly loaded: readonly BatchTemplate[];
  readonly run: BatchRun | null;
  readonly selected: number | null;
  readonly sort: SortState<BatchSortKey>;
  /** What the last save or open said. */
  readonly said: string | null;
}

/** The recipe the page's settings ask for now; null for primer pairs. */
export function sessionRecipe(
  s: Pick<
    BatchSession,
    'method' | 'forwardEnzyme' | 'reverseEnzyme' | 'goldenGateEnzyme' | 'kit' | 'overlap'
  >,
): CloningBatchRecipe | null {
  if (s.method === 'restriction') {
    return {
      recipe: 'restriction',
      forward: s.forwardEnzyme.trim(),
      reverse: s.reverseEnzyme.trim(),
    };
  }
  if (s.method === 'golden-gate') return { recipe: 'golden-gate', enzyme: s.goldenGateEnzyme };
  if (s.method === 'homology') {
    return {
      recipe: 'homology',
      kit: s.kit,
      ...(s.kit === 'yeast' ? { overlap: s.overlap } : {}),
    };
  }
  return null;
}

export const EMPTY_BATCH_SESSION: BatchSession = {
  method: 'primers',
  vector: null,
  forwardEnzyme: 'EcoRI',
  reverseEnzyme: 'BamHI',
  goldenGateEnzyme: 'BsaI',
  kit: 'in-fusion',
  overlap: YEAST_OVERLAP.default,
  cloning: null,
  text: '',
  generated: false,
  note: null,
  error: null,
  template: null,
  loaded: [],
  run: null,
  selected: null,
  sort: DEFAULT_BATCH_SORT,
  said: null,
};

export const batchSession = createDocumentSession<BatchSession>(EMPTY_BATCH_SESSION);

/**
 * Open tabs, then loaded records, as templates by name. A name is offered
 * once, the first taking it (the document in front is first), without regard
 * to case as a row's template cell is read; the names left out are returned
 * so the page can say so.
 */
export function batchTemplates(
  front: SeqDocument,
  others: readonly SeqDocument[],
  loaded: readonly BatchTemplate[],
): { readonly templates: BatchTemplate[]; readonly dropped: string[] } {
  const templates: BatchTemplate[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const offer = (t: BatchTemplate): void => {
    const key = t.name.toLowerCase();
    if (seen.has(key)) dropped.push(t.name);
    else {
      seen.add(key);
      templates.push(t);
    }
  };
  offer({ name: front.name, document: front });
  for (const d of others) if (d.alphabet === front.alphabet) offer({ name: d.name, document: d });
  for (const t of loaded) offer(t);
  return { templates, dropped };
}

/**
 * What the usage statistics call the run: `scan` for rows the scan helper
 * made, `recipe` for a table with a change column (mutagenesis), else
 * `region`; a cloning batch is named by its recipe (`restriction`,
 * `golden-gate`, `homology`). Never the rows, names or sizes.
 */
export function batchCase(
  rows: readonly DesignRow[],
  generated: boolean,
  method: BatchMethod = 'primers',
): string {
  if (method !== 'primers') return method;
  if (generated) return 'scan';
  return rows.some((r) => r.overrides.change !== undefined) ? 'recipe' : 'region';
}

const running = new Map<string, AbortController>();
/** Runs whose input changed under them: their rows are discarded, not kept (#429). */
const discarded = new WeakSet<AbortController>();

function key(documentId: string | null): string {
  return documentId ?? '';
}

export interface StartBatch {
  readonly rows: readonly DesignRow[];
  readonly templates: readonly BatchTemplate[];
  readonly front: SeqDocument;
  readonly templateName: string;
  readonly generated: boolean;
  /** The Settings' criteria, which the Design page designs with. */
  readonly criteria?: DesignOptions;
}

/** Runs the rows, writing each result to the document's session as it lands. */
export async function startBatch(documentId: string | null, a: StartBatch): Promise<void> {
  if (running.has(key(documentId)) || a.rows.length === 0) return;
  if (a.rows.length > BATCH_ROW_LIMIT) return;
  const controller = new AbortController();
  running.set(key(documentId), controller);
  analytics.track('primers', 'batch', batchCase(a.rows, a.generated));
  const base = {
    rows: [],
    source: a.rows,
    templates: a.templates,
    running: true,
    progress: 0,
    cancelled: false,
    ranOn: a.front,
    templateName: a.templateName,
    ...(a.criteria === undefined ? {} : { criteria: a.criteria }),
  } satisfies BatchRun;
  batchSession.update(documentId, { run: base, selected: null, said: null });
  const patch = (p: Partial<BatchRun>): void => {
    if (discarded.has(controller)) return;
    batchSession.update(documentId, (s) => (s.run === null ? {} : { run: { ...s.run, ...p } }));
  };
  try {
    const outcome = await runPrimerBatch(
      a.rows,
      a.templates,
      a.criteria === undefined ? {} : { criteria: a.criteria },
      {
        signal: controller.signal,
        clients: batchLanes(),
        onRow: (row) => {
          if (discarded.has(controller)) return;
          batchSession.update(documentId, (s) =>
            s.run === null ? {} : { run: { ...s.run, rows: [...s.run.rows, row] } },
          );
        },
        onProgress: (progress) => {
          patch({ progress });
        },
      },
    );
    patch({ running: false, cancelled: outcome.cancelled });
  } catch (e: unknown) {
    patch({ running: false });
    if (!discarded.has(controller)) {
      batchSession.update(documentId, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } finally {
    if (running.get(key(documentId)) === controller) running.delete(key(documentId));
    if (running.size === 0) batchPool.release();
  }
}

/** The session fields a run is made from: when one of them changes, the results no longer belong to the page (#429). */
const RUN_INPUTS = [
  'text',
  'method',
  'template',
  'vector',
  'forwardEnzyme',
  'reverseEnzyme',
  'goldenGateEnzyme',
  'kit',
  'overlap',
] as const satisfies readonly (keyof BatchSession)[];

/**
 * Drops both runs' results, and cancels the one in progress without keeping
 * its rows. The run's slot is freed at once so Design can start again, and
 * its late rows are ignored (`discarded`).
 */
export function clearBatchResults(documentId: string | null): void {
  const controller = running.get(key(documentId));
  if (controller !== undefined) {
    discarded.add(controller);
    controller.abort();
    running.delete(key(documentId));
  }
  batchSession.update(documentId, { run: null, cloning: null, selected: null, said: null });
}

/**
 * The page's one way to write the session: a patch that changes any of the
 * run's inputs (the rows, method, template, vector, enzymes, kit or overlap)
 * clears the results with it, so what is shown always is what the page holds.
 * A patch that sets a field to the value it has changes nothing.
 */
export function changeBatchInputs(
  documentId: string | null,
  patch: Partial<BatchSession> | ((s: BatchSession) => Partial<BatchSession>),
): void {
  const current = batchSession.read(documentId);
  const p = typeof patch === 'function' ? patch(current) : patch;
  if (RUN_INPUTS.some((k) => k in p && p[k] !== current[k])) clearBatchResults(documentId);
  batchSession.update(documentId, p);
}

/** Stops the run of this document, keeping the rows done. */
export function cancelBatch(documentId: string | null): void {
  running.get(key(documentId))?.abort();
}

export interface StartCloningBatch {
  readonly rows: readonly DesignRow[];
  readonly templates: readonly BatchTemplate[];
  readonly vector: SeqDocument;
  readonly recipe: CloningBatchRecipe;
  /** The Settings' criteria, as the Cloning page designs with. */
  readonly settings?: CloningBatchSettings;
  readonly fidelity?: FidelityTable | null;
}

/** Runs a cloning batch, writing each row to the document's session as it lands. */
export async function startCloningBatch(
  documentId: string | null,
  a: StartCloningBatch,
): Promise<void> {
  if (running.has(key(documentId)) || a.rows.length === 0) return;
  if (a.rows.length > BATCH_ROW_LIMIT) return;
  const controller = new AbortController();
  running.set(key(documentId), controller);
  analytics.track('primers', 'batch', batchCase(a.rows, false, a.recipe.recipe));
  const base = {
    rows: [],
    source: a.rows,
    recipe: a.recipe.recipe,
    ran: a.recipe,
    ...(a.settings?.criteria === undefined ? {} : { criteria: a.settings.criteria }),
    vectorName: a.vector.name,
    vector: a.vector,
    running: true,
    progress: 0,
    cancelled: false,
    refused: null,
    vectorCheck: null,
  } satisfies CloningRun;
  batchSession.update(documentId, { cloning: base, selected: null, said: null });
  const patch = (p: Partial<CloningRun>): void => {
    if (discarded.has(controller)) return;
    batchSession.update(documentId, (s) =>
      s.cloning === null ? {} : { cloning: { ...s.cloning, ...p } },
    );
  };
  try {
    const outcome = await runCloningBatch(
      a.rows,
      a.vector,
      {
        recipe: a.recipe,
        templates: a.templates,
        ...(a.settings === undefined ? {} : { settings: a.settings }),
        ...(a.fidelity === undefined ? {} : { fidelity: a.fidelity }),
      },
      {
        signal: controller.signal,
        clients: batchLanes(),
        onRow: (row) => {
          if (discarded.has(controller)) return;
          batchSession.update(documentId, (s) =>
            s.cloning === null ? {} : { cloning: { ...s.cloning, rows: [...s.cloning.rows, row] } },
          );
        },
        onProgress: (progress) => {
          patch({ progress });
        },
      },
    );
    patch({
      running: false,
      cancelled: outcome.cancelled,
      refused: outcome.refused,
      vectorCheck: outcome.vector,
    });
  } catch (e: unknown) {
    patch({ running: false });
    if (!discarded.has(controller)) {
      batchSession.update(documentId, { error: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    if (running.get(key(documentId)) === controller) running.delete(key(documentId));
    if (running.size === 0) batchPool.release();
  }
}
