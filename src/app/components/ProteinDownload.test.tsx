// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type Orf, SeqDocument, createFeature, rangeSegment } from '@/core';

import { analytics } from '../analytics';
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

  // ATG GC|gtaagt|C AAA TTT TAA: the CDS is join(3..7,14..23), the gene 1..25.
  const SPLICED = 'CCATGGCGTAAGTCAAATTTTAAGG';
  const act1 = createFeature({ type: 'gene', name: 'ACT1', segments: [rangeSegment(0, 25)] });
  const actin = createFeature({
    type: 'CDS',
    name: 'actin',
    segments: [rangeSegment(2, 7), rangeSegment(13, 23)],
  });
  const shortActin = createFeature({ type: 'CDS', name: 'actin', segments: [rangeSegment(2, 11)] });

  function renderSelected(doc: SeqDocument, id: string, reader = false): void {
    act(() => {
      editorStore.openDocument(doc, 'x.gb');
      editorStore.selectFeature(id);
    });
    render(<FeatureList doc={doc} reader={reader} />);
  }

  it('feature list: a selected gene downloads the protein of its CDS, not of its span', async () => {
    const { files } = captureDownloads();
    const track = vi.spyOn(analytics, 'track');
    const doc = SeqDocument.create({ name: 'chr', sequence: SPLICED, features: [act1, actin] });
    renderSelected(doc, act1.id);
    fireEvent.click(screen.getByRole('button', { name: 'Download protein' }));
    expect(files.map((f) => f[0])).toEqual(['chr_ACT1.faa']);
    expect(await files[0]?.[1]).toBe('>chr_actin chr actin CDS join(3..7,14..23), 4 aa\nMAKF\n');
    expect(track.mock.calls).toEqual([['file', 'export', 'gene-protein-fasta']]);
  });

  it('feature list: a gene with several CDS says how many and downloads them as one file', async () => {
    const { files } = captureDownloads();
    const doc = SeqDocument.create({
      name: 'chr',
      sequence: SPLICED,
      features: [act1, actin, shortActin],
    });
    renderSelected(doc, act1.id);
    expect(screen.queryByRole('button', { name: 'Download protein' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Download protein (2 CDS)' });
    expect(button).toHaveAttribute('data-tip', expect.stringMatching(/2 CDS inside this gene/));
    fireEvent.click(button);
    expect(files.map((f) => f[0])).toEqual(['chr_ACT1_proteins.faa']);
    expect(await files[0]?.[1]).toBe(
      '>chr_actin chr actin CDS join(3..7,14..23), 4 aa\nMAKF\n' +
        '>chr_actin_2 chr actin CDS 3..11, 2 aa\nMA\n',
    );
  });

  it('feature list: a selected mRNA downloads its CDS, in the read-only view too', () => {
    const { files } = captureDownloads();
    const mrna = createFeature({
      type: 'mRNA',
      name: 'ACT1 mRNA',
      segments: [rangeSegment(0, 7), rangeSegment(13, 25)],
    });
    const doc = SeqDocument.create({
      name: 'chr',
      sequence: SPLICED,
      features: [mrna, actin, shortActin],
    });
    renderSelected(doc, mrna.id, true);
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Download protein' }));
    expect(files.map((f) => f[0])).toEqual(['chr_ACT1_mRNA.faa']);
  });

  it('feature list: no button for a gene with no CDS inside, or for another feature type', () => {
    const elsewhere = createFeature({
      type: 'CDS',
      name: 'other strand',
      strand: 'reverse',
      segments: [rangeSegment(2, 11)],
    });
    const promoter = createFeature({ type: 'promoter', segments: [rangeSegment(0, 25)] });
    const doc = SeqDocument.create({
      name: 'chr',
      sequence: SPLICED,
      features: [act1, promoter, elsewhere],
    });
    renderSelected(doc, act1.id);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download protein/ })).toBeNull();
    act(() => {
      editorStore.selectFeature(promoter.id);
    });
    expect(screen.queryByRole('button', { name: /Download protein/ })).toBeNull();
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
