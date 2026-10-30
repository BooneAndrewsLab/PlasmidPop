// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { INS_LENGTH, insShapedRecord } from '@/test/insShapedRecord';

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

describe('grouped features (#308)', () => {
  const copy = (id: string, pid: string) =>
    createFeature({
      id,
      type: 'CDS',
      name: 'p',
      segments: [rangeSegment(100, 400)],
      qualifiers: [{ name: 'protein_id', value: pid }],
    });
  const twins = SeqDocument.create({
    name: 'twins',
    sequence: 'ACGT'.repeat(200),
    features: [copy('c1', 'NP_1'), copy('c2', 'NP_2'), feature('f1', 500)],
  });

  it('says under a selected member what the views draw it as, and lets another member be picked', () => {
    act(() => {
      editorStore.openDocument(twins);
      editorStore.selectFeature('c1');
    });
    const view = render(<FeatureList doc={twins} />);
    const note = view.container.querySelector('.feature-item__group');
    expect(note?.textContent).toContain(
      'Drawn in the views as one bar with 1 other feature of this type on these bases.',
    );
    expect(note?.querySelector('.feature-item__member--selected')?.textContent).toBe(
      'p: /protein_id=NP_1',
    );
    fireEvent.click(screen.getByRole('button', { name: 'p: /protein_id=NP_2' }));
    expect(editorStore.getState().selectedFeatureId).toBe('c2');
    // A feature in no group has no such note.
    act(() => {
      editorStore.selectFeature('f1');
    });
    expect(view.container.querySelector('.feature-item__group')).toBeNull();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('removes the other copies, or every feature of the type, as one edit Undo takes back (#316)', () => {
    act(() => {
      editorStore.openDocument(twins);
      editorStore.selectFeature('c1');
    });
    const view = render(<FeatureList doc={twins} />);
    const rerender = (): void => {
      view.rerender(<FeatureList doc={editorStore.document ?? twins} />);
    };
    // `misc_feature` has one feature here, so there is no Remove all for f1.
    expect(screen.getByRole('button', { name: 'Remove all 2 CDS' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the other copy' }));
    rerender();
    expect(editorStore.document?.features.all().map((f) => f.id)).toEqual(['c1', 'f1']);
    expect(editorStore.getState().history?.undoLabel).toBe('Remove 1 other copy of p');
    act(() => {
      editorStore.undo();
    });
    rerender();
    act(() => {
      editorStore.selectFeature('c2');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove all 2 CDS' }));
    rerender();
    expect(editorStore.document?.features.all().map((f) => f.id)).toEqual(['f1']);
    expect(editorStore.getState().history?.undoLabel).toBe('Remove 2 CDS features');
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.features.all().map((f) => f.id)).toEqual(['c1', 'c2', 'f1']);
    act(() => {
      editorStore.selectFeature('f1');
    });
    rerender();
    expect(screen.queryByRole('button', { name: /^Remove all/ })).toBeNull();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('removes all of a type as the list shows it while a transcript is picked (#316)', () => {
    const ins = SeqDocument.create({
      sequence: 'A'.repeat(INS_LENGTH),
      features: insShapedRecord(),
    });
    const mrnas = (): string[] =>
      (editorStore.document?.features.all() ?? [])
        .filter((f) => f.type === 'mRNA')
        .map((f) => f.id);
    act(() => {
      editorStore.setTranscriptPicks(new Map());
      editorStore.openDocument(ins);
      editorStore.selectFeature('m-1');
    });
    const view = render(<FeatureList doc={ins} />);
    const rerender = (): void => {
      view.rerender(<FeatureList doc={editorStore.document ?? ins} />);
    };
    // No pick: every mRNA counts.
    expect(screen.getByRole('button', { name: 'Remove all 5 mRNA' })).toBeInTheDocument();
    const all = mrnas();
    act(() => {
      editorStore.pickTranscript('INS', 'NM_000207.3');
    });
    // Picked: the list shows INS variant 1 and the readthrough, and so does the count.
    expect(screen.getByRole('button', { name: 'Remove all 2 mRNA' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove all 2 mRNA' }));
    rerender();
    expect(mrnas()).toEqual(all.filter((id) => id !== 'm-1' && id !== 'm-rt'));
    expect(editorStore.getState().history?.undoLabel).toBe('Remove 2 mRNA features');
    act(() => {
      editorStore.undo();
    });
    rerender();
    expect(mrnas()).toEqual(all);
    act(() => {
      editorStore.closeDocument();
      editorStore.restoreLastTranscriptPicks([]);
    });
  });

  it('marks the removals apart from the view actions in a group notice (#316)', () => {
    const ins = SeqDocument.create({
      sequence: 'A'.repeat(INS_LENGTH),
      features: insShapedRecord(),
    });
    act(() => {
      editorStore.setTranscriptPicks(new Map());
      editorStore.openDocument(ins);
      editorStore.selectFeature('m-1');
    });
    render(<FeatureList doc={ins} />);
    const show = screen.getByRole('button', { name: 'Show only this transcript' });
    const others = screen.getByRole('button', { name: 'Remove the other 3 transcripts' });
    expect(show).not.toHaveClass('feature-item__remove');
    expect(others).toHaveClass('feature-item__remove');
    expect(screen.getByRole('button', { name: 'Remove all 5 mRNA' })).toHaveClass(
      'feature-item__remove',
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('feature-item__remove');
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('makes a pick permanent from the picked notice, in one undo step (#328)', () => {
    const ins = SeqDocument.create({
      sequence: 'A'.repeat(INS_LENGTH),
      features: insShapedRecord(),
    });
    act(() => {
      editorStore.setTranscriptPicks(new Map());
      editorStore.openDocument(ins);
      editorStore.selectFeature('m-1');
      editorStore.pickTranscript('INS', 'NM_000207.3');
    });
    const view = render(<FeatureList doc={ins} />);
    const button = screen.getByRole('button', { name: 'Remove the other 3 transcripts' });
    expect(button).toHaveClass('feature-item__remove');
    fireEvent.click(button);
    expect(editorStore.getState().history?.undoLabel).toBe('Remove 3 other INS transcripts');
    expect(editorStore.getState().history?.undoDepth).toBe(1);
    expect(editorStore.document?.features.size).toBe(33);
    expect(view.container.querySelectorAll('li.feature-item')).toHaveLength(33);
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.features.size).toBe(36);
    act(() => {
      editorStore.closeDocument();
      editorStore.restoreLastTranscriptPicks([]);
    });
  });

  it('shows one transcript of a gene, its rows alone, and brings the rest back (item 119)', () => {
    const ins = SeqDocument.create({
      sequence: 'A'.repeat(INS_LENGTH),
      features: insShapedRecord(),
    });
    act(() => {
      editorStore.setTranscriptPicks(new Map());
      editorStore.openDocument(ins);
      editorStore.selectFeature('m-1');
    });
    const history = editorStore.getState().history;
    const view = render(<FeatureList doc={ins} />);
    const names = (): string[] =>
      [...view.container.querySelectorAll('.feature-row__name')].map((e) => e.textContent);
    expect(view.container.querySelectorAll('li.feature-item')).toHaveLength(36);
    // Under the selected transcript, the group notice offers to show it alone.
    fireEvent.click(screen.getByRole('button', { name: 'Show only this transcript' }));
    expect([...editorStore.getState().transcriptPicks]).toEqual([['INS', 'NM_000207.3']]);
    // The other three INS mRNAs are out of the list; every CDS and peptide
    // can be variant 1's, so they all stay, as does the readthrough's mRNA.
    expect(view.container.querySelectorAll('li.feature-item')).toHaveLength(33);
    expect(names().filter((n) => n.startsWith('insulin, transcript variant'))).toEqual([
      'insulin, transcript variant 1',
    ]);
    expect(names()).toContain('INS-IGF2 readthrough, transcript variant 2');
    expect(screen.getByRole('note').textContent).toMatch(
      /^Shown alone in the views: the other 3 INS transcripts/,
    );
    expect(screen.getByText(/^Showing one transcript of INS in the views;/)).toBeInTheDocument();
    // Not an edit: nothing to undo.
    expect(editorStore.getState().history).toBe(history);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 4 INS transcripts' }));
    expect(editorStore.getState().transcriptPicks.size).toBe(0);
    expect(view.container.querySelectorAll('li.feature-item')).toHaveLength(36);
    // The banner's own link does the same.
    act(() => {
      editorStore.pickTranscript('INS', 'NM_001185098.2');
    });
    expect(view.container.querySelectorAll('li.feature-item')).toHaveLength(33);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(editorStore.getState().transcriptPicks.size).toBe(0);
    act(() => {
      editorStore.closeDocument();
      editorStore.restoreLastTranscriptPicks([]);
    });
  });
});
