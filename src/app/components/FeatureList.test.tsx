// @vitest-environment jsdom
import { act, render } from '@testing-library/react';

import { SeqDocument, createFeature } from '@/core';

import { editorStore } from '../state/editorStore';
import { FeatureList } from './FeatureList';

const feature = (id: string, start: number): ReturnType<typeof createFeature> =>
  createFeature({
    id,
    type: 'misc_feature',
    name: `feature ${id}`,
    segments: [{ kind: 'range', start, end: start + 40, partialStart: false, partialEnd: false }],
  });

const doc = SeqDocument.create({
  name: 'list',
  sequence: 'ACGT'.repeat(1000),
  features: Array.from({ length: 30 }, (_, i) => feature(`f${i}`, i * 100)),
});

describe('FeatureList', () => {
  it('scrolls the selected feature into view', () => {
    act(() => {
      editorStore.openDocument(doc);
    });
    const scrolled: Element[] = [];
    const view = render(<FeatureList doc={doc} />);
    for (const li of view.container.querySelectorAll('li')) {
      li.scrollIntoView = () => {
        scrolled.push(li);
      };
    }
    act(() => {
      editorStore.selectFeature('f20');
    });
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.textContent).toContain('feature f20');
  });

  it('selects one row of two features that cover the same bases', () => {
    // pBR322 has gene bla and CDS beta-lactamase at exactly the same span;
    // clicking one of them on the map should not light up both rows.
    const pair = SeqDocument.create({
      name: 'pair',
      sequence: 'ACGT'.repeat(1000),
      features: [
        createFeature({
          id: 'gene',
          type: 'gene',
          name: 'bla',
          segments: [
            { kind: 'range', start: 100, end: 900, partialStart: false, partialEnd: false },
          ],
        }),
        createFeature({
          id: 'cds',
          type: 'CDS',
          name: 'beta-lactamase',
          segments: [
            { kind: 'range', start: 100, end: 900, partialStart: false, partialEnd: false },
          ],
        }),
      ],
    });
    act(() => {
      editorStore.openDocument(pair);
    });
    const view = render(<FeatureList doc={pair} />);
    const selectedNames = (): string[] =>
      [...view.container.querySelectorAll('.feature-item--selected')].map(
        (li) => li.querySelector('.feature-row__name')?.textContent ?? '',
      );
    act(() => {
      editorStore.selectFeature('cds');
    });
    expect(selectedNames()).toEqual(['beta-lactamase']);
    // A range selected by hand says nothing about which feature it is, so
    // both rows light up, as they always did.
    act(() => {
      editorStore.setSelection({ start: 100, end: 900 });
    });
    expect(selectedNames()).toHaveLength(2);
  });
});
