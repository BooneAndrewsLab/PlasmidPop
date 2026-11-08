import { SeqDocument } from '@/core';
import type { DesignRow } from '@/core';

import { EVENTS } from './analytics';
import { batchCase, batchTemplates } from './batchSession';

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
