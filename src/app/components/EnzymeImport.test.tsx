// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { persistence } from '../state/persistence';
import { EnzymeImport } from './EnzymeImport';

/** A small made-up REBASE file: no REBASE data is kept in the repository. */
function rebase(hauII: string): File {
  const rec = (name: string, site: string) =>
    `<1>${name}\n<2>\n<3>${site}\n<4>\n<5>x\n<6>x\n<7>\n<8>ref\n\n`;
  const text = `REBASE version 699   withrefm.699\nRich Roberts    Jan 01 2030\n\n${rec('EcoRI', 'G^AATTC')}${rec('HauII', hauII)}`;
  return new File([text], 'withrefm.699', { type: 'text/plain' });
}

async function importFile(f: File): Promise<void> {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error('no file input');
  await act(async () => {
    fireEvent.change(input, { target: { files: [f] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('EnzymeImport warnings (#150)', () => {
  afterEach(async () => {
    await persistence.useBundledEnzymes();
  });

  it('shows no warning for a file it reads as checked', async () => {
    render(<EnzymeImport onClose={() => undefined} />);
    await importFile(rebase('TGGCCANNNNNNNNNNN^'));
    await screen.findByText(/Imported 2 enzymes from REBASE 699/);
    expect(screen.queryByText(/check these against REBASE/)).toBeNull();
  });

  it('lists the enzymes a changed record left out', async () => {
    render(<EnzymeImport onClose={() => undefined} />);
    await importFile(rebase('TGGCCANNNNNNNNNNNN^'));
    await screen.findByText(/Imported 1 enzyme from REBASE 699/);
    expect(screen.getByText(/check these against REBASE/)).toBeTruthy();
    expect(screen.getByText(/^HauII: REBASE now writes TGGCCANNNNNNNNNNNN\^/)).toBeTruthy();
  });
});
