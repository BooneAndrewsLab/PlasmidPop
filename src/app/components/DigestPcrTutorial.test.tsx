// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  activeEnzymes,
  digest,
  documentFromFragment,
  findCutSites,
  fragmentWithLineage,
  getEnzyme,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { editorStore } from '../state/editorStore';
import { CloningPanel } from './CloningPanel';

/**
 * The words of docs/tutorials/digest-pcr.md as the Cloning tab prints them,
 * with the tutorial's own files open and the enzymes and primers the page
 * asks for. The page has no NCBI path, so nothing here reads the gitignored
 * fixtures.
 */

const load = (name: string): SeqDocument => {
  const d = parseGenBank(
    readFileSync(join(__dirname, '../../../docs/tutorials/files', `${name}.gb`), 'utf8'),
  ).documents[0];
  if (d === undefined) throw new Error(name);
  return d;
};
const vector = load('pLig-Vector');
const template = load('SDM-Template');

const open = (doc: SeqDocument, reaction: 'digest' | 'pcr', ticked: string[] = []) => {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(
      doc,
      findCutSites(doc.sequence.toString().toUpperCase(), doc.topology, activeEnzymes()),
      [],
    );
    editorStore.setShownEnzymes(ticked);
    editorStore.setCloningReaction(reaction);
  });
  return render(<CloningPanel doc={doc} />);
};
const tick = (names: string[]) => {
  act(() => {
    editorStore.setShownEnzymes(names);
  });
};
const type = (label: string, value: string) => {
  act(() => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const rows = () => screen.queryAllByRole('listitem').map((li) => li.textContent);

describe('digest-pcr.md as the Cloning tab shows it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  afterEach(() => {
    act(() => {
      editorStore.clearShelf();
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('part 1: one cut, three fragments, a blunt end, the shelf', () => {
    const { container } = open(vector, 'digest', ['EcoRI']);
    expect(container.textContent).toContain('Digest with ticked enzymesEcoRI');
    expect(screen.getByText(/^1 fragment, largest first\./)).toBeInTheDocument();
    expect(rows()).toEqual([
      '2,664 bp234–233AddOpenEcoRI5′AATTEcoRI5′AATTsynthetic promoter, MCS, synthetic terminator, AmpR, +1 more',
    ]);

    tick(['EcoRI', 'XhoI']);
    expect(screen.getByText(/^3 fragments, largest first\./)).toBeInTheDocument();
    expect(rows()).toEqual([
      '1,275 bp654–1,928AddOpenXhoI5′TCGAXhoI5′TCGAAmpR, ori',
      '969 bp1,929–233AddOpenXhoI5′TCGAEcoRI5′AATTsynthetic promoter, MCS, ori',
      '420 bp234–653AddOpenEcoRI5′AATTXhoI5′TCGAMCS, synthetic terminator, AmpR',
    ]);

    tick(['EcoRI', 'EcoRV']);
    expect(screen.getByText(/^2 fragments, largest first\./)).toBeInTheDocument();
    expect(rows()).toEqual([
      '1,830 bp1,068–233AddOpenEcoRVbluntEcoRI5′AATTsynthetic promoter, MCS, AmpR, ori',
      '834 bp234–1,067AddOpenEcoRI5′AATTEcoRVbluntMCS, synthetic terminator, AmpR',
    ]);
    expect(screen.getByText('The shelf is empty.', { exact: false })).toBeInTheDocument();

    const small = within(screen.getAllByRole('listitem')[1] ?? document.body);
    act(() => {
      fireEvent.click(small.getByRole('button', { name: 'Add' }));
    });
    expect(small.getByRole('button', { name: 'Added ✓' })).toBeInTheDocument();
    expect(screen.getByText(/The shelf holds 1 part, 834 bp\./)).toBeInTheDocument();
    expect(small.getByText('On shelf')).toBeInTheDocument();
  });

  it('part 1: the blunted piece, nothing ticked, is one fragment and goes on the shelf', () => {
    const es = ['EcoRI', 'EcoRV'].map((n) => {
      const e = getEnzyme(n);
      if (e === undefined) throw new Error(n);
      return e;
    });
    const cuts = findCutSites(vector.sequence.toString().toUpperCase(), 'circular', es);
    const big = digest(vector, cuts).sort((a, b) => b.sequence.length - a.sequence.length)[0];
    if (big === undefined) throw new Error('no fragment');
    const filled = documentFromFragment(fragmentWithLineage(big, vector)).apply({
      type: 'bluntEnds',
      method: 'fill',
    });
    const { container } = open(filled, 'digest', []);
    expect(container.textContent).toContain('No enzyme is ticked.');
    expect(rows()).toEqual([expect.stringMatching(/^1,834 bp/)]);
    expect(rows()[0]).toContain('EcoRVbluntEcoRIblunt');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    expect(screen.getByText(/The shelf holds 1 part, 1,834 bp\./)).toBeInTheDocument();
  });

  it('part 1: nothing ticked, an uncut circle gives nothing to work with', () => {
    const { container } = open(vector, 'digest', []);
    expect(container.textContent).toContain(
      'No enzyme is ticked. Tick enzymes in the Enzymes tab to cut pLig-Vector with them.',
    );
    expect(rows()).toEqual([]);
  });

  it('part 2: the pair, the tails, the shelf and the three failures', () => {
    const { container } = open(template, 'pcr');
    expect(container.textContent).toContain('PCRtwo primers, one template');
    type('Forward primer', 'ATGGCAAGGGGGCGTCTGTG');
    expect(container.textContent).toContain('20 nt, Tm 63 °C · → 139–158');
    type('Reverse primer', 'TTATACTTCCACCAGAAGACGGTAACTG');
    expect(container.textContent).toContain('28 nt, Tm 59 °C · ← 414–441');
    expect(screen.getByText('One product:')).toBeInTheDocument();
    const [product] = screen.getByRole('list', { name: 'PCR products' }).querySelectorAll('li');
    expect(product?.textContent).toMatch(/^303 bp139–441exact matchShowShelveOpen/);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    });
    expect((editorStore.getState().preview?.items ?? []).map((s) => s.label)).toEqual([
      'Product 303 bp',
      'Forward',
      'Reverse',
    ]);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();

    type('Forward primer', 'GGGAATTCTTATGGCAAGGGGGCGTCTGTG');
    type('Reverse primer', 'GCGGATCCTTTTATACTTCCACCAGAAGACGGTAACTG');
    expect(container.textContent).toContain(
      '30 nt, 10 of them a 5′ tail, Tm 63 °C on the template, 67 °C once the product carries it · → 139–158',
    );
    expect(container.textContent).toContain(
      '38 nt, 10 of them a 5′ tail, Tm 59 °C on the template, 66 °C once the product carries it · ← 414–441',
    );
    const [tailed] = screen.getByRole('list', { name: 'PCR products' }).querySelectorAll('li');
    expect(tailed?.textContent).toMatch(/^323 bp139–441exact match, 20 bp of tailShowShelveOpen/);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Shelve' }));
    });
    expect(screen.getByText(/The shelf holds 1 part, 323 bp\./)).toBeInTheDocument();
    const part = editorStore.getState().shelf[0]?.fragment;
    expect(part?.left.kind).toBe('blunt');
    expect(part?.right.kind).toBe('blunt');
    expect(part?.dephosphorylated).toBe(true);

    // Open: a linear document of its own.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    });
    expect(editorStore.document?.name).toBe('SDM-Template PCR product');
    expect(editorStore.document?.length).toBe(323);
    expect(editorStore.document?.topology).toBe('linear');
  });

  it('part 2: the pair the same way round, the primer that does not anneal, the pair pointing away', () => {
    const { container } = open(template, 'pcr');
    type('Forward primer', 'ATGGCAAGGGGGCGTCTGTG');
    type('Reverse primer', 'CAGTTACCGTCTTCTGGTGGAAGTATAA');
    expect(container.textContent).toContain(
      'Both primers anneal to the same strand of SDM-Template, so they both copy the same way and nothing is amplified. One of them wants reverse-complementing.',
    );
    expect(screen.queryByRole('button', { name: 'Shelve' })).toBeNull();

    type('Forward primer', 'ACGTACGTACGTACGTACGTAC');
    type('Reverse primer', 'TTATACTTCCACCAGAAGACGGTAACTG');
    expect(container.textContent).toContain(
      '22 nt — no 3′ end long enough to prime. The last 5 bases have to match exactly.',
    );
    expect(container.textContent).toContain(
      'Forward does not anneal to SDM-Template, so there is nothing for the other primer to meet.',
    );

    type('Forward primer', 'CAGTTACCGTCTTCTGGTGGAAGTATAA');
    type('Reverse primer', 'CACAGACGCCCCCTTGCCAT');
    const [away] = screen.getByRole('list', { name: 'PCR products' }).querySelectorAll('li');
    expect(away?.textContent).toMatch(/^986 bp414–158, over the origin/);
  });
});
