// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';
import { getRepository } from '@/storage';

import type * as SaveFile from '../saveFile';
import { downloadText } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { primerCollection } from '../state/primerCollection';
import { FeatureEditor } from './FeatureEditor';
import { PcrPanel } from './PcrPanel';
import { PrimerPanel } from './PrimerPanel';

vi.mock('../saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveFile>()),
  downloadText: vi.fn(),
}));

/** A fixed pseudo-random plasmid, so no site is there by coincidence. */
function template(length: number, seed = 6464): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const TEXT = template(1500);
const L = TEXT.length;
const doc = SeqDocument.create({ name: 'pColl', sequence: TEXT, topology: 'circular' });

const FWD = TEXT.slice(100, 121);
const REV = reverseComplement(TEXT.slice(600, 621));
/** A forward primer through the origin: 8 bases before it, 12 after. */
const ORIGIN = TEXT.slice(L - 8) + TEXT.slice(0, 12);

/** The first of the elements found, which a test expects to be there. */
function first(elements: readonly HTMLElement[]): HTMLElement {
  const [element] = elements;
  if (element === undefined) throw new Error('nothing found');
  return element;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function setup(d: SeqDocument = doc) {
  act(() => {
    editorStore.openDocument(d);
  });
  const view = render(<PrimerPanel doc={d} />);
  await settle();
  return view;
}

async function paste(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(/FASTA, CSV/), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add pasted' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function findMine(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(/Find my primers in/));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const LIST = `name,sequence,notes\nfwd1,${FWD},lab stock\nrev1,${REV},\nori,${ORIGIN},over the origin\nstray,${template(20, 99)},\n`;

describe('My primers', () => {
  beforeEach(async () => {
    await primerCollection.load();
    await primerCollection.remove(primerCollection.getState().primers.map((p) => p.id));
    forgetPanels();
  });

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('adds a pasted list, keeps it in IndexedDB, and leaves out what is already there', async () => {
    await setup();
    await paste(LIST);
    const list = screen.getByRole('list', { name: 'My primers' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('lab stock')).toBeTruthy();
    expect(await screen.findByText(/Added 4 primers/)).toBeTruthy();
    expect((await getRepository().loadPrimers()).map((p) => p.name)).toEqual([
      'fwd1',
      'rev1',
      'ori',
      'stray',
    ]);
    await paste(LIST);
    expect(await screen.findByText(/No primer added; 4 already in the list/)).toBeTruthy();
  });

  it('finds where the primers bind, both strands and through the origin, as a preview', async () => {
    await setup();
    await paste(LIST);
    await findMine();
    const sites = await screen.findByRole('list', { name: 'Primer sites' });
    const rows = within(sites).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^→fwd1 101–121exact/),
      expect.stringMatching(/^←rev1 601–621exact/),
      expect.stringMatching(/^→ori 1,493–12exact/),
    ]);
    expect(screen.getByText(/3 primers bind at 3 sites/)).toBeTruthy();
    const preview = editorStore.getState().preview;
    expect(preview?.owners).toContain('collection');
    expect(preview?.items.map((s) => [s.label, s.range.start, s.range.end, s.strand])).toEqual([
      ['fwd1', 100, 121, 'forward'],
      ['rev1', 600, 621, 'reverse'],
      ['ori', L - 8, L + 12, 'forward'],
    ]);
    // Nothing is in the document until asked for.
    expect(editorStore.document?.features.size).toBe(0);
  });

  it('adds every site as a primer_bind feature in one undo step', async () => {
    await setup();
    await paste(LIST);
    await findMine();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add all sites as primer_bind' }));
    });
    const features = editorStore.document?.features.all() ?? [];
    expect(features.map((f) => [f.type, f.name, f.strand])).toEqual(
      expect.arrayContaining([
        ['primer_bind', 'fwd1', 'forward'],
        ['primer_bind', 'rev1', 'reverse'],
        ['primer_bind', 'ori', 'forward'],
      ]),
    );
    const fwd = features.find((f) => f.name === 'fwd1');
    expect(fwd?.qualifiers).toEqual([
      { name: 'note', value: `sequence: ${FWD}` },
      { name: 'note', value: 'lab stock' },
    ]);
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.features.size).toBe(0);
  });

  it('respects the mismatch limit', async () => {
    // Ten bases from the 3′ end: with no mismatch allowed, too little is left to anneal.
    const mutated = `${TEXT.slice(0, 110)}${TEXT.charAt(110) === 'A' ? 'C' : 'A'}${TEXT.slice(111)}`;
    await setup(SeqDocument.create({ name: 'pMut', sequence: mutated, topology: 'circular' }));
    await paste(`fwd1 ${FWD}\n`);
    await findMine();
    expect(await screen.findByText(/1 primer binds at 1 site/)).toBeTruthy();
    expect(screen.getByText('1 mm')).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Mismatches allowed'), { target: { value: '0' } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText(/None of them binds pMut/)).toBeTruthy();
  });

  it('hands a primer to PCR, which amplifies with it under its name', async () => {
    const view = await setup();
    await paste(LIST);
    await findMine();
    const sites = await screen.findByRole('list', { name: 'Primer sites' });
    act(() => {
      fireEvent.click(first(within(sites).getAllByRole('button', { name: 'PCR fwd' })));
      fireEvent.click(within(sites).getByRole('button', { name: 'PCR rev' }));
    });
    expect(screen.getByText(/PCR: forward fwd1, reverse rev1/)).toBeTruthy();
    view.unmount();
    render(<PcrPanel doc={doc} />);
    expect(screen.getByText('Forward primer · fwd1')).toBeTruthy();
    expect(screen.getByText('Reverse primer · rev1')).toBeTruthy();
    expect(screen.getByText('One product:')).toBeTruthy();
    expect(editorStore.getState().preview?.items.map((s) => s.label)).toEqual(
      expect.arrayContaining(['fwd1', 'rev1']),
    );
  });

  it('downloads the list as CSV and as FASTA', async () => {
    await setup();
    await paste(LIST);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
      fireEvent.click(screen.getByRole('button', { name: 'Download FASTA' }));
    });
    const calls = vi.mocked(downloadText).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(['primers.csv', 'primers.fasta']);
    expect(calls[0]?.[1]).toContain(`fwd1,${FWD},lab stock`);
    expect(calls[1]?.[1]).toContain(`>ori over the origin\n${ORIGIN}\n`);
  });

  it('edits and deletes a primer', async () => {
    await setup();
    await paste(`fwd1 ${FWD}\nrev1 ${REV}\n`);
    const list = screen.getByRole('list', { name: 'My primers' });
    act(() => {
      fireEvent.click(first(within(list).getAllByRole('button', { name: 'Edit' })));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Primer name'), { target: { value: 'fwd-renamed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete rev1' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((await getRepository().loadPrimers()).map((p) => p.name)).toEqual(['fwd-renamed']);
  });

  it('saves a designed pair and a checked primer', async () => {
    await setup();
    act(() => {
      editorStore.setSelection({ start: 400, end: 700 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    await act(async () => {
      fireEvent.click(first(screen.getAllByRole('button', { name: 'Save both' })));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      await screen.findByText('Saved pColl fwd 1 and pColl rev 1 to My primers.'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Primer sequence'), { target: { value: FWD } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to My primers' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText('Saved Primer 1 to My primers.')).toBeTruthy();
    const stored = await getRepository().loadPrimers();
    expect(stored.map((p) => p.name)).toEqual(['pColl fwd 1', 'pColl rev 1', 'Primer 1']);
    expect(stored[0]?.notes).toMatch(/^Designed for pColl 401–700; Tm /);
  });

  it('takes a primer_bind feature, with the oligo its note carries', async () => {
    const feature = createFeature({
      type: 'primer_bind',
      name: 'BamHI-fwd',
      strand: 'forward',
      segments: [rangeSegment(100, 121)],
      qualifiers: [{ name: 'note', value: `sequence: GGATCC${FWD}` }],
    });
    const withPrimer = doc.addFeature(feature);
    act(() => {
      editorStore.openDocument(withPrimer);
    });
    render(<FeatureEditor doc={withPrimer} feature={feature} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to My primers' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText(/Saved to My primers\./)).toBeTruthy();
    expect((await getRepository().loadPrimers()).map((p) => [p.name, p.sequence])).toEqual([
      ['BamHI-fwd', `GGATCC${FWD}`],
    ]);
  });
});
