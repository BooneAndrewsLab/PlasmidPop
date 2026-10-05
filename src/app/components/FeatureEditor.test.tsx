// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { editorStore } from '../state/editorStore';
import { FeatureEditor } from './FeatureEditor';

/** The feature editor's thickness control (#88). */
describe('FeatureEditor thickness', () => {
  const setup = (qualifiers: { name: string; value: string | null }[] = []) => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'ACGT'.repeat(20),
      features: [
        createFeature({
          id: 'i',
          type: 'intron',
          name: 'intron 1',
          segments: [rangeSegment(10, 30)],
          qualifiers: [{ name: 'note', value: 'kept' }, ...qualifiers],
        }),
      ],
    });
    act(() => {
      editorStore.openDocument(doc);
    });
    const present = editorStore.getState().history?.present ?? doc;
    render(<FeatureEditor doc={present} feature={present.requireFeature('i')} />);
  };
  const saved = () => editorStore.getState().history?.present.requireFeature('i').qualifiers;

  it("offers the type's own thickness by default and keeps a choice as a qualifier", () => {
    setup();
    const select = screen.getByRole('combobox', { name: 'Thickness' });
    expect(select).toHaveValue('default');
    expect(screen.getByRole('option', { name: 'As its type (thin)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'full' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved()).toEqual([
      { name: 'note', value: 'kept' },
      { name: 'PlasmidPop_thickness', value: 'full' },
    ]);
  });

  it('shows a chosen thickness in its control, not among the qualifiers, and can drop it', () => {
    setup([{ name: 'PlasmidPop_thickness', value: 'medium' }]);
    expect(screen.getByRole('combobox', { name: 'Thickness' })).toHaveValue('medium');
    expect(screen.getAllByRole('textbox', { name: 'Qualifier name' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Thickness' }), {
      target: { value: 'default' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved()).toEqual([{ name: 'note', value: 'kept' }]);
  });
});

describe('FeatureEditor', () => {
  const setup = () => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'ACGT'.repeat(20),
      features: [
        createFeature({ id: 'g', type: 'gene', name: 'lacZ', segments: [rangeSegment(10, 30)] }),
      ],
    });
    act(() => {
      editorStore.openDocument(doc);
      editorStore.editFeature('g');
    });
    const present = editorStore.getState().history?.present ?? doc;
    render(<FeatureEditor doc={present} feature={present.requireFeature('g')} />);
  };

  it('takes a typed common type in its own spelling once the field is left', () => {
    setup();
    const type = screen.getByRole('combobox', { name: 'Type' });
    fireEvent.change(type, { target: { value: ' polya_SIGNAL ' } });
    fireEvent.blur(type);
    expect(type).toHaveValue('polyA_signal');
    fireEvent.change(type, { target: { value: 'my_part' } });
    fireEvent.blur(type);
    expect(type).toHaveValue('my_part');
  });

  it('drops the edits of an existing feature on Escape, as Cancel does', () => {
    setup();
    const depth = editorStore.getState().history?.undoDepth;
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'changed' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' });
    expect(editorStore.getState().editingFeatureId).toBeNull();
    expect(editorStore.getState().history?.present.requireFeature('g').name).toBe('lacZ');
    expect(editorStore.getState().history?.undoDepth).toBe(depth);
  });
});
