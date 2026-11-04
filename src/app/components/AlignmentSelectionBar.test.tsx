// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AlignmentSelectionBar } from './AlignmentSelectionBar';

describe('AlignmentSelectionBar', () => {
  it('copies, says so, and counts the columns', () => {
    const onCopy = vi.fn();
    render(
      <AlignmentSelectionBar
        left={10}
        top={20}
        columns={57}
        advancedOpen={false}
        onCopy={onCopy}
        onAdvanced={vi.fn()}
      />,
    );
    const bar = screen.getByRole('toolbar', { name: 'Selected residues' });
    expect(bar.style.left).toBe('10px');
    expect(bar.textContent).toContain('57 columns');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('opens the Advanced copy panel from the bar itself', () => {
    const onAdvanced = vi.fn();
    render(
      <AlignmentSelectionBar
        left={0}
        top={0}
        columns={1}
        advancedOpen
        onCopy={vi.fn()}
        onAdvanced={onAdvanced}
      />,
    );
    const button = screen.getByRole('button', { name: 'Advanced copy…' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(onAdvanced).toHaveBeenCalledWith(screen.getByRole('toolbar'));
    expect(screen.getByRole('toolbar').textContent).toContain('1 column');
  });
});
