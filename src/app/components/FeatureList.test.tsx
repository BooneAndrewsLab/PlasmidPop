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

  it('opens a feature added from the selection in the full editor, in view, name focused', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setSelection({ start: 3900, end: 3960 });
    });
    const view = render(<FeatureList doc={doc} />);
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView of its own, so one is lent for the test.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      act(() => {
        editorStore.addFeatureFromSelection();
      });
      const added = editorStore.document;
      if (added === null) throw new Error('no document');
      view.rerender(<FeatureList doc={added} />);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
    const items = view.container.querySelectorAll('.feature-item');
    const last = items[items.length - 1];
    // The whole editor, not just a rename field, under the new feature's row.
    const form = last?.querySelector('form.feature-editor');
    expect(form).not.toBeNull();
    expect(view.container.querySelector('.feature-row__rename')).toBeNull();
    expect(screen.getByLabelText('Type')).toHaveValue('misc_feature');
    expect(screen.getByLabelText('Strand')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Location/)).toHaveValue('3901..3960');
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('New feature');
    expect(document.activeElement).toBe(name);
    // Its whole item, editor included, is scrolled into view.
    expect(scrolled).toContain(last);
    act(() => {
      editorStore.editFeature(null);
    });
  });

  it('lights up the added feature, not the one whose bases it was added over', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.selectFeature('f5');
    });
    const view = render(<FeatureList doc={doc} />);
    act(() => {
      editorStore.addFeatureFromSelection();
    });
    const added = editorStore.document;
    if (added === null) throw new Error('no document');
    view.rerender(<FeatureList doc={added} />);
    const lit = view.container.querySelectorAll('.feature-item--selected');
    expect(lit).toHaveLength(1);
    expect(lit[0]?.querySelector('form.feature-editor')).not.toBeNull();
    expect(lit[0]?.textContent).not.toContain('feature f5');
  });

  it('takes a just-added feature away again on Escape', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setSelection({ start: 3900, end: 3960 });
    });
    const view = render(<FeatureList doc={doc} />);
    act(() => {
      editorStore.addFeatureFromSelection();
    });
    view.rerender(<FeatureList doc={editorStore.document ?? doc} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    view.rerender(<FeatureList doc={editorStore.document ?? doc} />);
    expect(editorStore.document?.features.size).toBe(30);
    expect(editorStore.getState().history?.canUndo).toBe(false);
    expect(view.container.querySelector('form.feature-editor')).toBeNull();
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
