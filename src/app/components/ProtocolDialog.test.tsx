// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type CheckPair, type LineageNode, SeqDocument, withLineage } from '@/core';

import { forgetPanels, rememberPanel } from '../state/panelMemory';
import { ProtocolDialog } from './ProtocolDialog';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const leaf = (name: string, length: number): LineageNode => ({
  name,
  checksum: null,
  topology: 'circular',
  length,
  step: null,
});

const noop = vi.fn();

const made = withLineage(
  SeqDocument.create({
    name: 'pMade',
    topology: 'circular',
    sequence: `GAATTC${filler(1500, 7)}GGATCC${filler(900, 8)}`,
  }),
  {
    op: 'golden-gate',
    parents: [leaf('pDest', 3000), leaf('insA', 600)],
    enzymes: ['BsaI'],
    flipped: [false, false],
  },
);

describe('Protocol dialog (#215)', () => {
  it('says so for a document with no record', () => {
    render(
      <ProtocolDialog doc={SeqDocument.create({ name: 'x', sequence: 'ACGT' })} onClose={noop} />,
    );
    expect(screen.getByText(/no record of how it was made/)).toBeTruthy();
    expect(screen.getByText<HTMLButtonElement>('Download HTML').disabled).toBe(true);
  });

  it('previews the page and recalculates volumes from a concentration', () => {
    render(<ProtocolDialog doc={made} onClose={noop} />);
    const frame = screen.getByTitle('Protocol preview');
    expect(frame.getAttribute('srcdoc')).toContain('Golden Gate: pMade');
    expect(frame.getAttribute('srcdoc')).not.toContain('<th>µL</th>');
    fireEvent.change(screen.getByLabelText('Concentration of insA'), { target: { value: '10' } });
    expect(screen.getByTitle('Protocol preview').getAttribute('srcdoc')).toContain('<th>µL</th>');
  });

  it('lists the tab’s clone-check design, when it has one for these bases (item 120)', () => {
    const report = (sequence: string) => ({
      sequence,
      length: sequence.length,
      tm: 60,
      gc: 0.5,
      homopolymer: 2,
      selfComplementarity: 2,
      hairpin: 1,
      threePrimeSelf: 1,
      gcClamp: true,
      degenerate: 0,
      molecules: 1,
      tmRange: null,
      gcRange: { min: 0.5, max: 0.5 },
      warnings: [],
    });
    const pair: CheckPair = {
      kind: 'junction',
      junction: 0,
      forward: report('ACGTACGTACGTACGTACGTA'),
      reverse: report('TTGCATGCATGCATGCATGCA'),
      forwardSite: { start: 100, end: 121 },
      reverseSite: { start: 600, end: 621 },
      fixed: null,
      productLength: 521,
      tmDifference: 0,
      crossDimer: 0,
      penalty: 1,
      bands: { clone: [521], empty: [], flipped: null },
      problems: [],
    };
    const record = {
      design: { pairs: [pair], notes: [], reused: null },
      designedFor: 'the Golden Gate product',
      insert: { start: 200, end: 500 },
      junctions: [200, 500],
      emptyName: 'pDest',
      orientation: 'fixed' as const,
      reused: null,
    };
    rememberPanel('primers.cloneRecord', 'tab-1', {
      template: `${made.topology}:${made.sequence.toString()}`,
      record,
    });
    render(<ProtocolDialog doc={made} documentId="tab-1" onClose={noop} />);
    const page = screen.getByTitle('Protocol preview').getAttribute('srcdoc') ?? '';
    expect(page).toContain('<h2>Colony PCR check</h2>');
    expect(page).toContain('Check junction 1 fwd 1: ACGTACGTACGTACGTACGTA');
    expect(page).toContain('colony PCR check');
    forgetPanels();
    // Another tab, or none, has no design to list.
    render(<ProtocolDialog doc={made} onClose={noop} />);
    const plain = screen.getAllByTitle('Protocol preview').at(-1)?.getAttribute('srcdoc') ?? '';
    expect(plain).not.toContain('Colony PCR check');
  });

  it('downloads the page as HTML and as Markdown', () => {
    const download = vi.fn();
    render(<ProtocolDialog doc={made} onClose={noop} download={download} />);
    fireEvent.click(screen.getByText('Download HTML'));
    fireEvent.click(screen.getByText('Download Markdown'));
    expect(download).toHaveBeenCalledTimes(2);
    const [html, md] = download.mock.calls as [string, string][][];
    expect(html?.[0]).toBe('pMade_protocol.html');
    expect(html?.[1]).toMatch(/^<!doctype html>/);
    expect(md?.[0]).toBe('pMade_protocol.md');
    expect(md?.[1]).toMatch(/^# Protocol: pMade/);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ProtocolDialog doc={made} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
