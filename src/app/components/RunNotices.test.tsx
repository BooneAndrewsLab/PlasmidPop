// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RunNotices } from './RunNotices';

afterEach(cleanup);

const idle = {
  error: null,
  stopped: null,
  slow: false,
  busy: false,
  retry: vi.fn(),
  advice: 'use fewer bases',
};

describe('RunNotices (item 133, §3.5)', () => {
  it('says nothing for a run that is going well', () => {
    const { container } = render(<RunNotices {...idle} busy />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an ordinary error as it was', () => {
    render(<RunNotices {...idle} error="Too many" />);
    expect(screen.getByText('Too many')).toHaveClass('panel__error');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers Try again with the advice as a clause, and the details behind a line', () => {
    const retry = vi.fn();
    render(
      <RunNotices {...idle} retry={retry} stopped={{ detail: 'out of memory', canRetry: true }} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'The analysis stopped (probably memory or size). Try again, or use fewer bases.',
    );
    expect(alert.querySelector('details')).not.toHaveAttribute('open');
    expect(alert).toHaveTextContent('out of memory');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('gives the advice as a sentence when Try again is no longer on offer', () => {
    render(<RunNotices {...idle} stopped={{ detail: 'out of memory', canRetry: false }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The analysis stopped (probably memory or size). Use fewer bases.',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says a run is taking a while only while it is busy and slow', () => {
    const { rerender } = render(<RunNotices {...idle} slow />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<RunNotices {...idle} busy slow />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'This is taking a while. Cancel to stop it, or wait for it to finish.',
    );
    rerender(<RunNotices {...idle} busy slow slowText="It finishes by itself." />);
    expect(screen.getByRole('status')).toHaveTextContent('It finishes by itself.');
  });
});
