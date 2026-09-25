import { type History, type SeqDocument } from '@/core';

/**
 * Everything a document state holds, as plain data, so two states can be
 * compared with `toEqual` whatever objects they are made of: the property
 * and round-trip tests of the stored history (item 51) use it.
 */
export function stateView(doc: SeqDocument) {
  return {
    name: doc.name,
    sequence: doc.sequence.toString(),
    topology: doc.topology,
    features: doc.features.all(),
    metadata: doc.metadata,
    ends: doc.ends,
    methylation: doc.methylation,
    read: doc.read,
  };
}

/** Everything a history says about itself, every state and step with it, as plain data. */
export function historyView(history: History<SeqDocument>) {
  const record = history.toRecord();
  return {
    ...record,
    states: record.states.map(stateView),
    labels: history.labels,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}
