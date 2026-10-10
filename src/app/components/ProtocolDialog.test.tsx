// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type LineageNode, SeqDocument, withLineage } from '@/core';

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
