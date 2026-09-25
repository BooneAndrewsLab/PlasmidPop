// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';

import { alignEitherStrand, reverseComplement } from '@/core';

import { type BatchRow, runReadBatch } from '../readBatch';
import { ReadBatchList } from './ReadBatchList';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';

async function rows(): Promise<readonly BatchRow[]> {
  const mutated = reference.slice(10, 50).split('');
  mutated[5] = mutated[5] === 'A' ? 'C' : 'A';
  mutated[25] = mutated[25] === 'A' ? 'C' : 'A';
  const q = new Uint8Array(40).fill(40);
  q[25] = 8;
  const outcome = await runReadBatch(
    [
      { name: 'clone1', sequence: mutated.join(''), read: { qualities: q, trace: null } },
      { name: 'clone2', sequence: reverseComplement(reference.slice(0, 40)), read: null },
      { name: 'empty', sequence: '', read: null },
    ],
    { sequence: reference, offset: 0, wrap: null },
    (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options)),
    { options: {}, mode: 'local', trimCutoff: null },
  );
  return outcome.rows;
}

function rowAt(i: number): HTMLElement {
  const row = screen.getAllByRole('row')[i];
  if (row === undefined) throw new Error(`No row ${i}`);
  return row;
}

function names(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getByRole('rowheader').firstChild?.textContent ?? '');
}

describe('ReadBatchList (#59)', () => {
  it('lists each read with its identity, confident differences and span', async () => {
    const all = await rows();
    render(
      <ReadBatchList rows={all} confidentFrom={20} selected={null} onSelect={() => undefined} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Q20+ diffs' })).toBeInTheDocument();
    const [first, second, third] = [rowAt(1), rowAt(2), rowAt(3)];
    // clone1: two mismatches, one of them on a Q8 base.
    expect(
      within(first)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['95%', '1', '11–50']);
    expect(first).toHaveTextContent('40 bp');
    // clone2 has no qualities: all its differences count.
    expect(second).toHaveTextContent('40 bp, reversed');
    expect(
      within(second)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['100%', '0', '1–40']);
    // A read that could not be aligned says why, and cannot be picked.
    expect(third).toHaveTextContent(/empty/);
    expect(within(third).queryByRole('button')).toBeNull();
  });

  it('sorts by identity, lowest first then highest, then back to the file', async () => {
    render(
      <ReadBatchList
        rows={await rows()}
        confidentFrom={20}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    const sort = screen.getByRole('button', { name: /Identity/ });
    expect(names()).toEqual(['clone1', 'clone2', 'empty']);
    fireEvent.click(sort);
    expect(screen.getByRole('columnheader', { name: /Identity/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(names()).toEqual(['clone1', 'clone2', 'empty']);
    fireEvent.click(sort);
    expect(names()).toEqual(['clone2', 'clone1', 'empty']);
    fireEvent.click(sort);
    expect(screen.getByRole('columnheader', { name: /Identity/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('counts at the threshold given and tells which read was picked', async () => {
    const onSelect = vi.fn();
    render(
      <ReadBatchList rows={await rows()} confidentFrom={5} selected={1} onSelect={onSelect} />,
    );
    expect(screen.getByRole('columnheader', { name: 'Q5+ diffs' })).toBeInTheDocument();
    const first = rowAt(1);
    expect(within(first).getAllByRole('cell')[1]).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'clone2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'clone1' }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
