// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';

import { analysisClient } from '@/workers/analysisClient';

import { editorStore } from '../state/editorStore';
import { CrisprPanel } from './CrisprPanel';

/** One SpCas9 site: 20 A's and a TGG PAM, then filler with no GG or CC. */
const UNIT = `${'A'.repeat(20)}TGG`;
const FILLER = 'CTCTCTCTCT';

function docOf(sequence: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence, topology, name: 'test' });
}

async function openPanel(doc: SeqDocument) {
  act(() => {
    editorStore.openDocument(doc);
  });
  const view = render(<CrisprPanel doc={doc} />);
  // The scan is a worker request even in tests, where it runs inline on a
  // promise: wait for it rather than for a result, since a document with no
  // guides at all is one of the things worth testing.
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
  return view;
}

describe('CrisprPanel', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('lists the guides and draws them on the views while open', async () => {
    const doc = docOf(`${UNIT}${FILLER}${reverseComplement(UNIT)}`);
    const view = await openPanel(doc);

    // One guide on each strand: the second unit is the first's reverse complement.
    await waitFor(() => {
      expect(editorStore.getState().preview?.items).toHaveLength(2);
    });
    const preview = editorStore.getState().preview;
    expect(preview?.owners).toEqual(['crispr']);
    expect(preview?.items.map((i) => [i.label, i.strand, i.shape])).toEqual([
      ['TGG', 'forward', 'arrow'],
      ['TGG', 'reverse', 'arrow'],
    ]);

    // Clicking one on a view opens it here and selects the protospacer.
    const first = preview?.items[0];
    if (first === undefined) throw new Error('no guide was previewed');
    act(() => {
      editorStore.activatePreview(first.id);
    });
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 20 });
    expect(await screen.findByText('Protospacer')).toBeInTheDocument();

    // Leaving the tab takes the arrows off the views.
    view.unmount();
    expect(editorStore.getState().preview).toBeNull();
  });

  it('counts a guide that binds elsewhere exactly, and says so', async () => {
    const doc = docOf(`${UNIT}${FILLER}${UNIT}`);
    await openPanel(doc);
    // Both guides share the same spacer, so each is the other's off-target.
    const rows = await screen.findAllByTitle('Off-targets: exact, then by mismatch');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1·0·0·0');
    // The exact second site is the first of the flags; the all-A spacer has others.
    expect(screen.getAllByTitle(/^Binds somewhere else exactly;/)).toHaveLength(2);
  });

  it('filters the list by PAM, by spacer and by flag without rescanning', async () => {
    // Two clean guides with different PAMs, and a third that is all one base.
    const clean1 = 'ACGTACGTACGTACGTACGT';
    const clean2 = 'GATCGATCGATCGATCGATC';
    await openPanel(docOf(`${clean1}AGG${FILLER}${clean2}TGG${FILLER}${UNIT}`));
    const rows = () => screen.getAllByTitle('Off-targets: exact, then by mismatch');
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByLabelText('Hide flagged guides'));
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('2 of 3')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('PAM'), { target: { value: 'TGG' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /GATCGATC/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('PAM'), { target: { value: '' } });
    // IUPAC: R is A or G, so this is in the first spacer and not the second.
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'crta' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: /ACGTACGT/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'X' } });
    expect(screen.getByText('No guides match the filters.')).toBeInTheDocument();
  });

  it('opens the chosen guide under its own row, without scanning again', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openPanel(docOf(`${UNIT}${FILLER}${UNIT}`));
    const [first, second] = await screen.findAllByRole('button', { name: /A{20}/ });
    if (first === undefined || second === undefined) throw new Error('two rows expected');
    expect(scans).toHaveBeenCalledTimes(1);
    fireEvent.click(second);
    // A click changes the selection, which is not part of the question asked.
    expect(scans).toHaveBeenCalledTimes(1);
    // The detail is the second row's sibling, not something after the list.
    await waitFor(() => {
      expect(second.parentElement?.querySelector('.crispr-detail')).not.toBeNull();
    });
    expect(first.parentElement?.querySelector('.crispr-detail')).toBeNull();
  });

  it('says plainly that it has no genome to search', async () => {
    await openPanel(docOf(`${UNIT}${FILLER}`));
    expect(screen.getByText(/no genome to search/)).toBeInTheDocument();
  });

  it('refuses a custom PAM that is not IUPAC, and scans once it is', async () => {
    // TGA is no PAM for SpCas9, but it is one for a custom NGA.
    await openPanel(docOf(`${'A'.repeat(20)}TGA${FILLER}`, 'linear'));
    expect(screen.getByText(/No guides/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'custom' } });
    const pam = screen.getByLabelText('PAM in IUPAC codes');
    fireEvent.change(pam, { target: { value: 'NXG' } });
    expect(await screen.findByText(/not an IUPAC base/)).toBeInTheDocument();
    expect(screen.queryByText('Guides')).not.toBeInTheDocument();

    fireEvent.change(pam, { target: { value: 'NGA' } });
    expect(await screen.findByText('Guides')).toBeInTheDocument();
  });

  it('writes the pX330 oligos for the guide chosen', async () => {
    const spacer = 'ACCTGCATTGGCATTGCATT';
    await openPanel(docOf(`${spacer}TGG${FILLER}`));
    fireEvent.click(await screen.findByRole('button', { name: /ACCTGCATTGGCATTGCATT/ }));

    expect(await screen.findByText('Oligos to order')).toBeInTheDocument();
    // The U6 promoter wants a G, which this spacer has not got.
    expect(screen.getByText('CACCGACCTGCATTGGCATTGCATT')).toBeInTheDocument();
    expect(screen.getByText('AAACAATGCAATGCCAATGCAGGTC')).toBeInTheDocument();
  });

  it('holds the region it was narrowed to while guides in it are clicked', async () => {
    // Three guides, cutting at 17, 50 and 83; a selection over the last two.
    await openPanel(docOf([UNIT, UNIT, UNIT].join(FILLER)));
    act(() => {
      editorStore.setSelection({ start: 40, end: 89 });
    });
    fireEvent.click(screen.getByLabelText('Only cuts in the selection'));
    await waitFor(() => {
      expect(screen.getAllByTitle('Off-targets: exact, then by mismatch')).toHaveLength(2);
    });

    // Clicking a guide selects its protospacer. Were the region read from
    // the selection, the other guide would drop out of the list it was
    // clicked in and the selection to get back to would be gone.
    const [first] = screen.getAllByRole('button', { name: /AAAAAAAAAAAAAAAAAAAA/ });
    if (first === undefined) throw new Error('no guide was listed');
    fireEvent.click(first);
    expect(editorStore.getState().selection).toEqual({ start: 33, end: 53 });
    expect(await screen.findByText('Oligos to order')).toBeInTheDocument();
    expect(screen.getAllByTitle('Off-targets: exact, then by mismatch')).toHaveLength(2);
    expect(screen.getByLabelText('Only cuts in the selection')).toBeChecked();

    // A new selection is taken up only when asked for.
    act(() => {
      editorStore.setSelection({ start: 0, end: 30 });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Use the selection now' }));
    await waitFor(() => {
      expect(screen.getAllByTitle('Off-targets: exact, then by mismatch')).toHaveLength(1);
    });
  });

  it('drops the Cas9 sgRNA overhangs for a nuclease they would not clone', async () => {
    await openPanel(docOf(`TTTA${'A'.repeat(23)}${FILLER}`));
    fireEvent.change(screen.getByLabelText('Nuclease'), { target: { value: 'ascas12a' } });
    fireEvent.click(await screen.findByRole('button', { name: /A{23}/ }));

    const overhangs = await screen.findByLabelText('Overhangs');
    expect([...overhangs.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'No overhangs',
    ]);
  });

  it('adds the chosen guide to the document as a feature', async () => {
    const doc = docOf(`${UNIT}${FILLER}`);
    await openPanel(doc);
    fireEvent.click(await screen.findByRole('button', { name: /AAAAAAAAAAAAAAAAAAAA/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add as feature' }));

    const state = editorStore.getState().documents[0];
    if (state === undefined) throw new Error('the document was not opened');
    const features = [...state.history.present.features.all()];
    expect(features).toHaveLength(1);
    expect(features[0]?.strand).toBe('forward');
    expect(features[0]?.segments).toMatchObject([{ start: 0, end: 20 }]);
    expect(features[0]?.qualifiers).toContainEqual({
      name: 'note',
      value: 'CRISPR protospacer, TGG PAM',
    });
  });
});
