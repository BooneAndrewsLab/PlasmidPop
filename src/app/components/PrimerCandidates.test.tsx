// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerWorkspace } from './PrimerWorkspace';

function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const doc = SeqDocument.create({ sequence: template() });

/** Opens the workspace on Design, designs for 251–350 and lands on Results. */
function setup(layout: 'split' | 'phone' = 'split') {
  act(() => {
    const id = editorStore.openDocument(doc);
    rememberWorkspacePage(id, 'design');
    editorStore.setPrimerWorkspace(true);
  });
  const view = render(<PrimerWorkspace doc={doc} layout={layout} />);
  act(() => {
    editorStore.setSelection({ start: 250, end: 350 });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
  });
  return view;
}

function grid(): HTMLElement {
  return screen.getByRole('grid', { name: 'Candidate pairs' });
}

function bodyRows(): HTMLElement[] {
  return within(grid()).getAllByRole('row').slice(1);
}

function ranks(): number[] {
  return bodyRows().map((r) => Number(within(r).getAllByRole('cell')[0]?.textContent));
}

function header(name: string | RegExp): HTMLElement {
  return within(grid()).getByRole('columnheader', { name });
}

describe('the Results page (item 107, stage two)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('sorts by a column, says so, and turns the order round on a second click', () => {
    setup();
    const n = ranks().length;
    expect(n).toBeGreaterThan(1);
    expect(ranks()).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(header('#')).toHaveAttribute('aria-sort', 'ascending');
    act(() => {
      fireEvent.click(within(header('Product')).getByRole('button'));
    });
    expect(header('Product')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('#')).not.toHaveAttribute('aria-sort');
    const products = bodyRows().map((r) =>
      Number(within(r).getAllByRole('cell')[1]?.textContent.replace(/,/g, '')),
    );
    expect(products).toEqual([...products].sort((a, b) => a - b));
    act(() => {
      fireEvent.click(within(header('Product')).getByRole('button'));
    });
    expect(header('Product')).toHaveAttribute('aria-sort', 'descending');
    expect(
      bodyRows().map((r) =>
        Number(within(r).getAllByRole('cell')[1]?.textContent.replace(/,/g, '')),
      ),
    ).toEqual([...products].sort((a, b) => b - a));
  });

  it('narrows the rows by the box and the chips, and counts them', () => {
    setup();
    const n = ranks().length;
    expect(screen.getByRole('status', { name: '' }).textContent).toBe(`${n} of ${n}`);
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Filter pairs' }), {
        target: { value: '#2' },
      });
    });
    expect(ranks()).toEqual([2]);
    act(() => {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Filter pairs' }), {
        target: { value: '' },
      });
    });
    const chip = screen.getByRole('button', { name: 'ΔTm ≤ 1' });
    act(() => {
      fireEvent.click(chip);
    });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    for (const row of bodyRows()) {
      expect(Number(within(row).getAllByRole('cell')[2]?.textContent)).toBeLessThanOrEqual(1);
    }
  });

  it('walks the rows with the arrow keys, one stop in the tab order, and selects as it goes', () => {
    setup();
    const [first, second] = bodyRows();
    if (first === undefined || second === undefined) throw new Error('needs two pairs');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    act(() => {
      first.focus();
      fireEvent.keyDown(first, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('row', { selected: true })).toBe(first);
    expect(editorStore.getState().preview?.items).toHaveLength(3);
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('row', { selected: true })).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(second);
    expect(screen.getByRole('complementary', { name: 'Pair 2' })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(second, { key: 'Home' });
    });
    expect(screen.getByRole('row', { selected: true })).toBe(first);
  });

  it('offers Check specificity… as a link to NCBI with the two primers in the address (#298)', () => {
    setup();
    const [first] = bodyRows();
    if (first === undefined) throw new Error('needs a pair');
    act(() => {
      fireEvent.click(first);
    });
    const link = screen.getByRole('link', { name: 'Check specificity…' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.host).toBe('www.ncbi.nlm.nih.gov');
    const cells = within(first)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(url.searchParams.get('PRIMER_LEFT_INPUT')).toBe(cells[3]);
    expect(url.searchParams.get('PRIMER_RIGHT_INPUT')).toBe(cells[6]);
    expect([...url.searchParams.keys()]).toEqual([
      'PRIMER_LEFT_INPUT',
      'PRIMER_RIGHT_INPUT',
      'PRIMER_PRODUCT_MIN',
      'PRIMER_PRODUCT_MAX',
    ]);
    // The control says what leaves the browser.
    expect(link.getAttribute('data-tip')).toMatch(/two primer sequences in the address/);
    expect(within(first).getByText('not checked')).toBeInTheDocument();
  });

  it('is a list of rows on a phone, the selected one opened out', () => {
    setup('phone');
    expect(screen.queryByRole('grid')).toBeNull();
    const list = screen.getByRole('list', { name: 'Candidate pairs' });
    const heads = within(list).getAllByRole('button', { expanded: false });
    expect(heads.length).toBeGreaterThan(1);
    const [head] = heads;
    if (head === undefined) throw new Error('needs a pair');
    expect(head.textContent).toMatch(/^#1[\d,]+ bpΔTm \d\.\dTm \d+\.\d \/ \d+\.\d$/);
    act(() => {
      fireEvent.click(head);
    });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(within(list).getByRole('complementary', { name: 'Pair 1' })).toBeInTheDocument();
    expect(editorStore.getState().preview?.items).toHaveLength(3);
    // Sorting is a select on the phone.
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
        target: { value: 'product:desc' },
      });
    });
    const products = within(list)
      .getAllByRole('button', { name: /bp/ })
      .map((b) => Number(b.querySelector('span')?.textContent.replace(/[^\d]/g, '')));
    expect(products).toEqual([...products].sort((a, b) => b - a));
  });
});
