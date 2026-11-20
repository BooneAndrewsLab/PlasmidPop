// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type Orf, SeqDocument, createFeature, rangeSegment } from '@/core';

import { editorStore } from '../state/editorStore';
import { FeatureList } from './FeatureList';
import { FileMenu } from './FileMenu';
import { OrfPanel } from './OrfPanel';

/** Protein FASTA downloads (#451): the File menu entry, a selected CDS, an ORF. */

const gene = createFeature({
  type: 'CDS',
  name: 'geneA',
  segments: [rangeSegment(0, 15)],
});
const withCds = SeqDocument.create({
  name: 'plasmid',
  sequence: 'ATGGCCAAATTTTAA',
  features: [gene],
});
const noCds = SeqDocument.create({ name: 'bare', sequence: 'ACGTACGTACGT' });
const protein = SeqDocument.create({ name: 'prot', sequence: 'MAKF', alphabet: 'protein' });

/** Captures what is downloaded as [file name, text]. */
function captureDownloads(): { files: [string, Promise<string>][] } {
  const files: [string, Promise<string>][] = [];
  let last: Blob | null = null;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    files.push([this.download, (last ?? new Blob()).text()]);
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    if (b instanceof Blob) last = b;
    return 'blob:x';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return { files };
}

function menuItem(): HTMLElement | null {
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  return screen.queryByRole('menuitem', { name: 'Download protein FASTA…' });
}

function renderMenu(doc: SeqDocument): void {
  act(() => {
    editorStore.openDocument(doc, 'x.gb');
  });
  render(<FileMenu doc={doc} onOpenFile={() => undefined} onCompare={() => undefined} />);
}

describe('protein FASTA downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('File menu: downloads every CDS as one .faa', async () => {
    const { files } = captureDownloads();
    renderMenu(withCds);
    const item = menuItem();
    expect(item).toBeEnabled();
    if (item !== null) fireEvent.click(item);
    expect(files.map((f) => f[0])).toEqual(['plasmid_proteins.faa']);
    expect(await files[0]?.[1]).toBe('>plasmid_geneA plasmid geneA CDS 1..15, 4 aa\nMAKF\n');
  });

  it('File menu: disabled, saying why, with no CDS', () => {
    renderMenu(noCds);
    const item = menuItem();
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('data-tip', expect.stringMatching(/no CDS/));
  });

  it('File menu: disabled for a protein document', () => {
    renderMenu(protein);
    const item = menuItem();
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('data-tip', expect.stringMatching(/already residues/));
  });

  it('feature list: a selected CDS downloads its own protein', async () => {
    const { files } = captureDownloads();
    act(() => {
      editorStore.openDocument(withCds, 'x.gb');
      editorStore.selectFeature(gene.id);
    });
    render(<FeatureList doc={withCds} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download protein' }));
    expect(files.map((f) => f[0])).toEqual(['plasmid_geneA.faa']);
    expect(await files[0]?.[1]).toContain('\nMAKF\n');
  });

  it('ORF panel: downloads the selected ORF', async () => {
    const { files } = captureDownloads();
    const orf: Orf = { range: { start: 0, end: 15 }, strand: 'forward', frame: 0, codons: 5 };
    act(() => {
      editorStore.openDocument(withCds, 'x.gb');
      editorStore.setAnalysis(withCds, [], [orf]);
      editorStore.setSelection(orf.range);
    });
    render(<OrfPanel doc={withCds} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download FASTA' }));
    expect(files.map((f) => f[0])).toEqual(['plasmid_1-15.faa']);
    expect(await files[0]?.[1]).toBe('>plasmid_ORF_1-15 plasmid ORF 1..15, 4 aa\nMAKF\n');
  });
});
