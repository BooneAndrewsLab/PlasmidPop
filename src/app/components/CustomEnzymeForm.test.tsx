// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { activeEnzymes, getEnzyme } from '@/core';
import { parseCustomEnzyme } from '@/io';

import { persistence } from '../state/persistence';
import { CustomEnzymeForm } from './CustomEnzymeForm';
import { describeEnzyme, notationOf } from './customEnzymeText';

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('CustomEnzymeForm (#217)', () => {
  afterEach(async () => {
    for (const name of ['MyEco', 'MyBsa']) await persistence.removeCustomEnzyme(name);
  });

  it('previews the cuts and says whether the site is palindromic', () => {
    render(<CustomEnzymeForm onClose={() => undefined} />);
    type('Enzyme name', 'MyEco');
    type('Recognition site in REBASE notation', 'G^AATT_C');
    const preview = screen.getByTestId('custom-enzyme-preview');
    expect(preview.textContent).toContain('G^AATT_C');
    expect(preview.textContent).toContain('palindromic');
    expect(preview.textContent).toContain('Top strand cut: after base 1');
    expect(preview.textContent).toContain('Bottom strand cut: after base 5');
    expect(preview.textContent).toContain("4-nt 5' overhang (AATT)");
  });

  it('describes a Type IIS enzyme', () => {
    render(<CustomEnzymeForm onClose={() => undefined} />);
    type('Enzyme name', 'MyBsa');
    type('Recognition site in REBASE notation', 'GGTCTC(1/5)');
    const text = screen.getByTestId('custom-enzyme-preview').textContent;
    expect(text).toContain('not palindromic');
    expect(text).toContain('Top strand cut: 1 nt past the site');
    expect(text).toContain('Bottom strand cut: 5 nt past the site');
  });

  it('shows the parser error and keeps Save off', () => {
    render(<CustomEnzymeForm onClose={() => undefined} />);
    type('Enzyme name', 'Bad');
    type('Recognition site in REBASE notation', 'GAATTC');
    expect(screen.getByText(/Mark where it cuts/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save enzyme' }).disabled).toBe(
      true,
    );
  });

  it('saves into the active set, refuses a name the table has, and removes', async () => {
    render(<CustomEnzymeForm onClose={() => undefined} />);
    type('Enzyme name', 'MyEco');
    type('Recognition site in REBASE notation', 'G^AATT_C');
    await act(async () => {
      fireEvent.click(screen.getByText('Save enzyme'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText(/Saved MyEco/)).toBeTruthy();
    expect(getEnzyme('myeco')?.cutBottom).toBe(5);
    expect(activeEnzymes().some((e) => e.name === 'MyEco' && e.custom === true)).toBe(true);

    type('Enzyme name', 'EcoRI');
    type('Recognition site in REBASE notation', 'G^AATTC');
    await act(async () => {
      fireEvent.click(screen.getByText('Save enzyme'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.getByText(/already an enzyme of the table in use/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Remove'));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(activeEnzymes().some((e) => e.name === 'MyEco')).toBe(false);
  });

  it('survives a restart', async () => {
    await persistence.addCustomEnzyme({
      name: 'MyBsa',
      site: 'GGTCTC',
      cutTop: 7,
      cutBottom: 11,
      palindromic: false,
    });
    await persistence.restoreEnzymeSet();
    expect(getEnzyme('MyBsa')?.custom).toBe(true);
  });

  it('writes notation back as it was read', () => {
    for (const n of ['G^AATTC', 'G^AATT_C', 'GGTCTC(1/5)', '(10/12)CGANNNNNNTGC(12/10)']) {
      const r = parseNotation(n);
      expect(describeEnzyme(r).length).toBeGreaterThan(2);
      expect(notationOf(r)).toBe(n === 'G^AATTC' ? 'G^AATT_C' : n);
    }
  });
});

function parseNotation(n: string) {
  const r = parseCustomEnzyme('X', n);
  if (!r.ok) throw new Error(r.error);
  return r.enzyme;
}
