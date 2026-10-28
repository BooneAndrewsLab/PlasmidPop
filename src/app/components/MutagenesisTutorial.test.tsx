// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type SeqDocument, BUNDLED_ENZYME_SET, setActiveEnzymeSet } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { editorStore } from '../state/editorStore';
import { MutagenesisPanel } from './MutagenesisPanel';

/**
 * The words of docs/tutorials/mutagenesis.md as the Mutate panel prints them,
 * with the tutorial's own file open and the selections the page asks for.
 */

const doc: SeqDocument = (() => {
  const d = parseGenBank(
    readFileSync(join(__dirname, '../../../docs/tutorials/files/SDM-Template.gb'), 'utf8'),
  ).documents[0];
  if (d === undefined) throw new Error('SDM-Template');
  return d;
})();

const select = (start: number, end: number): void => {
  act(() => {
    editorStore.setSelection({ start, end });
  });
};
const typeChange = (value: string): void => {
  act(() => {
    fireEvent.change(screen.getByLabelText(/^(Change to|Bases to insert)$/), { target: { value } });
  });
};
const click = (name: string): void => {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};
const primers = () => within(screen.getByRole('list', { name: 'Mutagenesis primers' }));
const lines = (): string[] =>
  primers()
    .getAllByRole('listitem')
    .map((li) => li.textContent);

describe('mutagenesis.md as the Mutate panel shows it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
    render(<MutagenesisPanel doc={doc} />);
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('part 1: the residue, the codons, the primers and the protein change', () => {
    expect(
      screen.getByText(
        'Select the bases to change in SDM-Template, or put the cursor where new bases go.',
      ),
    ).toBeInTheDocument();
    select(177, 180);
    expect(screen.getByText('Change 3 bp at 178 (AAG).')).toBeInTheDocument();
    expect(screen.getByText(/synthORF K14 \(AAG\)/)).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByLabelText('New amino acid'), { target: { value: 'R' } });
    });
    const options = [...screen.getByLabelText<HTMLSelectElement>('New amino acid').options].map(
      (o) => o.text,
    );
    expect(options).toContain('R — Arginine');
    expect(options).toContain('I — Isoleucine');
    const codons = within(screen.getByRole('list', { name: 'Codons for the new residue' }));
    expect(codons.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'CGC 40 % ★',
      'CGT 38 %',
      'CGG 10 %',
      'CGA 6 %',
      'AGA 4 %',
      'AGG 2 %',
    ]);
    act(() => {
      fireEvent.click(codons.getByRole('button', { name: /^AGG/ }));
    });
    expect(screen.getByLabelText('Change to')).toHaveValue('AGG');
    expect(screen.getByText('AAG178–180AGG')).toBeInTheDocument();
    expect(screen.getByText(/synthORF K14R/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to back' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(lines()).toEqual([
      'Forward21 nt, Tm 60 °C (NEB Q5 71 °C) over the 18 that anneal' + 'AGGaacagcctacgcctggccCopy',
      'Reverse29 nt, Tm 61 °C (NEB Q5 70 °C) over the 29 that anneal' +
        'cggatttctagatatgttccacagacgccCopy',
    ]);
    expect(
      screen.getByText(
        /Upper case is new; the rest anneals\. Amplify the whole plasmid, annealing at 71\.3 °C \(NEB's for Q5\), then phosphorylate, ligate and digest the template \(KLD\)\./,
      ),
    ).toBeInTheDocument();

    click('Overlapping');
    expect(lines()).toEqual([
      'Forward34 nt, Tm 79 °C (Agilent)catatctagaaatccgAGGaacagcctacgcctgCopy',
      'Reverse34 nt, Tm 79 °C (Agilent)caggcgtaggctgttCCTcggatttctagatatgCopy',
    ]);
    expect(
      screen.getByText(
        'Upper case is new, in the middle of both primers. Copy the plasmid round, digest the template with DpnI, and transform.',
      ),
    ).toBeInTheDocument();
  });

  it('part 1: Open mutant opens the template renamed with the change as its one edit', () => {
    select(177, 180);
    typeChange('AGG');
    click('Open mutant');
    const mutant = editorStore.document;
    expect(mutant?.name).toBe('SDM-Template AAG178–180AGG');
    expect(mutant?.length).toBe(1241);
    expect(mutant?.isCircular).toBe(true);
    expect(mutant?.sequence.toString().slice(177, 180).toUpperCase()).toBe('AGG');
    expect(editorStore.getState().scratch).toBe(true);
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.sequence.toString()).toBe(doc.sequence.toString());
  });

  it('part 1: the mutant opens with the ticks of the template and nothing else', () => {
    act(() => {
      editorStore.setShownEnzymes(['BamHI']);
    });
    select(177, 180);
    typeChange('AGG');
    click('Open mutant');
    const mutantDoc = editorStore.document;
    if (mutantDoc === null) throw new Error('no mutant');
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    act(() => {
      editorStore.setAnalysis(mutantDoc, [site('EcoRI', 3), site('BamHI', 9)], []);
    });
    expect([...editorStore.getState().shownEnzymes]).toEqual(['BamHI']);
  });

  it('part 2: an insertion after base 438 and a deletion of residue 60', () => {
    select(438, 438);
    expect(screen.getByText('Insert after base 438.')).toBeInTheDocument();
    typeChange('CACCACCACCACCACCAC');
    expect(screen.getByText('+CACCACCACCACCACCAC after 438')).toBeInTheDocument();
    expect(screen.getByText(/synthORF 101 \(none\) → HHHHHH/)).toBeInTheDocument();
    expect(lines()[0]).toContain('38 nt, Tm 60 °C (NEB Q5 71 °C) over the 20 that anneal');
    expect(lines()[1]).toContain('26 nt, Tm 61 °C (NEB Q5 70 °C) over the 26 that anneal');
    click('Open mutant');
    expect(editorStore.document?.length).toBe(1259);
    const orf = [...(editorStore.document?.features ?? [])].find((f) => f.name === 'synthORF');
    expect(orf?.segments[0]).toMatchObject({ start: 138, end: 459 });
    expect(editorStore.document?.name).toBe('SDM-Template +CACCACCACCACCACCAC after 438');
  });

  it('part 2: a deletion is the selection with the box left empty', () => {
    select(315, 318);
    expect(screen.getByText('Change 3 bp at 316 (GAA).')).toBeInTheDocument();
    expect(screen.getByLabelText('Change to')).toHaveAttribute(
      'placeholder',
      'leave empty to delete',
    );
    expect(screen.getByLabelText('Change to')).toHaveValue('');
    // Nothing has to be typed: the empty box is the change.
    expect(screen.getByText('Δ316–318')).toBeInTheDocument();
    expect(screen.getByText(/synthORF 60 E → \(none\)/)).toBeInTheDocument();
    expect(lines()[0]).toContain('29 nt, Tm 61 °C (NEB Q5 70 °C) over the 29 that anneal');
    expect(lines()[1]).toContain('28 nt, Tm 60 °C (NEB Q5 68 °C) over the 28 that anneal');
    expect(screen.getByText(/annealing at 69\.5 °C/)).toBeInTheDocument();
    click('Open mutant');
    expect(editorStore.document?.length).toBe(1238);
    expect(editorStore.document?.name).toBe('SDM-Template Δ316–318');
  });

  it('a character that is not a base is left out and named', () => {
    select(177, 180);
    typeChange('AG#G');
    expect(screen.getByText('Left out, not bases: “#”.')).toBeInTheDocument();
  });

  it('part 3: the silent change', () => {
    select(258, 261);
    expect(screen.getByText(/synthORF I41 \(ATT\)/)).toBeInTheDocument();
    expect(
      [...screen.getByLabelText<HTMLSelectElement>('New amino acid').options].map((o) => o.text),
    ).toContain('I — Isoleucine (as now)');
    typeChange('ATC');
    expect(screen.getByText('ATT259–261ATC')).toBeInTheDocument();
    expect(screen.getByText(/synthORF no change \(silent\)/)).toBeInTheDocument();
    expect(lines()[0]).toContain('35 nt, Tm 60 °C (NEB Q5 68 °C) over the 32 that anneal');
    expect(lines()[1]).toContain('20 nt, Tm 60 °C (NEB Q5 71 °C) over the 20 that anneal');
    expect(screen.getByText(/annealing at 68\.6 °C/)).toBeInTheDocument();
    typeChange('ATT');
    expect(screen.queryByRole('list', { name: 'Mutagenesis primers' })).toBeNull();
  });

  it('the wrong case: the AT-rich spacer, both designs, in the panel words', () => {
    select(590, 591);
    expect(screen.getByText('Change 1 bp at 591 (A).')).toBeInTheDocument();
    typeChange('G');
    expect(screen.getByText('A591G')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The template next to the change is too AT-rich to reach 60 °C within 60 bases.',
      ),
    ).toBeInTheDocument();
    expect(lines()[0]).toContain('61 nt, Tm 55 °C (NEB Q5 60 °C) over the 60 that anneal');
    expect(lines()[1]).toContain('60 nt, Tm 57 °C (NEB Q5 63 °C) over the 60 that anneal');
    click('Overlapping');
    expect(
      screen.getByText(
        'The primers reach only 69 °C at 60 bases, short of the 78 °C QuikChange asks for.',
      ),
    ).toBeInTheDocument();
  });
});
