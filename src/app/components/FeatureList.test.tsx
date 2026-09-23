// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

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

describe('FeatureList translation check', () => {
  // ATG GCC ATT GTA ATG GGC CGC TGA: M A I V M G R, then a stop.
  const cds = createFeature({
    id: 'cds',
    type: 'CDS',
    name: 'orf',
    segments: [rangeSegment(3, 27)],
    qualifiers: [{ name: 'translation', value: 'MAIVMGR' }],
  });
  const start = SeqDocument.create({
    name: 'cds',
    sequence: 'CCCATGGCCATTGTAATGGGCCGCTGACCC',
    features: [cds],
  });

  const warned = (): boolean => document.querySelector('.feature-row__warn') !== null;
  const present = () => editorStore.getState().history?.present;
  const stored = () =>
    present()
      ?.features.get('cds')
      ?.qualifiers.find((q) => q.name === 'translation')?.value;

  function setup() {
    act(() => {
      editorStore.openDocument(start);
    });
    const view = render(<FeatureList doc={start} />);
    const rerender = () => {
      const doc = present();
      if (doc !== undefined) view.rerender(<FeatureList doc={doc} />);
    };
    return rerender;
  }

  it('flags a CDS an edit has left disagreeing with its /translation, and updates it', () => {
    const rerender = setup();
    expect(warned()).toBe(false);
    // GCC → GAC at codon 2: A becomes D.
    act(() => {
      editorStore.apply({ type: 'replace', range: { start: 7, end: 8 }, text: 'A' });
      editorStore.selectFeature('cds');
    });
    rerender();
    expect(warned()).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent(
      /differs from the sequence at residue 2: the file says A, the sequence gives D/,
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Update /translation' }));
    });
    rerender();
    expect(stored()).toBe('MDIVMGR');
    expect(warned()).toBe(false);
    // One undo puts the old /translation back, and the flag with it.
    act(() => {
      editorStore.undo();
      editorStore.selectFeature('cds');
    });
    rerender();
    expect(stored()).toBe('MAIVMGR');
    expect(warned()).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove /translation' }));
    });
    rerender();
    expect(stored()).toBeUndefined();
    expect(warned()).toBe(false);
  });

  it('leaves a CDS alone when the edit is outside it', () => {
    const rerender = setup();
    act(() => {
      editorStore.apply({ type: 'insert', position: 1, text: 'GG' });
    });
    rerender();
    expect(warned()).toBe(false);
  });
});
