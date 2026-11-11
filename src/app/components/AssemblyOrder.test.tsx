// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type GibsonAssembly, type GibsonJoin, type GibsonPart, SeqDocument } from '@/core';

import { AssemblyOrder, DroppedParts, type JunctionVerdict } from './AssemblyOrder';

afterEach(cleanup);

const doc = (name: string, length: number): SeqDocument =>
  SeqDocument.create({ name, sequence: 'A'.repeat(length) });

const part = (name: string, length: number, flipped = false): GibsonPart => ({
  document: doc(name, length),
  flipped,
});

const join = (length: number, tm: number, overlap = 'acgt'): GibsonJoin => ({
  overlap,
  length,
  tm,
});

const assemblyOf = (
  order: readonly GibsonPart[],
  joins: readonly GibsonJoin[],
  warnings: GibsonAssembly['warnings'] = [],
): GibsonAssembly => ({ order, joins, product: doc('product', 2500), warnings });

const judge = (j: GibsonJoin): JunctionVerdict => ({
  weak: j.tm < 48,
  detail: j.tm < 48 ? `Tm ${j.tm} °C, weak` : `Tm ${j.tm} °C`,
});

const show = (
  assembly: GibsonAssembly,
  extra: { circular?: boolean; vectorIndex?: number | null } = {},
) =>
  render(
    <AssemblyOrder
      assembly={assembly}
      circular={extra.circular ?? false}
      label="The order"
      vectorIndex={extra.vectorIndex ?? null}
      judge={judge}
    />,
  );

describe('AssemblyOrder', () => {
  it('numbers the parts from 1 and says the product is a molecule or a circle', () => {
    const { rerender } = show(assemblyOf([part('a', 1000), part('b', 2000)], [join(20, 60)]));
    const list = screen.getByRole('list', { name: 'The order' });
    const parts = list.querySelectorAll('li.part');
    expect(parts).toHaveLength(2);
    expect(parts[0]?.textContent).toBe('1a1,000 bp');
    expect(parts[1]?.textContent).toBe('2b2,000 bp');
    expect(screen.getByText(/2 parts join into a 2,500 bp molecule, in this order:/)).toBeTruthy();
    rerender(
      <AssemblyOrder
        assembly={assemblyOf([part('a', 1000), part('b', 2000)], [join(20, 60)])}
        circular
        label="The order"
        judge={judge}
      />,
    );
    expect(screen.getByText(/into a 2,500 bp circle, in this order:/)).toBeTruthy();
  });

  it('says one part closes on itself', () => {
    show(assemblyOf([part('a', 3000)], [join(20, 60)]), { circular: true });
    expect(screen.getByText(/^1 part closes on itself into a 2,500 bp circle/)).toBeTruthy();
  });

  it('marks a flipped part and the vector, and no other', () => {
    show(assemblyOf([part('a', 10, true), part('v', 20), part('c', 30)], [join(20, 60)]), {
      vectorIndex: 1,
    });
    const names = [...document.querySelectorAll('.part__name')].map((e) => e.textContent);
    expect(names).toEqual(['a (flipped)', 'v (vector)', 'c']);
  });

  it('marks the vector at index 0 too, and none when there is no vector', () => {
    show(assemblyOf([part('v', 20), part('c', 30)], []), { vectorIndex: 0 });
    expect([...document.querySelectorAll('.part__name')].map((e) => e.textContent)).toEqual([
      'v (vector)',
      'c',
    ]);
    cleanup();
    show(assemblyOf([part('v', 20)], []), { vectorIndex: null });
    expect(document.querySelector('.part__name')?.textContent).toBe('v');
  });

  it('draws each junction with the length, the panel’s own detail and a mark', () => {
    show(assemblyOf([part('a', 10), part('b', 20)], [join(25, 60, 'ggcc'), join(18, 40)]));
    const rows = [...document.querySelectorAll('li.junction')];
    expect(rows.map((r) => r.textContent)).toEqual([
      '✓25 bp overlap, Tm 60 °C',
      '!closes: 18 bp overlap, Tm 40 °C, weak',
    ]);
    expect(rows[0]?.className).toBe('junction junction--ok');
    expect(rows[1]?.className).toBe('junction junction--weak');
    expect(rows[0]?.getAttribute('data-tip')).toBe('Shared: GGCC');
    expect(rows[0]?.querySelector('.junction__mark')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts a junction after its part and none after a part without one', () => {
    show(assemblyOf([part('a', 10), part('b', 20)], [join(20, 60)]));
    const kinds = [...document.querySelectorAll('ol > li')].map((e) => e.className.split(' ')[0]);
    expect(kinds).toEqual(['part', 'junction', 'part']);
  });

  it('lists the warnings and the product summary', () => {
    show(
      assemblyOf(
        [part('a', 10), part('b', 20)],
        [join(20, 60)],
        [{ kind: 'repeat', text: 'a warning text' }],
      ),
    );
    expect(screen.getByRole('list', { name: 'Assembly warnings' })).toBeTruthy();
    expect(screen.getByLabelText('Product').textContent).toContain('2,500 bp, linear');
  });
});

describe('DroppedParts', () => {
  it('says one document in the singular, with the reason', () => {
    render(
      <DroppedParts
        dropped={[{ document: doc('ring', 50), reason: 'circular' }]}
        minOverlap={15}
      />,
    );
    expect(screen.getByText('1 document left out')).toBeTruthy();
    expect(screen.getByText(/is circular, so it has no ends to join by/)).toBeTruthy();
  });

  it('counts several, and names the homology a short one lacks', () => {
    const { container } = render(
      <DroppedParts
        dropped={[
          { document: doc('x', 5), reason: 'short' },
          { document: doc('y', 6), reason: 'short' },
        ]}
        minOverlap={15}
      />,
    );
    expect(screen.getByText('2 documents left out')).toBeTruthy();
    const items = within(container).getAllByRole('listitem', { hidden: true });
    expect(items.map((i) => i.textContent)).toEqual([
      'x is shorter than the 15 bp of homology a junction needs.',
      'y is shorter than the 15 bp of homology a junction needs.',
    ]);
  });
});
