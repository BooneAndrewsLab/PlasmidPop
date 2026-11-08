// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { type OrderOligo } from '@/core';

import { OrderSheetDialog } from './OrderSheetDialog';

const oligos = (n: number): OrderOligo[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `o${i + 1}`,
    sequence: `ACGTACGT${'A'.repeat(i)}`,
  }));

function open(list: readonly OrderOligo[], onClose = vi.fn(), download = vi.fn()) {
  render(<OrderSheetDialog oligos={list} onClose={onClose} download={download} />);
  return { onClose, download };
}

const preview = (): HTMLElement => screen.getByRole('table', { name: 'Order sheet preview' });

describe('OrderSheetDialog (#358)', () => {
  it('previews the first rows with the plate and well', () => {
    open(oligos(10));
    expect(screen.getByRole('dialog', { name: 'Order sheet' })).toBeInTheDocument();
    expect(screen.getByText(/10 oligos on 1 plate/)).toBeInTheDocument();
    const body = within(preview()).getAllByRole('row').slice(1);
    expect(body).toHaveLength(6);
    expect(body[0]).toHaveTextContent('1A1o1ACGTACGT8');
    expect(screen.getByText('… and 4 more.')).toBeInTheDocument();
  });

  it('refills the wells down columns and counts plates', () => {
    open(oligos(100));
    expect(screen.getByText(/100 oligos on 2 plates/)).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByLabelText('Wells fill'), { target: { value: 'column' } });
    });
    expect(within(preview()).getAllByRole('row')[2]).toHaveTextContent('1B1o2');
  });

  it('downloads the CSV with the typed scale and purification, and tells nothing else', () => {
    const { download } = open(oligos(2));
    act(() => {
      fireEvent.change(screen.getByLabelText('Scale'), { target: { value: '100 nmol' } });
      fireEvent.change(screen.getByLabelText('Purification'), { target: { value: 'PAGE' } });
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(
      'order-sheet.csv',
      'plate,well,name,sequence,length,scale,purification,notes\r\n' +
        '1,A1,o1,ACGTACGT,8,100 nmol,PAGE,\r\n' +
        '1,A2,o2,ACGTACGTA,9,100 nmol,PAGE,\r\n',
    );
  });

  it('warns of duplicate names and identical bases, and holds the download back for names', () => {
    const { download } = open([
      { name: 'x fwd', sequence: 'ACGTACGT' },
      { name: 'X fwd', sequence: 'ACGTACGA' },
      { name: 'y', sequence: 'ACGTACGA' },
    ]);
    expect(screen.getByRole('list', { name: 'Problems with the order' })).toHaveTextContent(
      'The name x fwd is used 2 times',
    );
    expect(screen.getByText(/Same bases under different names.*X fwd = y/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Download CSV' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(download).not.toHaveBeenCalled();
  });

  it('closes on Close and on Escape', () => {
    const { onClose } = open(oligos(1));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
