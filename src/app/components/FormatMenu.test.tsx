// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { editorStore } from '../state/editorStore';
import { FormatMenu } from './FormatMenu';

describe('FormatMenu', () => {
  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.setSeqFontFamily('');
      editorStore.setBaseColors(null);
      editorStore.setColorBases(false);
    });
  });

  const open = (): void => {
    render(<FormatMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
  };

  it("takes a bases-per-row count of the user's own, held to 10–1,000 (#29)", () => {
    open();
    const other = screen.getByRole('spinbutton', { name: 'Bases per row' });
    fireEvent.change(other, { target: { value: '75' } });
    // Not applied per keystroke: a count is typed, then committed.
    expect(editorStore.getState().seqBasesPerRow).toBeNull();
    fireEvent.keyDown(other, { key: 'Enter' });
    expect(editorStore.getState().seqBasesPerRow).toBe(75);
    expect(other).toHaveValue(75);
    fireEvent.change(other, { target: { value: '5000' } });
    fireEvent.blur(other);
    expect(editorStore.getState().seqBasesPerRow).toBe(1000);
    // One of the fixed widths leaves the box empty again.
    fireEvent.click(screen.getByRole('menuitemradio', { name: '60' }));
    expect(other).toHaveValue(null);
  });

  it('draws in a font the user names, cleaned to what a family name can hold', () => {
    open();
    const font = screen.getByRole('textbox', { name: 'Sequence font' });
    fireEvent.change(font, { target: { value: 'JetBrains Mono"; color: red' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    expect(editorStore.getState().seqFontFamily).toBe('JetBrains Mono color red');
    fireEvent.change(font, { target: { value: '  ' } });
    fireEvent.blur(font);
    expect(editorStore.getState().seqFontFamily).toBe('');
  });

  it('lets the four base colours be chosen while bases are coloured, and put back', () => {
    open();
    expect(screen.queryByRole('group', { name: 'Base colours' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Colour the bases' }));
    const a = screen.getByLabelText('Colour of A');
    fireEvent.change(a, { target: { value: '#123456' } });
    expect(editorStore.getState().baseColors).toMatchObject({ a: '#123456' });
    // The other three are filled from what was drawn, so all four are set.
    expect(Object.values(editorStore.getState().baseColors ?? {})).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(editorStore.getState().baseColors).toBeNull();
  });
});
