// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type DigestFragment, SeqDocument, digest, findCutSites, getEnzyme, ligate } from '@/core';

import { cloneCheckFromParts, forgetCloneChecks, registerCloneCheck } from '../cloneCheck';
import { rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerWorkspace } from './PrimerWorkspace';

/**
 * The clone-check page (item 120, #311), driven as a user would: a product
 * the Bench registered a context for, the design run through the inline
 * analysis client, the pairs and the selected pair's lanes; and a document
 * with no context, where the selection is the insert and a tab the empty
 * vector.
 */

/** Bases from a fixed seed, with no EcoRI site of their own. */
function bases(n: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  while (out.length < n) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'.charAt(x >>> 30);
  }
  return out.replaceAll('GAATTC', 'GAATTA');
}

function cutWithEcoRI(doc: SeqDocument): DigestFragment[] {
  const enzyme = getEnzyme('EcoRI');
  if (enzyme === undefined) throw new Error('no EcoRI');
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, [enzyme]));
}

// A 3 kb vector opened at its one EcoRI site, and an 800 bp EcoRI insert.
const vector = SeqDocument.create({
  name: 'pVec',
  topology: 'circular',
  sequence: `${bases(1500, 1)}GAATTC${bases(1494, 2)}`,
});
function def<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('no fragment');
  return value;
}
const backbone = def(cutWithEcoRI(vector)[0]);
const insert = def(
  cutWithEcoRI(
    SeqDocument.create({ name: 'ins', sequence: `CCGAATTC${bases(800, 3)}GAATTCGG` }),
  )[1],
);
const product = ligate([backbone, insert], { name: 'pVec-ins', circular: true });

function openOn(doc: SeqDocument) {
  let id = '';
  act(() => {
    id = editorStore.openDocument(doc);
    rememberWorkspacePage(id, 'clone');
    editorStore.setPrimerWorkspace(true);
  });
  const view = render(<PrimerWorkspace doc={doc} />);
  return { ...view, id };
}

function pairRows(): HTMLElement[] {
  const table = screen.queryByRole('table', { name: 'Check primer pairs' });
  return table === null ? [] : within(table).getAllByRole('row').slice(1);
}

afterEach(() => {
  forgetPanels();
  forgetCloneChecks();
  act(() => {
    editorStore.closeAllDocuments();
  });
});

describe('CloneCheckPage with a reaction’s context', () => {
  function registered() {
    const context = cloneCheckFromParts(
      product,
      { document: vector, fragment: backbone },
      [],
      'Ligation',
      { open: true, note: 'Either way round.' },
      [{ name: 'ins-F', sequence: insert.sequence.slice(4, 26).toUpperCase() }],
    );
    if (context === null) throw new Error('no context');
    registerCloneCheck(product, context);
    return context;
  }

  it('says where the insert is, what the empty vector is, and designs pairs with their bands', async () => {
    const context = registered();
    openOn(product);
    expect(screen.getByRole('heading', { name: 'Check a clone' })).toBeInTheDocument();
    expect(screen.getByText(/from Ligation/)).toBeInTheDocument();
    expect(screen.getByText(/closed on itself · 3,000 bp/)).toBeInTheDocument();
    expect(screen.getByText('Either way round.')).toBeInTheDocument();
    // The reaction's own primer is offered for reuse.
    const reuse = screen.getByRole('combobox', { name: 'Primer to reuse' });
    expect(within(reuse).getByRole('option', { name: /ins-F · 22 nt/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Design check primers' }));
    expect(
      await screen.findByText(/pairs for the Ligation product, checked against pVec/),
    ).toBeInTheDocument();
    const rows = pairRows();
    expect(rows.length).toBeGreaterThan(0);
    const kinds = rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    expect(kinds).toContain('Left junction');
    expect(kinds).toContain('Right junction');
    expect(kinds).toContain('Flank');
    // The first pair is selected, with its lanes drawn: no band on the empty
    // vector for a junction pair, none on the reversed clone either.
    const detail = screen.getByRole('complementary', { name: 'Pair 1' });
    expect(
      within(detail).getByText(/band only when the insert is there, this way round/),
    ).toBeInTheDocument();
    const bands = within(detail).getByLabelText('Expected bands');
    expect(bands).toHaveTextContent(/Empty vector—/);
    expect(bands).toHaveTextContent(/Wrong orientation—/);
    expect(within(detail).getByRole('figure')).toHaveTextContent('Empty');
    expect(within(detail).getByRole('figure')).toHaveTextContent('Flipped');
    // A flank pair gives a band on the empty vector shorter by the EcoRI
    // piece: the 800 bases and the site's six, less the four the ends share.
    const flank = rows.find((r) => within(r).getAllByRole('cell')[0]?.textContent === 'Flank');
    if (flank === undefined) throw new Error('no flank pair');
    const [, , , clone, empty] = within(flank)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(Number(clone?.replaceAll(',', '')) - Number(empty?.replaceAll(',', ''))).toBe(
      insert.sequence.length,
    );
    expect(insert.sequence.length).toBe(806);
    expect(context.geometry.junctions).toHaveLength(2);
  });

  it('reuses the reaction’s primer and designs only its counterpart', async () => {
    registered();
    openOn(product);
    fireEvent.change(screen.getByRole('combobox', { name: 'Primer to reuse' }), {
      target: { value: 'reaction:' + insert.sequence.slice(4, 26).toUpperCase() },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'to' }), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Design check primers' }));
    expect(await screen.findByText(/reusing ins-F/)).toBeInTheDocument();
    for (const row of pairRows()) {
      const cells = within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent);
      expect(cells[0]).toBe('Right junction');
      expect(cells[1]).toBe(insert.sequence.slice(4, 26).toUpperCase());
    }
    const detail = screen.getByRole('complementary', { name: 'Pair 1' });
    expect(within(detail).getByText('reused')).toBeInTheDocument();
  });

  it('the slim Primers panel is not needed: the rail has the page, with its count once designed', async () => {
    registered();
    openOn(product);
    const tab = screen.getByRole('tab', { name: /^Clone check/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Design check primers' }));
    await screen.findByText(/pairs for the Ligation product/);
    expect(tab.textContent).toMatch(/\d+$/);
  });
});

describe('CloneCheckPage without a context', () => {
  it('takes the selection as the insert and an open circular tab as the empty vector', async () => {
    act(() => {
      editorStore.openDocument(vector);
    });
    const { id } = openOn(product);
    expect(screen.getByText(/Select the insert on the map/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Design check primers' })).toBeDisabled();
    expect(screen.getByText('Select the insert first')).toBeInTheDocument();
    // The vector's tab is offered as the empty vector.
    const choice = screen.getByRole('combobox', { name: 'Empty vector' });
    const option = within(choice).getByRole('option', { name: /pVec · 3,000 bp/ });
    fireEvent.change(choice, { target: { value: option.getAttribute('value') } });
    act(() => {
      editorStore.setSelection({ start: 1506, end: 2306 });
    });
    expect(editorStore.getState().documentId).toBe(id);
    expect(screen.getByText(/1,507–2,306/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Design check primers' }));
    expect(
      await screen.findByText(/pairs for the selection 1,507–2,306, checked against pVec/),
    ).toBeInTheDocument();
    expect(pairRows().length).toBeGreaterThan(0);
  });
});
