// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { NcbiSearch } from './NcbiSearch';

const fetchState = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  resolve: (): void => undefined,
}));

vi.mock('../openFromNcbi', () => ({
  checkAccessionInput: (text: string) => ({ ok: true, accessions: [text] }),
  openFromNcbi: (_accessions: string[], opts: { signal: AbortSignal }) => {
    fetchState.signal = opts.signal;
    return new Promise<void>((resolve) => {
      fetchState.resolve = resolve;
    });
  },
}));

const noop = vi.fn();

function start(): void {
  fireEvent.change(screen.getByLabelText('Accession'), { target: { value: 'L09137' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

describe('NcbiSearch', () => {
  it('keeps a fetch running when the host re-renders with new callbacks', () => {
    const { rerender } = render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    start();
    rerender(<NcbiSearch onOpened={noop} onCancel={noop} />);
    expect(fetchState.signal?.aborted).toBe(false);
  });

  it('calls the latest onOpened when the fetch finishes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<NcbiSearch onOpened={first} onCancel={noop} />);
    start();
    rerender(<NcbiSearch onOpened={second} onCancel={noop} />);
    await act(async () => {
      fetchState.resolve();
      await Promise.resolve();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('cancels a running fetch first, then the host on the next Cancel', () => {
    const onCancel = vi.fn();
    render(<NcbiSearch onOpened={noop} onCancel={onCancel} />);
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchState.signal?.aborted).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('scopes Escape to the form unless globalEscape is set', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<NcbiSearch onOpened={noop} onCancel={onCancel} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Accession'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    onCancel.mockClear();
    rerender(<NcbiSearch globalEscape onOpened={noop} onCancel={onCancel} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
