// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type SeqDocument, BUNDLED_ENZYME_SET, setActiveEnzymeSet } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { GatewayPanel } from './GatewayPanel';

/**
 * The words of docs/tutorials/gateway.md as the Gateway panel prints them,
 * with the tutorial's own files open in the order the page names.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
function pick(label: string, name: string): void {
  const el = screen.getByLabelText<HTMLSelectElement>(label);
  const option = [...el.options].find((o) => o.text.startsWith(`${name} — `));
  if (option === undefined) throw new Error(`no tab ${name} in ${label}`);
  act(() => {
    fireEvent.change(el, { target: { value: option.value } });
  });
}
const click = (name: string): void => {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};
const optionTexts = (label: string): string[] =>
  [...screen.getByLabelText<HTMLSelectElement>(label).options].map((o) => o.text);
const warnings = (): (string | null)[] =>
  within(screen.getByLabelText('Assembly warnings'))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

function setUp(...names: string[]): void {
  act(() => {
    for (const n of names) editorStore.openDocument(tut(n));
    editorStore.setCloningReaction('gateway');
  });
  render(<GatewayPanel />);
}

describe('gateway.md as the Gateway panel shows it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('opens on LR; BP names its two roles, and each tab lists the att sites it annotates', () => {
    setUp('GW-Insert', 'GW-pDONR');
    expect(screen.getByRole('button', { name: 'LR' }).getAttribute('aria-pressed')).toBe('true');
    click('BP');
    expect(screen.getByRole('button', { name: 'BP' }).getAttribute('aria-pressed')).toBe('true');
    expect(optionTexts('attB substrate')).toEqual([
      'choose a tab',
      'GW-Insert — attB1, attB2',
      'GW-pDONR — attP1, attP2',
    ]);
    expect(optionTexts('donor vector')).toEqual(optionTexts('attB substrate'));
    expect(
      screen.getByText(
        'Choose the attB substrate and the donor vector. A BP needs two attB sites on the first and two attP sites on the second.',
      ),
    ).toBeTruthy();
  });

  it('BP: a 1,412 bp entry clone, one ccdB sentence, no byproduct button for a linear substrate', () => {
    setUp('GW-Insert', 'GW-pDONR');
    click('BP');
    pick('attB substrate', 'GW-Insert');
    pick('donor vector', 'GW-pDONR');
    expect(screen.getByText('Entry clone:')).toBeTruthy();
    expect(screen.getByLabelText('Product').textContent).toBe(
      'Product: 1,412 bp, circular · synthGene, KanR, ori, attL1, attL2',
    );
    expect(warnings()).toEqual([
      'The ccdB cassette of GW-pDONR leaves on the byproduct, so an entry clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
    ]);
    expect(screen.getByRole('button', { name: 'Open clone' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open byproduct' })).toBeNull();
    click('Open clone');
    expect(editorStore.document?.name).toBe('GW-Insert × GW-pDONR BP');
    expect(editorStore.document?.length).toBe(1412);
    expect(editorStore.document?.topology).toBe('circular');
  });

  it('LR from the entry clone tab: a 1,551 bp expression clone and a 1,698 bp byproduct', () => {
    setUp('GW-Insert', 'GW-pDONR', 'GW-pDEST');
    click('BP');
    pick('attB substrate', 'GW-Insert');
    pick('donor vector', 'GW-pDONR');
    click('Open clone');
    act(() => {
      // The clone is a tab of its own; the Bench is the page in front again.
      editorStore.setCloningReaction('gateway');
    });
    click('LR');
    expect(optionTexts('entry clone')).toEqual([
      'choose a tab',
      'GW-Insert — attB1, attB2',
      'GW-pDONR — attP1, attP2',
      'GW-pDEST — attR1, attR2',
      'GW-Insert × GW-pDONR BP — attL2, attL1',
    ]);
    pick('entry clone', 'GW-Insert × GW-pDONR BP');
    pick('destination vector', 'GW-pDEST');
    expect(screen.getByText('Expression clone:')).toBeTruthy();
    expect(screen.getByLabelText('Product').textContent).toBe(
      'Product: 1,551 bp, circular · synthGene, synthetic promoter, synthetic terminator, AmpR, ori, attB1, +1 more',
    );
    expect(warnings()).toEqual([
      'The ccdB cassette of GW-pDEST leaves on the byproduct, so an expression clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
    ]);
    click('Open byproduct');
    expect(editorStore.document?.name).toBe('GW-Insert × GW-pDONR BP × GW-pDEST LR byproduct');
    expect(editorStore.document?.length).toBe(1698);
  });

  it('LR with attR3 for attR2: the sites do not pair, in red, and nothing to open', () => {
    setUp('GW-Insert', 'GW-pDONR', 'GW-bad-pDEST');
    click('BP');
    pick('attB substrate', 'GW-Insert');
    pick('donor vector', 'GW-pDONR');
    click('Open clone');
    act(() => {
      editorStore.setCloningReaction('gateway');
    });
    click('LR');
    pick('entry clone', 'GW-Insert × GW-pDONR BP');
    pick('destination vector', 'GW-bad-pDEST');
    expect(
      screen.getByText(
        'The sites do not pair: GW-Insert × GW-pDONR BP has attL1 and attL2, GW-bad-pDEST has attR1 and attR3. Each number recombines only with its own.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open clone' })).toBeNull();
  });

  it('an attB insert offered as the entry clone: no attL site annotated', () => {
    setUp('GW-Insert', 'GW-pDEST');
    click('LR');
    pick('entry clone', 'GW-Insert');
    pick('destination vector', 'GW-pDEST');
    expect(
      screen.getByText(
        'GW-Insert has no attL site annotated. A LR needs two, flanking the DNA to move; annotate them, or open a file that does.',
      ),
    ).toBeTruthy();
  });
});
