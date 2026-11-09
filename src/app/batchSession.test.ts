import { SeqDocument } from '@/core';
import type { DesignRow } from '@/core';

import { EVENTS } from './analytics';
import {
  type BatchRun,
  type BatchSession,
  type CloningRun,
  batchCase,
  batchSession,
  batchTemplates,
  changeBatchInputs,
  clearBatchResults,
} from './batchSession';

const row = (overrides: DesignRow['overrides'] = {}): DesignRow => ({
  line: 2,
  name: 'a',
  template: 'p',
  source: { kind: 'whole', range: { start: 0, end: 4 } },
  overrides,
  notes: '',
  warnings: [],
});

describe('batchCase', () => {
  it('names a run by its kind of table, never by its content', () => {
    expect(batchCase([row()], false)).toBe('region');
    expect(batchCase([row(), row({ change: 'GCT' })], false)).toBe('recipe');
    expect(batchCase([row({ change: 'GCT' })], true)).toBe('scan');
  });

  it('is an event of the primers catalogue', () => {
    expect(EVENTS.primers).toContain('batch');
  });
});

describe('batchTemplates', () => {
  const make = (name: string): SeqDocument => SeqDocument.create({ name, sequence: 'ACGTACGT' });

  it('offers the front document first and each name once, without regard to case', () => {
    const front = make('Plasmid');
    const { templates, dropped } = batchTemplates(
      front,
      [make('plasmid'), make('other')],
      [
        { name: 'OTHER', document: make('OTHER') },
        { name: 'rec', document: make('rec') },
      ],
    );
    expect(templates.map((t) => t.name)).toEqual(['Plasmid', 'other', 'rec']);
    expect(templates[0]?.document).toBe(front);
    expect(dropped).toEqual(['plasmid', 'OTHER']);
  });
});

describe('changeBatchInputs (#429)', () => {
  const vector = SeqDocument.create({ name: 'v', sequence: 'ACGTACGT' });
  const run: BatchRun = {
    rows: [],
    source: [],
    templates: [],
    running: false,
    progress: 1,
    cancelled: false,
    ranOn: null,
    templateName: 'v',
  };
  const cloning: CloningRun = {
    rows: [],
    source: [],
    recipe: 'restriction',
    ran: { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
    vectorName: 'v',
    vector,
    running: false,
    progress: 1,
    cancelled: false,
    refused: null,
    vectorCheck: null,
  };
  const seed = (): void => {
    batchSession.forget();
    batchSession.update('d', { run, cloning, selected: 0, said: 'Saved.', text: 'name,region' });
  };

  const inputs: readonly (readonly [string, Partial<BatchSession>])[] = [
    ['rows text', { text: 'name,region\nA,1-10' }],
    ['method', { method: 'homology' }],
    ['template', { template: 'other' }],
    ['vector', { vector: 'other' }],
    ['5′ enzyme', { forwardEnzyme: 'XbaI' }],
    ['3′ enzyme', { reverseEnzyme: 'XbaI' }],
    ['Golden Gate enzyme', { goldenGateEnzyme: 'BsmBI' }],
    ['kit', { kit: 'yeast' }],
    ['overlap', { overlap: 55 }],
  ];

  it.each(inputs)('clears both runs when the %s changes', (_name, patch) => {
    seed();
    changeBatchInputs('d', patch);
    const s = batchSession.read('d');
    expect(s.run).toBeNull();
    expect(s.cloning).toBeNull();
    expect(s.selected).toBeNull();
    expect(s.said).toBeNull();
    for (const [k, v] of Object.entries(patch)) expect(s[k as keyof BatchSession]).toBe(v);
  });

  it('keeps the results when an input is set to what it holds, or something else changes', () => {
    seed();
    changeBatchInputs('d', { text: 'name,region', method: 'primers', note: 'Read.' });
    changeBatchInputs('d', (s) => ({ sort: s.sort, selected: 1 }));
    const s = batchSession.read('d');
    expect(s.run).toBe(run);
    expect(s.cloning).toBe(cloning);
    expect(s.selected).toBe(1);
    expect(s.note).toBe('Read.');
  });

  it('clears the results of a session with nothing running', () => {
    seed();
    clearBatchResults('d');
    expect(batchSession.read('d').run).toBeNull();
    expect(batchSession.read('d').cloning).toBeNull();
  });
});
