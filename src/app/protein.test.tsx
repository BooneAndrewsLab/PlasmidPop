// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument, createFeature, fragmentFromRange, rangeSegment } from '@/core';
import { parseGenBank } from '@/io';
import { getRepository } from '@/storage';
import NP_000509 from '@/io/fixtures/NP_000509.gp?raw';

import { App } from './App';
import { pasteFragment, typeText } from './editing';
import { fileNameFor } from './saveFile';
import { DEFAULT_BENCH } from './state/benchSettings';
import { editorStore, sidebarTabsFor } from './state/editorStore';

beforeEach(() => {
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  localStorage.removeItem('plasmidpop.viewPrefs');
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.setSidebarTab('features');
    editorStore.setSidebarOpen(true);
    editorStore.setView('both');
    editorStore.resetLayout();
    editorStore.setCloningReaction('digest');
    editorStore.restoreBench(DEFAULT_BENCH);
    editorStore.dismissNewDocument();
    editorStore.setShowComplement(true);
  });
});

function hbb(): SeqDocument {
  const doc = parseGenBank(NP_000509).documents[0];
  if (doc === undefined) throw new Error('expected the fixture');
  return doc;
}

/** A DNA molecule with one CDS, M K L E and a stop, named klE. */
function plasmid(): SeqDocument {
  return SeqDocument.create({
    name: 'pX',
    sequence: 'GGATGAAACTGGAATAAGG',
    features: [
      createFeature({
        type: 'CDS',
        name: 'klE',
        segments: [rangeSegment(2, 17)],
        qualifiers: [{ name: 'product', value: 'KLE protein' }],
      }),
    ],
  });
}

describe('the tools of a protein document (#66)', () => {
  it('has a Protein tab instead of the DNA ones, and DNA the other way about', () => {
    // Align is there since #95: two proteins align by BLOSUM62.
    expect(sidebarTabsFor(hbb())).toEqual(['features', 'protein', 'align', 'history']);
    expect(sidebarTabsFor(plasmid())).not.toContain('protein');
    expect(sidebarTabsFor(plasmid())).toContain('enzymes');
  });

  it('shows residues alone: no map, no view switcher, no strand toggles, no DNA edits', () => {
    act(() => {
      editorStore.openDocument(hbb(), 'NP_000509.gp');
    });
    render(<App />);
    expect(screen.getByText('147 aa, protein')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Complement' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reverse complement' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Make circular/ })).toBeNull();
    expect(document.querySelector('.circular-map, [aria-label="Plasmid map"]')).toBeNull();
    const rail = screen.getByRole('tablist', { name: 'Sidebar' });
    const tabs = within(rail)
      .getAllByRole('tab')
      .map((t) => t.textContent);
    expect(tabs).toEqual(['Features', 'Protein', 'Align', 'History']);
  });

  it('gives the properties on the Protein tab', () => {
    act(() => {
      editorStore.openDocument(hbb(), 'NP_000509.gp');
      editorStore.setSidebarTab('protein');
    });
    render(<App />);
    const facts = document.querySelector('dl[aria-label="Protein properties"]');
    if (facts === null) throw new Error('expected the facts');
    expect(facts).toHaveTextContent('15,998.41 Da');
    expect(facts).toHaveTextContent('Theoretical pI6.74');
    expect(facts).toHaveTextContent('15,595 M⁻¹ cm⁻¹');
    expect(facts).toHaveTextContent('15,470 M⁻¹ cm⁻¹');
  });

  it('leaves Alt+C and Alt+V to the browser in front of a protein', () => {
    act(() => {
      editorStore.openDocument(hbb(), 'NP_000509.gp');
    });
    render(<App />);
    fireEvent.keyDown(window, { key: 'c', code: 'KeyC', altKey: true });
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV', altKey: true });
    expect(editorStore.getState().showComplement).toBe(true);
    expect(editorStore.getState().view).toBe('both');
  });

  it('will not show an unavailable tab, and steps only through the ones there are', () => {
    act(() => {
      editorStore.openDocument(hbb(), 'NP_000509.gp');
      editorStore.setSidebarTab('enzymes');
    });
    expect(editorStore.getState().sidebarTab).toBe('features');
    render(<App />);
    fireEvent.keyDown(window, { key: ']', code: 'BracketRight', altKey: true });
    expect(editorStore.getState().sidebarTab).toBe('protein');
    fireEvent.keyDown(window, { key: ']', code: 'BracketRight', altKey: true });
    expect(editorStore.getState().sidebarTab).toBe('align');
    fireEvent.keyDown(window, { key: ']', code: 'BracketRight', altKey: true });
    expect(editorStore.getState().sidebarTab).toBe('history');
  });

  it('refuses to compare a protein with DNA', () => {
    act(() => {
      editorStore.openDocument(hbb(), 'NP_000509.gp');
      editorStore.showComparison('pX', plasmid(), { kind: 'tab', documentId: 'x' });
    });
    expect(editorStore.getState().comparison).toBeNull();
    expect(editorStore.getState().error).toMatch(/is DNA and this is a protein/);
  });

  it('downloads as GenPept and protein FASTA', () => {
    expect(fileNameFor(hbb(), 'genbank')).toBe('NP_000509.gp');
    expect(fileNameFor(hbb(), 'fasta')).toBe('NP_000509.faa');
    expect(fileNameFor(plasmid(), 'genbank')).toBe('pX.gb');
  });
});

describe('typing and pasting into a protein (#66)', () => {
  it('takes residues and refuses bases from DNA', () => {
    const protein = hbb();
    const plan = typeText(protein, { start: 0, end: 0 }, 'EFIL');
    expect(plan?.op).toEqual({ type: 'insert', position: 0, text: 'EFIL' });
    expect(() => typeText(protein, { start: 0, end: 0 }, 'E#')).toThrow(/amino-acid/);
    const bases = fragmentFromRange(plasmid(), { start: 0, end: 6 });
    expect(() => pasteFragment(protein, { start: 0, end: 0 }, bases)).toThrow(/bases/);
    const residues = fragmentFromRange(protein, { start: 0, end: 6 });
    expect(() => pasteFragment(plasmid(), { start: 0, end: 0 }, residues)).toThrow(/residues/);
  });
});

describe('Translate ▸ Open as protein (#66)', () => {
  it('opens a CDS as a protein tab named after it, on its Protein panel', () => {
    act(() => {
      editorStore.openDocument(plasmid(), 'pX.gb');
      editorStore.setSidebarTab('translate');
    });
    render(<App />);
    const coding = screen.getByRole('region', { name: 'Coding features' });
    fireEvent.click(within(coding).getByRole('button', { name: 'Open as protein' }));
    const doc = editorStore.document;
    expect(doc?.alphabet).toBe('protein');
    expect(doc?.name).toBe('klE');
    expect(doc?.sequence.toString()).toBe('MKLE');
    expect(editorStore.getState().sidebarTab).toBe('protein');
    expect(editorStore.getState().documents).toHaveLength(2);
    expect(screen.getByText('4 aa, protein')).toBeInTheDocument();
  });

  it('opens a frame as a protein, stops and all', () => {
    act(() => {
      editorStore.openDocument(plasmid(), 'pX.gb');
      editorStore.setSidebarTab('translate');
    });
    render(<App />);
    const frame = screen.getByRole('region', { name: 'Frame +3' });
    fireEvent.click(within(frame).getByRole('button', { name: 'Open as protein' }));
    const doc = editorStore.document;
    expect(doc?.alphabet).toBe('protein');
    expect(doc?.name).toBe('pX_1-19_+3');
    expect(doc?.sequence.toString()).toBe('MKLE*');
  });
});
