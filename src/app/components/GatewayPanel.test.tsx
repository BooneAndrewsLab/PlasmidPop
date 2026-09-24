// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { GatewayPanel } from './GatewayPanel';

const CORE = { 1: 'ACGTTGA', 2: 'TTCAGGC' } as const;
const ARMS = {
  B: ['CCTTAGGACTTCAAGGTCCA', 'GGATCCAAGTTCGATCTTGC'],
  P: ['TTACGCAAGGTTCCATGAAC', 'AACCGGTTACGGATTCCAAG'],
} as const;

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

function molecule(name: string, kind: 'B' | 'P', middle: string, middleName: string): SeqDocument {
  const one = ARMS[kind][0] + CORE[1] + ARMS[kind][1];
  const two = ARMS[kind][0] + CORE[2] + ARMS[kind][1];
  const sequence = one + middle + two + filler(700, 3);
  const at = (start: number, end: number, type: string, label: string) =>
    createFeature({ type, name: label, segments: [rangeSegment(start, end)] });
  return SeqDocument.create({
    name,
    topology: 'circular',
    sequence,
    features: [
      at(0, one.length, 'protein_bind', `att${kind}1`),
      at(one.length, one.length + middle.length, 'CDS', middleName),
      at(
        one.length + middle.length,
        one.length + middle.length + two.length,
        'protein_bind',
        `att${kind}2`,
      ),
    ],
  });
}

const substrate = molecule('pGene', 'B', filler(400, 11), 'gene');
const donor = molecule('pDONR', 'P', filler(500, 22), 'ccdB');

describe('GatewayPanel', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('runs a BP between two open tabs and opens the entry clone', () => {
    act(() => {
      editorStore.openDocument(substrate);
      editorStore.openDocument(donor);
    });
    render(<GatewayPanel />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'BP' }));
    });
    // The pickers say which att sites each tab annotates.
    // Each picker lists every tab with the att sites it annotates.
    expect(screen.getAllByRole('option', { name: /pGene — attB1, attB2/ })).toHaveLength(2);
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('attB substrate'), { target: { value: ids[0] } });
      fireEvent.change(screen.getByLabelText('donor vector'), { target: { value: ids[1] } });
    });
    expect(screen.getByLabelText('Product')).toHaveTextContent(/gene/);
    expect(screen.getByText(/ccdB cassette of pDONR leaves on the byproduct/)).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open clone' }));
    });
    expect(
      editorStore.document?.features
        .all()
        .map((f) => f.name)
        .sort(),
    ).toEqual(['attL1', 'attL2', 'gene']);
  });

  it('says what is missing when the sites are the wrong kind', () => {
    act(() => {
      editorStore.openDocument(substrate);
      editorStore.openDocument(donor);
    });
    render(<GatewayPanel />);
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('entry clone'), { target: { value: ids[0] } });
      fireEvent.change(screen.getByLabelText('destination vector'), { target: { value: ids[1] } });
    });
    expect(screen.getByText(/pGene has no attL site annotated/)).toBeInTheDocument();
  });
});
