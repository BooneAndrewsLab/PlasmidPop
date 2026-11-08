import {
  type DesignOptions,
  type MutagenesisDesign,
  type MutagenesisMethod,
  type MutagenesisOptions,
  type PrimerPair,
  type Range,
  type SeqDocument,
  BATCH_ROW_LIMIT,
  type BatchTemplate,
  type DesignRow,
} from '@/core';
import { AnalysisCancelledError, type LongRequestOptions } from '@/workers/analysisClient';
import { analysisClient } from '@/workers/analysisClient';
import { type DocumentSnapshot, snapshotOf } from '@/workers/saveProtocol';

/**
 * A batch of primer rows designed one after another (#358, item 141): each
 * row is its own request to the analysis worker, so the main thread only
 * waits, a cancel stops the row running, and each row is shown as soon as it
 * is done. A row with a `change` is a mutagenesis design; any other is a
 * primer pair for its region. The shape is `readBatch.ts`'s.
 */

export type PrimerBatchRow =
  | {
      readonly index: number;
      readonly line: number;
      readonly name: string;
      readonly status: 'designed';
      readonly kind: 'primers';
      /** Best first, as the Design page lists them. */
      readonly pairs: readonly PrimerPair[];
      readonly warnings: readonly string[];
    }
  | {
      readonly index: number;
      readonly line: number;
      readonly name: string;
      readonly status: 'designed';
      readonly kind: 'mutagenesis';
      readonly design: MutagenesisDesign;
      readonly warnings: readonly string[];
    }
  | {
      readonly index: number;
      readonly line: number;
      readonly name: string;
      readonly status: 'failed';
      readonly message: string;
    };

/** The two requests a row needs, as `analysisClient` has them; a stand-in in tests. */
export interface PrimerBatchClient {
  designPrimers(
    sequence: string,
    topology: SeqDocument['topology'],
    target: Range,
    options: DesignOptions,
    long: LongRequestOptions,
  ): Promise<PrimerPair[]>;
  designMutagenesis(
    template: DocumentSnapshot,
    range: Range,
    replacement: string,
    method: MutagenesisMethod,
    options: MutagenesisOptions,
    long: LongRequestOptions,
  ): Promise<MutagenesisDesign>;
}

export interface PrimerBatchOptions {
  /** The Design page's criteria; a row's own `tm` and `size` override them. */
  readonly criteria?: DesignOptions;
  readonly method?: MutagenesisMethod;
  readonly mutagenesis?: MutagenesisOptions;
}

export interface PrimerBatchHooks {
  /** Told each row as it is done, in the rows' order. */
  readonly onRow?: (row: PrimerBatchRow) => void;
  /** Told the fraction of the whole batch done. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  readonly client?: PrimerBatchClient;
}

export interface PrimerBatchOutcome {
  readonly rows: readonly PrimerBatchRow[];
  /** True when a cancel stopped it; `rows` are those done before. */
  readonly cancelled: boolean;
}

/** The Tm window a row's `tm` asks for: as wide as the default 55-65 °C one, around it. */
export const TM_HALF_WINDOW = 5;

export function findTemplate(
  templates: readonly BatchTemplate[],
  name: string,
): SeqDocument | undefined {
  const exact = templates.find((t) => t.name === name);
  if (exact !== undefined) return exact.document;
  const lower = name.toLowerCase();
  return templates.find((t) => t.name.toLowerCase() === lower)?.document;
}

/** The criteria for one row: the batch's, with the row's Tm and product size over them. */
function rowCriteria(base: DesignOptions, row: DesignRow): DesignOptions {
  const { tm, size } = row.overrides;
  return {
    ...base,
    ...(tm === undefined ? {} : { minTm: tm - TM_HALF_WINDOW, maxTm: tm + TM_HALF_WINDOW }),
    ...(size === undefined ? {} : { maxProduct: size }),
  };
}

/** Options a primer row has no use for, so a row that sets one is told it was left alone. */
function unusedOptions(row: DesignRow, mutagenesis: boolean): string[] {
  const o = row.overrides;
  const named: [string, boolean][] = [
    ['left', o.left !== undefined],
    ['right', o.right !== undefined],
    ['enzyme', o.enzyme !== undefined],
    ['kit', o.kit !== undefined],
    ['include_start', o.includeStart !== undefined],
    ['include_stop', o.includeStop !== undefined],
    ['size', mutagenesis && o.size !== undefined],
  ];
  return named
    .filter(([, set]) => set)
    .map(([column]) => `The ${column} column is not used by primer design and was ignored.`);
}

/**
 * Designs `rows` in order against `templates`. A row that cannot be designed
 * (no region, no template, nothing that meets the criteria, a worker error) is
 * a failed row and the next one goes on; a cancel stops the batch and keeps
 * what was done. Throws only for more than `BATCH_ROW_LIMIT` rows.
 */
export async function runPrimerBatch(
  rows: readonly DesignRow[],
  templates: readonly BatchTemplate[],
  options: PrimerBatchOptions,
  { onRow, onProgress, signal, client = analysisClient }: PrimerBatchHooks = {},
): Promise<PrimerBatchOutcome> {
  if (rows.length > BATCH_ROW_LIMIT) {
    throw new Error(
      `At most ${BATCH_ROW_LIMIT} rows are designed at once; this has ${rows.length}`,
    );
  }
  const done: PrimerBatchRow[] = [];
  const snapshots = new Map<SeqDocument, DocumentSnapshot>();
  const n = rows.length;
  for (let index = 0; index < n; index++) {
    if (signal?.aborted === true) return { rows: done, cancelled: true };
    const row = rows[index];
    if (row === undefined) continue;
    const base = { index, line: row.line, name: row.name };
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
    let result: PrimerBatchRow;
    try {
      result = await designRow(row, base, templates, options, client, long, snapshots);
    } catch (e: unknown) {
      if (e instanceof AnalysisCancelledError) return { rows: done, cancelled: true };
      result = {
        ...base,
        status: 'failed',
        message: e instanceof Error ? e.message : String(e),
      };
    }
    done.push(result);
    onRow?.(result);
    onProgress?.((index + 1) / n);
  }
  return { rows: done, cancelled: false };
}

async function designRow(
  row: DesignRow,
  base: { readonly index: number; readonly line: number; readonly name: string },
  templates: readonly BatchTemplate[],
  options: PrimerBatchOptions,
  client: PrimerBatchClient,
  long: LongRequestOptions,
  snapshots: Map<SeqDocument, DocumentSnapshot>,
): Promise<PrimerBatchRow> {
  const failed = (message: string): PrimerBatchRow => ({ ...base, status: 'failed', message });
  if (row.source.kind !== 'region') {
    return failed(
      row.source.kind === 'sequence'
        ? 'Primer design needs a region of a template; this row has only bases.'
        : 'Primer design needs a region of the template; this row has none.',
    );
  }
  const doc = row.template === null ? undefined : findTemplate(templates, row.template);
  if (doc === undefined) return failed(`No template named “${row.template ?? ''}”.`);
  const { range } = row.source;
  const change = row.overrides.change;
  if (change === undefined) {
    const pairs = await client.designPrimers(
      doc.sequence.toString(),
      doc.topology,
      range,
      rowCriteria(options.criteria ?? {}, row),
      long,
    );
    if (pairs.length === 0) return failed('No primer pair meets the criteria for this region.');
    return {
      ...base,
      status: 'designed',
      kind: 'primers',
      pairs,
      warnings: [...row.warnings, ...unusedOptions(row, false)],
    };
  }
  let snapshot = snapshots.get(doc);
  if (snapshot === undefined) {
    snapshot = snapshotOf(doc);
    snapshots.set(doc, snapshot);
  }
  const tm = row.overrides.tm;
  const design = await client.designMutagenesis(
    snapshot,
    range,
    change,
    options.method ?? 'back-to-back',
    { ...options.mutagenesis, ...(tm === undefined ? {} : { targetTm: tm }) },
    long,
  );
  return {
    ...base,
    status: 'designed',
    kind: 'mutagenesis',
    design,
    warnings: [
      ...row.warnings,
      ...(design.problem === null ? [] : [design.problem]),
      ...unusedOptions(row, true),
    ],
  };
}
