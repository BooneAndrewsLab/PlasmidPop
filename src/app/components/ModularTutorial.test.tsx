// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type SeqDocument, BUNDLED_ENZYME_SET, setActiveEnzymeSet } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { ModularPanel } from './ModularPanel';

/**
 * The words of docs/tutorials/modular.md as the Modular panel prints them,
 * with the tutorial's own files in the tube.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}

function setup(files: readonly string[]): void {
  act(() => {
    for (const f of files) editorStore.openDocument(tut(f));
    editorStore.setCloningReaction('modular');
  });
  render(<ModularPanel />);
}

const BASE = ['MC-L1-Destination', 'MC-L0-Promoter-A', 'MC-L0-CDS-A', 'MC-L0-Terminator'];

describe('modular.md as the panel shows it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('first half: standard, positions, slots, one combination, one product', () => {
    setup(BASE);
    expect(screen.getByLabelText('Enzyme')).toHaveValue('BsaI');
    expect(screen.getByText('MoClo plant common syntax')).toBeInTheDocument();
    expect(screen.getByLabelText('Position of pMC-L1-Destination').textContent).toContain(
      'Detected: Destination',
    );
    expect(screen.getByLabelText('Position of MC-L0-PromA').textContent).toContain(
      'Detected: Promoter + 5′UTR',
    );
    expect(screen.getByLabelText('Position of MC-L0-CdsA').textContent).toContain('Detected: CDS');
    expect(screen.getByLabelText('Position of MC-L0-Term').textContent).toContain(
      'Detected: 3′UTR + terminator',
    );
    const slots = within(screen.getByRole('list', { name: 'Plan slots' })).getAllByRole('listitem');
    expect(slots.map((s) => s.textContent)).toEqual([
      'DestinationCGCT-GGAG · pMC-L1-Destination',
      'Promoter + 5′UTRGGAG-AATG · MC-L0-PromA',
      'CDSAATG-GCTT · MC-L0-CdsA',
      '3′UTR + terminatorGCTT-CGCT · MC-L0-Term',
    ]);
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent('1 combination: 1 assemble.');
    expect(screen.getByRole('list', { name: 'Plan products' })).toHaveTextContent(
      '1,702 bp circle',
    );
    act(() => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Assemble pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term',
        }),
      );
    });
    expect(editorStore.document?.name).toBe(
      'pMC-L1-Destination+MC-L0-PromA+MC-L0-CdsA+MC-L0-Term assembly',
    );
    expect(editorStore.document?.length).toBe(1702);
  });

  it('the wrong part: not placed, then set by hand to CDS', () => {
    setup([...BASE, 'MC-wrong-position']);
    expect(screen.getByLabelText('Position of MC-L0-YTK-Type3').textContent).toContain(
      'Detected: none found',
    );
    expect(screen.getByText(/Not placed: MC-L0-YTK-Type3/).textContent).toBe(
      'Not placed: MC-L0-YTK-Type3. Their ends match no position of MoClo plant common syntax with BsaI; set one by hand, or leave them out.',
    );
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent('1 combination: 1 assemble.');
    act(() => {
      fireEvent.change(screen.getByLabelText('Position of MC-L0-YTK-Type3'), {
        target: { value: 'CDS' },
      });
    });
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent(
      '2 combinations: 1 assemble, 1 cannot form.',
    );
    const rows = within(screen.getByRole('list', { name: 'Plan products' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]?.textContent).toBe(
      'pMC-L1-Destination + MC-L0-PromA + MC-L0-YTK-Type3 + MC-L0-TermNo part starts with the overhang BsaI 5′ AATG left by MC-L0-PromA. 2 of 4 parts were never reached.',
    );
  });

  it('second half: four combinations, Assemble all 4', () => {
    setup([...BASE, 'MC-L0-Promoter-B', 'MC-L0-CDS-B']);
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent('4 combinations: 4 assemble.');
    const rows = within(screen.getByRole('list', { name: 'Plan products' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((r) => r.textContent)).toEqual([
      'pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term1,702 bp circleAssemble',
      'pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsB + MC-L0-Term1,762 bp circleAssemble',
      'pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsA + MC-L0-Term1,722 bp circleAssemble',
      'pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsB + MC-L0-Term1,782 bp circleAssemble',
    ]);
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble all 4' }));
    });
    expect(editorStore.getState().documents.length).toBe(before + 4);
  });
});
