import type { Feature, SeqDocument, SequencingRead } from '@/core';

/** An open tab taken as a sample to align (#262): its sequence as it stands, with its read and features. */
export interface TabRecord {
  readonly name: string;
  readonly sequence: string;
  readonly circular: boolean;
  readonly read?: SequencingRead;
  readonly features?: readonly Feature[];
}

/**
 * A tab's current sequence, unsaved edits included, with its base qualities
 * if it is a read and its own features if it has any.
 */
export function tabRecord(d: SeqDocument): TabRecord {
  const features = d.features.all();
  return {
    name: d.name,
    sequence: d.sequence.toString(),
    circular: d.isCircular,
    ...(d.read === null ? {} : { read: d.read }),
    ...(features.length === 0 ? {} : { features }),
  };
}

/** The tabs as the records of a batch, in the order given and at most `limit` of them. */
export function tabsToRecords(docs: readonly SeqDocument[], limit: number): TabRecord[] {
  return docs.slice(0, limit).map(tabRecord);
}
