// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Analytics } from '../analytics';
import { StatsSwitch } from './StatsSwitch';

const CONFIG = { url: 'https://stats.example.org/', siteId: '6' };

describe('StatsSwitch', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    delete (globalThis as { _paq?: unknown })._paq;
  });

  it('is absent when no tracker is configured', () => {
    render(<StatsSwitch tracker={new Analytics(null, false, vi.fn())} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('switches statistics off and on', () => {
    const tracker = new Analytics(CONFIG, false, vi.fn());
    render(<StatsSwitch tracker={tracker} />);
    const box = screen.getByRole('checkbox', { name: /usage statistics/i });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(tracker.enabled).toBe(false);
    expect(globalThis.localStorage.getItem('plasmidpop.statsOptOut')).toBe('1');
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(tracker.enabled).toBe(true);
  });

  it('shows off and locked under a browser privacy signal', () => {
    const tracker = new Analytics(CONFIG, true, vi.fn());
    render(<StatsSwitch tracker={tracker} />);
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText(/Global Privacy Control/)).toBeInTheDocument();
  });
});
