// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';
import { AnalysisWorkerError, analysisClient } from '@/workers/analysisClient';

import { MsaControls } from './MsaControls';
import { SLOW_RUN_MS } from './useMultipleAlignment';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const doc = SeqDocument.create({ name: 'target', sequence: 'ATGGCGTACGTTAGCCATTGACC' });
const two = [
  { name: 'one', sequence: 'ATGGCGTACGTTAGCCTTGACC' },
  { name: 'two', sequence: 'ATGGCGTACGTAGCCATTGACC' },
];
const align = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
};
const crash = () => new AnalysisWorkerError('Analysis worker failed: out of memory (w.js:3)');

describe('the multiple alignment run when the worker fails (#373)', () => {
  it('says plainly what happened, keeps the technical text behind a details line', async () => {
    vi.spyOn(analysisClient, 'alignMultiple').mockRejectedValue(crash());
    render(<MsaControls doc={doc} records={two} />);
    align();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'The analysis stopped (probably memory or size). Try again, or align fewer or shorter sequences.',
    );
    const details = alert.querySelector('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Analysis worker failed: out of memory (w.js:3)');
  });

  it('sends the run again once on Try again, and does not offer it a second time', async () => {
    const spy = vi.spyOn(analysisClient, 'alignMultiple').mockRejectedValue(crash());
    render(<MsaControls doc={doc} records={two} />);
    align();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText(/Align fewer or shorter sequences\./);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toEqual(spy.mock.calls[0]?.[0]);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows a result when the second try works', async () => {
    const real = analysisClient.alignMultiple.bind(analysisClient);
    vi.spyOn(analysisClient, 'alignMultiple')
      .mockRejectedValueOnce(crash())
      .mockImplementation(real);
    render(<MsaControls doc={doc} records={two} />);
    align();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Multiple alignment of 3');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an ordinary error as it was, without the stopped text', async () => {
    vi.spyOn(analysisClient, 'alignMultiple').mockRejectedValue(new Error('Too many'));
    render(<MsaControls doc={doc} records={two} />);
    align();
    expect(await screen.findByText('Too many')).toBeInTheDocument();
    expect(screen.queryByText(/The analysis stopped/)).toBeNull();
  });
});

describe('the multiple alignment run that takes a while (#373)', () => {
  it('says so after the limit, and Cancel stops the run through its signal', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.spyOn(analysisClient, 'alignMultiple').mockImplementation(
      (_s, _o, long) =>
        new Promise((_resolve, reject) => {
          signal = long?.signal;
          signal?.addEventListener('abort', () => {
            reject(new Error('Cancelled'));
          });
        }),
    );
    render(<MsaControls doc={doc} records={two} />);
    align();
    act(() => {
      vi.advanceTimersByTime(SLOW_RUN_MS - 1);
    });
    expect(screen.queryByText(/This is taking a while/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('This is taking a while');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
  });
});
