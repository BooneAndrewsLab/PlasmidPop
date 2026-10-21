// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OpenTabPicker } from './OpenTabPicker';

const tabs = [
  { id: 'a', name: 'pA' },
  { id: 'b', name: 'pB' },
  { id: 'c', name: 'pC' },
];

function open(limit = 96) {
  const onUse = vi.fn();
  render(<OpenTabPicker tabs={tabs} limit={limit} onUse={onUse} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open tab…' }));
  return onUse;
}

describe('OpenTabPicker', () => {
  it('is closed until the button is pressed', () => {
    render(<OpenTabPicker tabs={tabs} limit={96} onUse={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open tab…' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('hands over the checked tabs in tab order and closes', () => {
    const onUse = open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'pC' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'pA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 2 tabs' }));
    expect(onUse).toHaveBeenCalledWith(['a', 'c']);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('says "Use 1 tab" for one and keeps the button off for none', () => {
    open();
    expect(screen.getByRole('button', { name: 'Use 0 tabs' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'pB' }));
    expect(screen.getByRole('button', { name: 'Use 1 tab' })).toBeEnabled();
  });

  it('selects all, then none', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getAllByRole('checkbox').some((c) => (c as HTMLInputElement).checked)).toBe(
      false,
    );
  });

  it('stops at the limit', () => {
    const onUse = open(2);
    expect(screen.getByText(/At most 2 tabs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('checkbox', { name: 'pC' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use 2 tabs' }));
    expect(onUse).toHaveBeenCalledWith(['a', 'b']);
  });

  it('closes on Escape and starts empty when reopened', () => {
    open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'pA' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open tab…' }));
    expect(screen.getByRole('checkbox', { name: 'pA' })).not.toBeChecked();
  });
});
