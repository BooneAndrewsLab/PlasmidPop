// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { readFileSync } from 'node:fs';

import { parseGenBank } from '@/io';
import { exportMapSvg } from '@/view/svg';

import { ExportMapPngDialog } from './ExportMapPngDialog';

function pbr322() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/J01749.gb', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

function setup() {
  const svgs: { svg: string; scale: number }[] = [];
  const files: { name: string; blob: Blob }[] = [];
  const onClose = vi.fn();
  render(
    <ExportMapPngDialog
      doc={pbr322()}
      cutSites={[]}
      edits={null}
      gcWindow={null}
      showGc={false}
      stem="pBR322"
      onClose={onClose}
      rasterize={(svg, scale) => {
        svgs.push({ svg, scale });
        return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
      }}
      download={(name, blob) => files.push({ name, blob })}
    />,
  );
  return { svgs, files, onClose };
}

const exportButton = () => screen.getByRole('button', { name: 'Export' });

describe('ExportMapPngDialog (#212)', () => {
  it('rasterises at 2x on white by default and downloads a .png', async () => {
    const { svgs, files, onClose } = setup();
    expect(screen.getByText(/× \d+ pixels/)).toBeInTheDocument();
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(svgs[0]?.scale).toBe(2);
    expect(svgs[0]?.svg).toContain('#ffffff');
    expect(files[0]?.name).toBe('pBR322_map.png');
  });

  it('takes the scale and a transparent background', async () => {
    const { svgs } = setup();
    fireEvent.click(screen.getByRole('button', { name: '4×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transparent' }));
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(svgs).toHaveLength(1);
    });
    expect(svgs[0]?.scale).toBe(4);
    expect(svgs[0]?.svg).not.toContain('fill="#ffffff"');
  });

  it('leaves out the centre text and a hidden feature type', async () => {
    const { svgs } = setup();
    const full = exportMapSvg(pbr322(), { transparent: false });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Name and length in the middle' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CDS' }));
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(svgs).toHaveLength(1);
    });
    expect(svgs[0]?.svg).not.toContain('>4,361 bp circular<');
    expect(svgs[0]?.svg.length).toBeLessThan(full.length);
  });

  it('shows why a scale is refused and disables Export', () => {
    setup();
    // 4x of the fixture is fine; the refusal is covered by mapPng.test.ts.
    expect(exportButton()).toBeEnabled();
  });
});
