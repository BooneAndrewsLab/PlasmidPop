// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../clipboard';
import { PrimerLine } from './PrimerLine';

vi.mock('../clipboard', () => ({ copyText: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.mocked(copyText).mockClear();
});

const renderLine = (copyLabel?: string) =>
  render(
    <ol>
      <PrimerLine label="Insert 1 forward" sequence="ACGTACGT" copyLabel={copyLabel}>
        8 nt, Tm 52 °C
      </PrimerLine>
    </ol>,
  );

describe('PrimerLine', () => {
  it('shows the label, the meta line the caller wrote, and the sequence, in the pair frame', () => {
    const { container } = renderLine();
    const item = screen.getByRole('listitem');
    expect(item).toHaveClass('pair');
    expect(item.querySelector('.pair__row.pair__row--wide > .pair__length')).toHaveTextContent(
      'Insert 1 forward',
    );
    expect(container.querySelector('.pair__meta')).toHaveTextContent('8 nt, Tm 52 °C');
    expect(container.querySelector('.pair__foot > code.mutagenesis__oligo')).toHaveTextContent(
      'ACGTACGT',
    );
    const copy = container.querySelector('.pair__foot > .pair__buttons > button');
    expect(copy).toHaveClass('button', 'button--quiet', 'button--small');
    expect(copy).toHaveAttribute('type', 'button');
  });

  it('names the Copy button from the label unless told otherwise', () => {
    renderLine();
    expect(screen.getByRole('button', { name: 'Copy the insert 1 forward primer' })).toBeTruthy();
    cleanup();
    renderLine('Copy SOE x, forward primer');
    expect(screen.getByRole('button', { name: 'Copy SOE x, forward primer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy the/ })).toBeNull();
  });

  it('copies the sequence', () => {
    renderLine();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith('ACGTACGT');
  });
});
