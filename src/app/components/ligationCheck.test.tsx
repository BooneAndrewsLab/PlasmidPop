// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type DigestFragment,
  SeqDocument,
  digest,
  documentFromFragment,
  emptyVector,
  findCutSites,
  getEnzyme,
  locateInsert,
} from '@/core';

import { forgetCloneChecks, recallCloneCheck } from '../cloneCheck';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { BenchProductSlot } from './benchProductSlot';
import { LigationPanel } from './LigationPanel';
import { PrimerWorkspace } from './PrimerWorkspace';

/**
 * The Bench's clone check takes the vector the ligation's Against picker
 * names (#329), not the longest part: with two candidate vectors in the
 * tube and the shorter one chosen, the context, the empty vector and the
 * page's bands are those of the shorter one.
 */

function bases(n: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  while (out.length < n) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'.charAt(x >>> 30);
  }
  return out.replaceAll('GAATTC', 'GAATTA');
}

function cut(doc: SeqDocument): DigestFragment[] {
  const enzyme = getEnzyme('EcoRI');
  if (enzyme === undefined) throw new Error('no EcoRI');
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, [enzyme]));
}

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('missing');
  return value;
}

const big = def(
  cut(
    SeqDocument.create({
      name: 'pBig',
      topology: 'circular',
      sequence: `${bases(1500, 1)}GAATTC${bases(1494, 2)}`,
    }),
  )[0],
);
const small = def(
  cut(
    SeqDocument.create({
      name: 'pSmall',
      topology: 'circular',
      sequence: `${bases(1000, 5)}GAATTC${bases(994, 6)}`,
    }),
  )[0],
);
const insert = def(
  cut(SeqDocument.create({ name: 'ins', sequence: `CCGAATTC${bases(800, 3)}GAATTCGG` }))[1],
);

afterEach(() => {
  forgetPanels();
  forgetCloneChecks();
  act(() => {
    editorStore.clearShelf();
    editorStore.closeAllDocuments();
  });
});

describe('Bench clone check and the Against picker (#329)', () => {
  it('uses the vector chosen under Against, though a longer part is in the tube', async () => {
    act(() => {
      for (const f of [big, small, insert]) editorStore.addToShelf(f);
    });
    const slot = document.createElement('div');
    document.body.append(slot);
    render(
      <BenchProductSlot.Provider value={slot}>
        <LigationPanel />
      </BenchProductSlot.Provider>,
    );
    const bench = within(slot);
    const against = bench.getByRole('combobox', { name: 'Vector to check against' });
    const smallOption = bench.getByRole('option', { name: /^pSmall/ });
    fireEvent.change(against, { target: { value: smallOption.getAttribute('value') } });
    fireEvent.click(bench.getByRole('button', { name: 'Design check primers…' }));

    const product = def(editorStore.document);
    const context = def(recallCloneCheck(product));
    // The direct computation for the chosen vector.
    const docOf = (f: DigestFragment): SeqDocument => documentFromFragment(f);
    const expectedGeometry = def(locateInsert(product, docOf(small), [docOf(big), docOf(insert)]));
    const expectedEmpty = def(emptyVector(small));
    expect(context.geometry).toEqual(expectedGeometry);
    expect(context.empty?.sequence.toString()).toBe(expectedEmpty.sequence.toString());
    expect(context.vector).toEqual({
      name: expect.stringContaining('pSmall') as string,
      chosen: true,
    });

    // The page says which vector it used, and its bands follow it.
    render(<PrimerWorkspace doc={product} />);
    expect(screen.getByText(/Vector/)).toBeInTheDocument();
    expect(screen.getByText(/pSmall.*chosen under Against/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'to' }), { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Design check primers' }));
    const table = await screen.findByRole('table', { name: 'Check primer pairs' });
    const flank = within(table)
      .getAllByRole('row')
      .slice(1)
      .find((r) => within(r).getAllByRole('cell')[0]?.textContent === 'Flank');
    if (flank === undefined) throw new Error('no flank pair');
    const cells = within(flank)
      .getAllByRole('cell')
      .map((c) => Number(c.textContent.replaceAll(',', '')));
    const inserted = expectedGeometry.insert.end - expectedGeometry.insert.start;
    expect(Number(cells[3]) - Number(cells[4])).toBe(inserted);
    // The shorter vector is what a colony without the insert carries.
    expect(inserted).toBe(product.length - expectedEmpty.length);
  }, 30_000);
});
