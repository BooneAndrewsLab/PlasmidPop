import type { Assembly, ReadDifference } from '@/core';

import type { AlignBatch, ShownAlignment } from './alignSession';
import { UNCHECKED_NOTE } from './readAlignment';

/*
 * The one-line summaries the slim Align panel shows (item 129): what the
 * workspace's Results and Assemble pages say at length, in a sentence.
 * The alignment's line is the same the Results page heads with.
 */

/** "Local alignment": the kind, with its numbers after. */
export function alignmentKind(result: ShownAlignment): string {
  return result.alignment.mode === 'global' ? 'Global alignment' : 'Local alignment';
}

/** The score line: score, identity, columns, gaps, and whether it was turned over. */
export function alignmentNumbers(result: ShownAlignment): string {
  const a = result.alignment;
  const reversed =
    result.strand === 'reverse'
      ? result.docIsRead === null
        ? ', reverse complement of the pasted sequence'
        : ', reverse complement of this read'
      : '';
  return (
    `score ${a.score}, identity ${Math.round(a.identity * 100)}% over ${a.columns.toLocaleString()} columns, ` +
    `${a.gaps} gap ${a.gaps === 1 ? 'column' : 'columns'}` +
    `${a.unchecked === true ? `, ${UNCHECKED_NOTE}` : ''}${reversed}`
  );
}

/**
 * What the qualities say about the differences: how many sit on bases the
 * read was sure of (Q20+, or the threshold set, #56) and how many on poor
 * ones. "Does my clone match" comes down to the first number.
 */
export function differencesLine(
  differences: readonly ReadDifference[],
  confidentFrom: number,
  referenceName: string,
): string {
  const confident = differences.filter((d) => d.confident).length;
  const poor = differences.length - confident;
  return differences.length === 0
    ? `No differences from ${referenceName} over the aligned stretch.`
    : `${confident === 0 ? 'No' : confident.toLocaleString()} ${confident === 1 ? 'difference' : 'differences'} at confident bases (Q${confidentFrom}+)${poor === 0 ? '' : `, ${poor.toLocaleString()} at poor ones`}.`;
}

/** "12 reads · against target, 1 could not be aligned", as the batch stands. */
export function batchLine(batch: AlignBatch, against: string): string {
  const failed = batch.rows.filter((r) => r.status === 'failed').length;
  const state = batch.cancelled
    ? `cancelled after ${batch.rows.length}`
    : batch.rows.length < batch.total
      ? `${batch.rows.length} aligned so far`
      : `against ${against}`;
  return `${batch.total} ${batch.total === 1 ? 'read' : 'reads'} · ${state}${failed > 0 ? `, ${failed} could not be aligned` : ''}`;
}

/** "6 reads in 2 contigs, 1 left out; a repeat may have fooled 1 contig". */
export function assemblyLine(assembly: Assembly): string {
  const total = assembly.contigs.reduce((n, c) => n + c.reads.length, 0);
  const warned = assembly.contigs.filter((c) => c.warnings.length > 0).length;
  const contigs = assembly.contigs.length;
  if (contigs === 0) return 'Nothing to assemble.';
  const leftOut = assembly.skipped.length > 0 ? `, ${assembly.skipped.length} left out` : '';
  const fooled =
    warned > 0 ? `; a repeat may have fooled ${warned === 1 ? 'it' : `${warned} contigs`}` : '';
  return `${total} ${total === 1 ? 'read' : 'reads'} in ${contigs} ${contigs === 1 ? 'contig' : 'contigs'}${leftOut}${fooled}`;
}

/** An error rate as a percentage for a label: 5%, 0.1%. */
export function formatErrorRate(p: number): string {
  return `${String(Number((p * 100).toPrecision(2)))}%`;
}
