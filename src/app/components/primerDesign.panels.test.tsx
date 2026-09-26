// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  SeqDocument,
  createFeature,
  designMutagenesis,
  designOverlapPrimers,
  findAnnealingSites,
  meltingTemperature,
  rangeSegment,
  reverseComplement,
} from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import type * as Clipboard from '../clipboard';
import { copyText } from '../clipboard';
import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { MutagenesisPanel } from './MutagenesisPanel';
import { OverlapPrimerDesign } from './OverlapPrimerDesign';
import { PcrPanel } from './PcrPanel';

vi.mock('../clipboard', async (importOriginal) => ({
  ...(await importOriginal<typeof Clipboard>()),
  copyText: vi.fn(),
}));

/**
 * Every control and state of the three primer-design panels added in 1.4:
 * site-directed mutagenesis (#61), In-Fusion / NEBuilder insert primers
 * (#63) and PCR II (#14: polymerase, phosphorylated primers, primer dimers,
 * the two Tms). Each is driven the way a user would — a selection in the
 * store, text typed in a box, a button pressed — and checked against what
 * the core functions say for the same input, so the panel is tested for
 * saying what the design is rather than for a design of its own.
 *
 * Sequences come from a seeded mulberry32 (`@/test/random`) so every primer
 * site is unique. The clipboard is mocked: jsdom has none, and what matters
 * is which oligo a Copy button hands over.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const copied = vi.mocked(copyText);

const TEXT = randomDna(seededRandom(8675309), 2000).toLowerCase();
const CDS = 'ATGAAAGAATTTTAA'; // M K E F *
const MUT_TEXT = TEXT.slice(0, 500) + CDS.toLowerCase() + TEXT.slice(515);
const plasmid = SeqDocument.create({
  name: 'pTest',
  sequence: MUT_TEXT,
  topology: 'circular',
  features: [createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(500, 515)] })],
});

function closeAll(): void {
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    editorStore.clearShelf();
    editorStore.restoreBench(DEFAULT_BENCH);
  });
  copied.mockClear();
}

function select(start: number, end: number): void {
  act(() => {
    editorStore.setSelection({ start, end });
  });
}

function type(label: string, value: string): void {
  act(() => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
}

function click(name: string | RegExp): void {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('MutagenesisPanel', () => {
  afterEach(closeAll);

  function setup(doc: SeqDocument = plasmid) {
    act(() => {
      editorStore.openDocument(doc);
    });
    return render(<MutagenesisPanel doc={doc} />);
  }

  const primerList = () => screen.queryByRole('list', { name: 'Mutagenesis primers' });

  it('asks for a selection, and designs nothing without one', () => {
    setup();
    expect(
      screen.getByText(
        'Select the bases to change in pTest, or put the cursor where new bases go.',
      ),
    ).toBeInTheDocument();
    type('Change to', 'GGG');
    expect(primerList()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open mutant' })).toBeNull();
  });

  it('inserts at a caret, only once there are bases, cleaning what is typed', () => {
    setup();
    select(1200, 1200);
    expect(screen.getByText('Insert after base 1,200.')).toBeInTheDocument();
    const box = screen.getByLabelText('Bases to insert');
    expect(box).toHaveAttribute('placeholder', 'e.g. a tag');
    // An empty box at a caret is no change at all.
    expect(primerList()).toBeNull();
    // Junk and spaces go; case and ambiguity codes stay as bases.
    type('Bases to insert', 'gg c-x1n');
    expect(screen.getByText('+GGCN after 1,200')).toBeInTheDocument();
    const d = designMutagenesis(plasmid, { start: 1200, end: 1200 }, 'GGCN', 'back-to-back');
    const list = within(must(primerList(), 'the primers'));
    expect(list.getByText(d.forward.sequence)).toBeInTheDocument();
    expect(list.getByText(d.reverse.sequence)).toBeInTheDocument();
    expect(d.forward.sequence.startsWith('GGCN')).toBe(true);
  });

  it('deletes the selection when the box is left empty', () => {
    setup();
    select(1300, 1330);
    // Too long to spell out, so only its length and start.
    expect(screen.getByText('Change 30 bp at 1,301.')).toBeInTheDocument();
    expect(screen.getByLabelText('Change to')).toHaveAttribute(
      'placeholder',
      'leave empty to delete',
    );
    expect(screen.getByText('Δ1,301–1,330')).toBeInTheDocument();
    click('Open mutant');
    expect(editorStore.document?.length).toBe(MUT_TEXT.length - 30);
    expect(editorStore.document?.name).toBe('pTest Δ1,301–1,330');
  });

  it('spells out a short selection, and designs nothing for a change to the same bases', () => {
    setup();
    select(800, 803);
    const old = MUT_TEXT.slice(800, 803).toUpperCase();
    expect(screen.getByText(`Change 3 bp at 801 (${old}).`)).toBeInTheDocument();
    // Typed in lower case it is still the same bases: nothing to design.
    type('Change to', old.toLowerCase());
    expect(primerList()).toBeNull();
    type('Change to', old.slice(0, 2));
    expect(primerList()).not.toBeNull();
  });

  it('switches between the two designs, and says how each is used', () => {
    setup();
    select(900, 901);
    const next = MUT_TEXT.charAt(900).toUpperCase() === 'G' ? 'T' : 'G';
    type('Change to', next);
    const b2b = screen.getByRole('button', { name: 'Back to back' });
    const over = screen.getByRole('button', { name: 'Overlapping' });
    expect(b2b).toHaveAttribute('aria-pressed', 'true');
    expect(over).toHaveAttribute('aria-pressed', 'false');
    const back = designMutagenesis(plasmid, { start: 900, end: 901 }, next, 'back-to-back');
    const list = () => within(must(primerList(), 'the primers'));
    expect(
      list().getByText(
        // NEB's own Tm for Q5 stands beside the nearest-neighbour one (#69).
        `${back.forward.sequence.length} nt, Tm ${back.forward.tm.toFixed(0)} °C (NEB Q5 ${back.forward.q5Tm?.toFixed(0) ?? ''} °C) over the ${back.forward.annealLength} that anneal`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/phosphorylate, ligate and digest the template \(KLD\)/),
    ).toBeInTheDocument();

    click('Overlapping');
    expect(over).toHaveAttribute('aria-pressed', 'true');
    expect(b2b).toHaveAttribute('aria-pressed', 'false');
    const quik = designMutagenesis(plasmid, { start: 900, end: 901 }, next, 'overlapping');
    expect(
      list().getAllByText(
        `${quik.forward.sequence.length} nt, Tm ${quik.forward.tm.toFixed(0)} °C (Agilent)`,
      ),
    ).toHaveLength(2);
    expect(list().getByText(quik.reverse.sequence)).toBeInTheDocument();
    expect(screen.getByText(/digest the template with DpnI/)).toBeInTheDocument();
    expect(screen.queryByText(/\(KLD\)/)).toBeNull();
  });

  it('names what the change does to the CDS it falls in', () => {
    setup();
    select(504, 505);
    type('Change to', 'G');
    // AAA → AGA: the second residue, K, becomes R.
    expect(screen.getByText('A505G').closest('p')).toHaveTextContent('A505G · orf K2R');
    type('Change to', '');
    expect(screen.getByText('Δ505').closest('p')).toHaveTextContent(
      'Δ505 · orf frameshift from E3',
    );
    select(1500, 1501);
    type('Change to', MUT_TEXT.charAt(1500) === 'a' ? 'C' : 'A');
    expect(screen.queryByText(/ · orf/)).toBeNull();
  });

  it('copies each primer as it would be ordered', () => {
    setup();
    select(700, 701);
    const next = MUT_TEXT.charAt(700) === 'a' ? 'C' : 'A';
    type('Change to', next);
    const d = designMutagenesis(plasmid, { start: 700, end: 701 }, next, 'back-to-back');
    click('Copy the forward primer');
    click('Copy the reverse primer');
    expect(copied.mock.calls).toEqual([[d.forward.sequence], [d.reverse.sequence]]);
  });

  it('opens the mutant as one edit that Undo takes back', () => {
    setup();
    select(1000, 1000);
    type('Bases to insert', 'GACTACAAAGACGATGACGACAAG');
    click('Open mutant');
    const opened = must(editorStore.document, 'the mutant');
    expect(opened.name).toBe('pTest +GACTACAAAGACGATGACGACAAG after 1,000');
    expect(opened.sequence.toString()).toBe(
      MUT_TEXT.slice(0, 1000) + 'GACTACAAAGACGATGACGACAAG' + MUT_TEXT.slice(1000),
    );
    expect(editorStore.getState().documents).toHaveLength(2);
    expect(editorStore.getState().sidebarTab).toBe('features');
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.sequence.toString()).toBe(MUT_TEXT);
  });

  it('warns when the design falls short of its temperature', () => {
    const at = SeqDocument.create({
      name: 'pAT',
      sequence: TEXT.slice(0, 800) + 'at'.repeat(60) + TEXT.slice(800),
      topology: 'circular',
    });
    setup(at);
    select(860, 861);
    type('Change to', 'G');
    expect(screen.getByText(/too AT-rich to reach 60 °C within 60 bases/)).toHaveClass(
      'panel__note--warn',
    );
  });
});

describe('OverlapPrimerDesign', () => {
  afterEach(closeAll);

  const vectorText = randomDna(seededRandom(31), 1500).toLowerCase();
  const sourceText = randomDna(seededRandom(77), 2500);
  const vector = SeqDocument.create({ name: 'pCut', sequence: vectorText, topology: 'linear' });
  const source = SeqDocument.create({ name: 'gDNA', sequence: sourceText, topology: 'linear' });

  function setup(docs: readonly SeqDocument[], selection: { start: number; end: number } | null) {
    act(() => {
      for (const d of docs) editorStore.openDocument(d);
      if (selection !== null) editorStore.setSelection(selection);
    });
    render(<OverlapPrimerDesign />);
    act(() => {
      screen
        .getByText('Design insert primers (In-Fusion, NEBuilder)')
        .closest('details')
        ?.setAttribute('open', '');
    });
    return editorStore.getState().documents.map((d) => d.documentId);
  }

  function pick(vectorId: string | undefined, templateId: string | undefined): void {
    act(() => {
      fireEvent.change(screen.getByLabelText('Linearised vector'), {
        target: { value: vectorId ?? '' },
      });
      fireEvent.change(screen.getByLabelText('Insert from'), {
        target: { value: templateId ?? '' },
      });
    });
  }

  it('explains itself until both tabs are chosen, in the chosen kit’s terms', () => {
    const ids = setup([vector, source], { start: 400, end: 1200 });
    expect(
      screen.getByText(/get 15 bases of the vector’s ends.*In-Fusion asks for/s),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'In-Fusion' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    click('NEBuilder HiFi');
    expect(screen.getByRole('button', { name: 'NEBuilder HiFi' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(/get 20 bases of the vector’s ends.*NEBuilder HiFi asks for/s),
    ).toBeInTheDocument();
    // One tab picked for both is not a design either.
    pick(ids[1], ids[1]);
    expect(screen.queryByRole('list', { name: 'Insert primers' })).toBeNull();
    expect(screen.getByText(/Choose the linearised vector/)).toBeInTheDocument();
    // Both option lists name every open tab.
    const options = within(screen.getByLabelText('Linearised vector')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['choose a tab', 'pCut', 'gDNA']);
  });

  it('picks the insert here: the selection, a feature, or all of a linear template', () => {
    const annotated = source.addFeature(
      createFeature({ type: 'gene', name: 'lacZ', segments: [rangeSegment(1000, 1600)] }),
    );
    // Only a caret in the template's tab: no selection to offer.
    const ids = setup([vector, annotated], { start: 700, end: 700 });
    pick(ids[0], ids[1]);
    const options = () =>
      within(screen.getByRole('combobox', { name: 'Insert' }))
        .getAllByRole('option')
        .map((o) => o.textContent);
    expect(options()).toEqual([
      'lacZ (gene), 1,001–1,600, 600 bp',
      'All of it (1–2,500, 2,500 bp)',
    ]);
    // The first choice is taken until another is picked.
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,100 bp, circular');
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Insert' }), {
        target: { value: 'whole' },
      });
    });
    expect(screen.getByLabelText('Product')).toHaveTextContent('4,000 bp, circular');
    // A selection made in the template's tab comes first once there is one.
    act(() => {
      editorStore.setSelection({ start: 400, end: 1200 });
    });
    expect(options()[0]).toBe('The selection (401–1,200, 800 bp)');
    expect(editorStore.getState().bench.overlap.insert).toBe('whole');
  });

  it('says what to do when a circular template has no selection and no features', () => {
    const ring = SeqDocument.create({
      name: 'pTemplate',
      sequence: sourceText,
      topology: 'circular',
    });
    const ids = setup([vector, ring], { start: 700, end: 700 });
    pick(ids[0], ids[1]);
    expect(screen.getByText(/pTemplate has nothing selected and no features/)).toBeInTheDocument();
  });

  it('says why a circular vector cannot be used', () => {
    const ring = SeqDocument.create({ name: 'pRing', sequence: vectorText, topology: 'circular' });
    const ids = setup([ring, source], { start: 400, end: 1200 });
    pick(ids[0], ids[1]);
    expect(screen.getByText(/pRing is circular, so it has no ends/)).toHaveClass('panel__error');
    expect(screen.queryByRole('button', { name: 'Open product' })).toBeNull();
  });

  it('lists both primers with their make-up, copies them, and opens the circle', () => {
    const ids = setup([vector, source], { start: 400, end: 1200 });
    pick(ids[0], ids[1]);
    const d = designOverlapPrimers(vector, source, { start: 400, end: 1200 }, 'in-fusion');
    const list = within(screen.getByRole('list', { name: 'Insert primers' }));
    for (const p of [d.forward, d.reverse]) {
      expect(
        list.getByText(
          `${p.sequence.length} nt: ${p.tail.length} of vector, ${p.annealLength} annealing at ${p.tm.toFixed(0)} °C`,
        ),
      ).toBeInTheDocument();
      expect(list.getByText(p.sequence)).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,300 bp, circular');
    click('Copy the forward primer');
    click('Copy the reverse primer');
    expect(copied.mock.calls).toEqual([[d.forward.sequence], [d.reverse.sequence]]);
    click('Open product');
    const opened = must(editorStore.document, 'the product');
    expect(opened.isCircular).toBe(true);
    expect(opened.length).toBe(2300);
    expect(editorStore.getState().documents).toHaveLength(3);
  });
});

describe('PcrPanel, PCR II', () => {
  afterEach(closeAll);

  const text = randomDna(seededRandom(4242), 7000);
  const doc = SeqDocument.create({ name: 'pBig', sequence: text, topology: 'circular' });
  const FWD = text.slice(200, 222);
  const REV = reverseComplement(text.slice(700, 722));

  function setup() {
    act(() => {
      editorStore.openDocument(doc);
    });
    return render(<PcrPanel doc={doc} />);
  }

  const polymeraseBox = () => screen.getByRole('combobox', { name: 'Polymerase' });
  const setPolymerase = (value: string) => {
    act(() => {
      fireEvent.change(polymeraseBox(), { target: { value } });
    });
  };

  it('offers both polymerases, proofreading first, and says what each does under it', () => {
    setup();
    // The options are names, short enough for the sidebar; the ends and the
    // reach are said in a line under the select.
    const options = within(polymeraseBox()).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Proofreading', 'Taq']);
    expect(polymeraseBox()).toHaveValue('proofreading');
    expect(screen.getByText(/blunt ends, products up to 20 kb/)).toBeInTheDocument();
    setPolymerase('taq');
    expect(
      screen.getByText(/One 3′ A on each end, for TA cloning, products up to 5 kb/),
    ).toBeInTheDocument();
  });

  it('gives up on a product past Taq’s reach, and takes it back with proofreading', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', reverseComplement(text.slice(5678, 5700)));
    expect(screen.getByText('5,500 bp')).toBeInTheDocument();
    setPolymerase('taq');
    expect(screen.getByText(/longer than 5,000 bp/)).toHaveClass('panel__error');
    setPolymerase('proofreading');
    expect(screen.getByText('5,500 bp')).toBeInTheDocument();
  });

  it('shelves a Taq product with its A overhangs, phosphorylated or not', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    setPolymerase('taq');
    const box = screen.getByRole('checkbox', { name: '5′-phosphorylated primers' });
    expect(box).not.toBeChecked();
    click('Shelve');
    act(() => {
      fireEvent.click(box);
    });
    expect(box).toBeChecked();
    click('Shelve');
    act(() => {
      fireEvent.click(box);
    });
    click('Shelve');
    const shelf = editorStore.getState().shelf.map((s) => s.fragment);
    expect(shelf.map((f) => f.dephosphorylated)).toEqual([true, undefined, true]);
    for (const f of shelf) {
      expect(f.sequence).toBe(`${text.slice(200, 722)}A`);
      expect(f.left).toEqual({ kind: "3'", overhang: 'T', enzyme: null });
      expect(f.right).toEqual({ kind: "3'", overhang: 'A', enzyme: null });
    }
  });

  it('lists primer dimers, a primer with itself too, and clears them when fixed', () => {
    setup();
    type('Forward primer', FWD);
    type('Reverse primer', REV);
    expect(screen.queryByRole('list', { name: 'Primer dimers' })).toBeNull();
    // A 3′ end that is its own reverse complement pairs with a copy of itself.
    type('Forward primer', `${FWD}GAATTC`);
    const list = () => within(screen.getByRole('list', { name: 'Primer dimers' }));
    expect(
      list().getByText(
        'The last 6 bases of the forward primer pair with a second copy of itself, so they can prime each other into a primer dimer.',
      ),
    ).toBeInTheDocument();
    type('Forward primer', FWD);
    type('Reverse primer', REV + reverseComplement(FWD.slice(-7)));
    expect(
      list().getByText(/^The last 7 bases of the reverse primer pair with the forward primer,/),
    ).toBeInTheDocument();
    type('Reverse primer', REV);
    expect(screen.queryByRole('list', { name: 'Primer dimers' })).toBeNull();
  });

  it('gives one Tm for a clean primer and two for a tailed or mismatched one', () => {
    setup();
    type('Forward primer', FWD);
    const [clean] = findAnnealingSites(text, 'circular', FWD);
    expect(
      screen.getByText(
        new RegExp(`^22 nt, Tm ${must(clean, 'a site').tm.toFixed(0)} °C · → 201–222$`),
      ),
    ).toBeInTheDocument();

    // An EcoRI site and a clamp of a base none of the three template bases
    // before the site is, so no tail base pairs and the tail is all tail.
    const clamp = must(
      ['A', 'C', 'G', 'T'].find((b) => !text.slice(197, 200).includes(b)),
      'a base',
    );
    const tail = `GAATTC${clamp.repeat(3)}`;
    type('Forward primer', tail + FWD);
    const tailed = must(findAnnealingSites(text, 'circular', tail + FWD)[0], 'a site');
    const later = meltingTemperature(tail + FWD).toFixed(0);
    expect(
      screen.getByText(
        `31 nt, 9 of them a 5′ tail, Tm ${tailed.templateTm.toFixed(0)} °C on the template, ${later} °C once the product carries it · → 201–222`,
      ),
    ).toBeInTheDocument();

    const bases = FWD.split('');
    bases[8] = bases[8] === 'A' ? 'C' : 'A';
    const mutated = bases.join('');
    type('Forward primer', mutated);
    const site = must(findAnnealingSites(text, 'circular', mutated)[0], 'a site');
    expect(site.mismatches).toBe(1);
    expect(
      screen.getByText(
        `22 nt, Tm ${site.templateTm.toFixed(0)} °C on the template (up to the first mismatch), ${site.tm.toFixed(0)} °C once the product carries it · → 201–222 · 1 mismatch, which the product keeps`,
      ),
    ).toBeInTheDocument();
  });
});
