// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';

import { editorStore } from '../state/editorStore';
import { PcrPanel } from './PcrPanel';

/** A fixed pseudo-random plasmid, so a primer site is never a coincidence. */
function template(length: number, seed = 31337): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const TEXT = template(2000);
const doc = SeqDocument.create({ name: 'pTest', sequence: TEXT, topology: 'circular' });

const FWD = TEXT.slice(200, 222);
const REV = reverseComplement(TEXT.slice(700, 722));
/**
 * An EcoRI site and a clamp, chosen so that none of its last three bases
 * pairs with the template just before the primer's site: a tail that happens
 * to match is a longer site, not a tail (`anneal.ts`).
 */
const TAIL = 'GAATTCGGC';

function setup() {
  act(() => {
    editorStore.openDocument(doc);
  });
  return render(<PcrPanel doc={doc} />);
}

function type(label: string, value: string): void {
  act(() => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

const preview = () => editorStore.getState().preview;

describe('PcrPanel', () => {
  afterEach(() => {
    // A product opened by a test is a tab of its own, so close them all.
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('puts a product on the shelf, blunt and with its primers', () => {
    setup();
    type('Forward primer', TAIL + FWD);
    type('Reverse primer', REV);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Shelve' }));
    });
    const shelf = editorStore.getState().shelf;
    expect(shelf).toHaveLength(1);
    const part = shelf[0]?.fragment;
    expect(part?.sequence.length).toBe(522 + TAIL.length);
    expect(part?.sequence.startsWith(TAIL)).toBe(true);
    expect(part?.left.kind).toBe('blunt');
    expect(part?.right.kind).toBe('blunt');
    expect(part?.source).toBe('pTest PCR product');
    expect(part?.features.filter((f) => f.type === 'primer_bind')).toHaveLength(2);
    act(() => {
      editorStore.clearShelf();
    });
  });

  it('amplifies from another open tab, without drawing on this one', () => {
    const other = SeqDocument.create({
      name: 'pOther',
      sequence: template(1500, 4242) + TEXT.slice(200, 722) + template(500, 99),
      topology: 'linear',
    });
    act(() => {
      editorStore.openDocument(other);
      editorStore.openDocument(doc);
    });
    render(<PcrPanel doc={doc} />);
    act(() => {
      fireEvent.change(screen.getByLabelText('Template'), {
        target: { value: editorStore.getState().documents[0]?.documentId },
      });
    });
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    // The same 522 bp stretch, where it sits in the other molecule.
    expect(screen.getByText('522 bp')).toBeInTheDocument();
    expect(screen.getByText('1,501–2,022')).toBeInTheDocument();
    // The views show pTest, so nothing is drawn and nothing offers to be.
    expect(preview()?.items ?? []).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    expect(
      screen.getByText(/products of pOther are listed here but not drawn/),
    ).toBeInTheDocument();
    // Back to this tab's own template.
    act(() => {
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: '' } });
    });
    expect(screen.getByText('201–722')).toBeInTheDocument();
    expect(preview()?.items.length).toBeGreaterThan(0);
  });

  it('amplifies what the two primers sit between', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    expect(screen.getByText('522 bp')).toBeInTheDocument();
    expect(screen.getByText('201–722')).toBeInTheDocument();
    expect(screen.getByText(/exact match/)).toBeInTheDocument();
  });

  it('reports a tail rather than refusing it', () => {
    setup();
    type('Forward primer', `${TAIL}${FWD}`);
    // The tail is nowhere on the template, so the site is where the rest of
    // the primer pairs and the report says the tail is there too.
    expect(screen.getByText(/31 nt, 9 of them a 5′ tail/)).toBeInTheDocument();
    type('Reverse primer', REV);
    expect(screen.getByText('531 bp')).toBeInTheDocument();
    expect(screen.getByText(/9 bp of tail/)).toBeInTheDocument();
  });

  it('draws every product and every site until one is picked', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    expect(preview()?.owner).toBe('pcr');
    expect(preview()?.items.map((s) => s.shape)).toEqual(['span', 'arrow', 'arrow']);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    });
    const shown = preview()?.items ?? [];
    expect(shown[0]?.label).toBe('Product 522 bp');
    expect(shown[0]?.range).toEqual({ start: 200, end: 722 });
    // Only the product is clickable; clicking a primer arrow in a view would
    // mean nothing.
    expect(shown.map((s) => s.clickable === true)).toEqual([true, false, false]);
  });

  it('opens the product, primers and all, when a previewed span is clicked', () => {
    setup();
    type('Forward primer', `${TAIL}${FWD}`);
    type('Reverse primer', REV);
    const id = preview()?.items[0]?.id;
    if (id === undefined) throw new Error('nothing previewed');
    act(() => {
      editorStore.activatePreview(id);
    });
    const opened = editorStore.document;
    expect(opened?.name).toBe('pTest PCR product');
    expect(opened?.length).toBe(531);
    expect(
      opened?.features
        .all()
        .filter((f) => f.type === 'primer_bind')
        .map((f) => f.name),
    ).toEqual(['Forward', 'Reverse']);
  });

  it('says what went wrong rather than nothing', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', TEXT.slice(700, 722));
    // Both read along the top strand, so neither can meet the other.
    expect(screen.getByText(/same strand of pTest/)).toBeInTheDocument();
    type('Reverse primer', 'ACGTACGT');
    expect(screen.getByText(/shorter than the 15 bases/)).toBeInTheDocument();
  });

  it('takes its preview off the views when the tab is left', () => {
    const view = setup();
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    expect(preview()).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(preview()).toBeNull();
  });
});
