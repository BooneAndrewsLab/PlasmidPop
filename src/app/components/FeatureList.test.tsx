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
});
