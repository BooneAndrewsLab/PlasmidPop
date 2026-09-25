// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { sharedStyle } from '../baseStyleSelection';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { BaseStyleMenu } from './BaseStyleMenu';

/** The menu as the edit bar has it, following the document in front. */
function Harness() {
  const { history, selection } = useEditorState();
  if (history === null) return null;
  return <BaseStyleMenu doc={history.present} selection={selection} />;
}

const present = (): SeqDocument => {
  const h = editorStore.getState().history;
  if (h === null) throw new Error('no document');
  return h.present;
};

describe('BaseStyleMenu (#89, #91)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(SeqDocument.create({ name: 'p', sequence: 'ACGT'.repeat(10) }));
    });
  });

  const open = (): void => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Style/ }));
  };

  it('is off without bases selected', () => {
    act(() => {
      editorStore.setSelection({ start: 3, end: 3 });
    });
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Style/ })).toBeDisabled();
  });

  it('colours, highlights, emboldens and enlarges the selection, one undo step each', () => {
    act(() => {
      editorStore.setSelection({ start: 4, end: 8 });
    });
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Letter colour: Red' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Highlight: Yellow' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large (1½×)' }));
    expect(present().styles.runs).toEqual([
      {
        start: 4,
        end: 8,
        style: { color: '#d62728', highlight: '#ffe066', bold: true, size: 1.5 },
      },
    ]);
    // Ticked, since the whole selection has them.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Bold' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Letter colour: Red' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(editorStore.getState().history?.labels.slice(-4)).toEqual([
      'Colour bases',
      'Highlight bases',
      'Bold bases',
      'Resize bases',
    ]);
    // The selection stays, so another choice can follow.
    expect(editorStore.getState().selection).toEqual({ start: 4, end: 8 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear style' }));
    expect(present().styles.isEmpty).toBe(true);
  });

  it('takes one part of the style off with None, and bold off with a second click', () => {
    act(() => {
      editorStore.setSelection({ start: 0, end: 4 });
    });
    open();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Letter colour: Blue' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bold' }));
    expect(present().styles.runs).toEqual([{ start: 0, end: 4, style: { color: '#1f77b4' } }]);
    const [lettersNone] = screen.getAllByRole('button', { name: 'None' });
    if (lettersNone === undefined) throw new Error('no None button');
    fireEvent.click(lettersNone);
    expect(present().styles.isEmpty).toBe(true);
  });
});

describe('sharedStyle', () => {
  it('keeps only what every base of the selection has, through the origin', () => {
    const doc = SeqDocument.create({ sequence: 'A'.repeat(10), topology: 'circular' })
      .styleBases({ start: 8, end: 12 }, { bold: true })
      .styleBases({ start: 0, end: 1 }, { color: '#ff0000' });
    expect(sharedStyle(doc, { start: 8, end: 12 })).toEqual({ bold: true });
    expect(sharedStyle(doc, { start: 7, end: 12 })).toEqual({});
  });
});
