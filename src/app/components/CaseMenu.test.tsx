// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { CaseMenu } from './CaseMenu';

function Harness() {
  const { selection } = useEditorState();
  return <CaseMenu selection={selection} />;
}

const text = (): string => editorStore.getState().history?.present.sequence.toString() ?? '';

describe('CaseMenu (#90)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(SeqDocument.create({ name: 'p', sequence: 'acgtACGTacgt' }));
      editorStore.setSelection({ start: 2, end: 10 });
    });
  });

  const choose = (name: string): void => {
    fireEvent.click(screen.getByRole('button', { name: /Case/ }));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('upper-cases, lower-cases and swaps the selection, one undo step each', () => {
    render(<Harness />);
    choose('UPPERCASE');
    expect(text()).toBe('acGTACGTACgt');
    choose('lowercase');
    expect(text()).toBe('acgtacgtacgt');
    choose('tOGGLE cASE');
    expect(text()).toBe('acGTACGTACgt');
    expect(editorStore.getState().history?.labels.slice(-3)).toEqual([
      'Uppercase',
      'Lowercase',
      'Toggle case',
    ]);
    // The selection stays on the same bases.
    expect(editorStore.getState().selection).toEqual({ start: 2, end: 10 });
  });

  it('is off without bases selected', () => {
    act(() => {
      editorStore.setSelection({ start: 3, end: 3 });
    });
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Case/ })).toBeDisabled();
  });
});
