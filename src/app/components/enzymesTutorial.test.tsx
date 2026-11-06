// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  activeEnzymes,
  findCutSites,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { openEnzymeWorkspace } from '../enzymeWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { EnzymePanel } from './EnzymePanel';
import { EnzymeWorkspace } from './EnzymeWorkspace';

/**
 * Verifies docs/tutorials/enzymes.md: the file it hands out and every number
 * and message it quotes, as the Enzymes tab and the Enzyme workspace print
 * them (the real components, over the bundled enzyme table), so the page
 * cannot name a button or a count the app does not show.
 */

const text = readFileSync(join(__dirname, '../../../docs/tutorials/files/EN-Plasmid.gb'), 'utf8');
const first = parseGenBank(text).documents[0];
if (first === undefined) throw new Error('EN-Plasmid has no record');
const plasmid: SeqDocument = first;

const current = (): SeqDocument => {
  const doc = editorStore.document;
  if (doc === null) throw new Error('no document');
  return doc;
};
/** What the restriction scan hands the panels, for the document as it now is. */
const scan = (): void => {
  act(() => {
    const doc = current();
    editorStore.setAnalysis(
      doc,
      findCutSites(doc.sequence.toString().toUpperCase(), doc.topology, activeEnzymes()),
      [],
    );
  });
};
/** The Enzymes tab as the app mounts it: the slim panel, or the workspace while it is open. */
function Tab() {
  const { workspace } = useEditorState();
  return workspace === 'enzymes' ? (
    <EnzymeWorkspace doc={current()} />
  ) : (
    <EnzymePanel doc={current()} />
  );
}

const status = (): string | null => screen.getByRole('status').textContent;
const grid = (name: string) => within(screen.getByRole('grid', { name }));
const rowsOf = (name: string): (string | null)[] =>
  grid(name)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent);
const rowFor = (name: string, enzyme: string): HTMLElement => {
  const row = grid(name)
    .getAllByRole('row')
    .find((r) => r.textContent.startsWith(enzyme));
  if (row === undefined) throw new Error(`no row for ${enzyme}`);
  return row;
};
const notes = (selector: string): string[] =>
  [...document.body.querySelectorAll(selector)].map((n) => n.textContent);
const chips = (): string[] => notes('.dig-chip__name');
const gelNumbers = (): string[] => notes('.dig-ws__gel text');
const grownIn = (host: string): void => {
  act(() => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Host methylation' }), {
      target: { value: host },
    });
  });
  scan();
};
const goTo = (page: RegExp): void => {
  fireEvent.click(screen.getByRole('tab', { name: page }));
};

describe('the Enzymes tutorial file', () => {
  it('is the size and the host the page gives', () => {
    expect([plasmid.length, plasmid.topology, plasmid.alphabet]).toEqual([
      600,
      'circular',
      'nucleotide',
    ]);
    expect([...plasmid.features].map((f) => f.name)).toEqual([
      'synthetic promoter',
      'synthetic cassette',
      'synthetic terminator',
    ]);
    expect(plasmid.methylation).toEqual({ dam: true, dcm: true });
  });
});

describe('docs/tutorials/enzymes.md as the Enzymes tab and workspace show it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  beforeEach(() => {
    act(() => {
      editorStore.setEnzymeCutFilter('any');
      editorStore.setEnzymeSupplier('');
      editorStore.setEnzymeSort('name');
      editorStore.setEnzymeSortReversed(false);
      editorStore.setGelAgarose(1);
      editorStore.setGelLadder('auto');
      editorStore.openDocument(plasmid);
    });
    scan();
  });
  afterEach(() => {
    cleanup();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
    forgetPanels();
  });

  describe('Exercise 1: enzymes that cut once', () => {
    it('the tab counts them, ticks them, and says what the host blocks', () => {
      render(<Tab />);
      expect(status()).toBe(
        '127 enzymes: 21 cut once, 16 more than once, 90 not at all. 21 ticked. 1 ticked site blocked by Dam/Dcm (grown in dam+/dcm+).',
      );
      expect(screen.getByLabelText('Host methylation')).toHaveValue('dam+/dcm+');
    });

    it('the workspace opens with four pages, and Cuts: Once lists 21 rows', () => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
      expect(screen.getAllByRole('tab').map((t) => t.textContent.replace(/\d+$/, ''))).toEqual([
        'Enzymes',
        'Digest',
        'Double',
        'Table',
      ]);
      expect(notes('.panel__heading-note')).toEqual(['37 of 127']);
      act(() => {
        editorStore.setEnzymeCutFilter('once');
      });
      expect(notes('.panel__heading-note')).toEqual(['21 of 127']);
      expect(rowsOf('Enzymes')).toHaveLength(21);
      // The three the tutorial uses: name, site, overhang, cuts, position, bands.
      expect(rowFor('Enzymes', 'EcoRI').textContent).toBe('EcoRIGAATTC5′191600 bp');
      expect(rowFor('Enzymes', 'BamHI').textContent).toBe('BamHIGGATCC5′1301600 bp');
      expect(rowFor('Enzymes', 'HindIII').textContent).toBe('HindIIIAAGCTT5′1451600 bp');
      // MscI cuts once on paper, with a Dcm mark on its position, and "1 of 1" in Dam/Dcm.
      expect(rowFor('Enzymes', 'MscI').textContent).toBe('MscITGGCCAblunt1385m1 of 1600 bp');
      expect(
        notes('.panel__note').some((n) => n === '21 of 127 enzymes cut once. 90 do not cut.'),
      ).toBe(true);
    });

    it('Twice lists six rows (HpaII and MspI share one), and XbaI is one of them', () => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
      act(() => {
        editorStore.setEnzymeCutFilter('twice');
      });
      expect(rowsOf('Enzymes')).toHaveLength(6);
      expect(rowFor('Enzymes', 'HpaII').textContent).toContain('+1');
      expect(rowFor('Enzymes', 'XbaI').textContent).toBe('XbaITCTAGA5′2193m5421 of 2349 + 251 bp');
    });

    it('Hide all clears the ticks, and the tab says so', () => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
      expect(status()).toBe(
        '127 enzymes: 21 cut once, 16 more than once, 90 not at all. 0 ticked.',
      );
    });
  });

  describe('Exercise 2: a double digest', () => {
    it('Find a partner lists EcoRI + BamHI, Tick both ticks them, the Digest page cuts 390 + 210', () => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
        target: { value: 'EcoRI' },
      });
      fireEvent.click(rowFor('Enzymes', 'EcoRI'));
      expect(document.body.querySelector('.enz-detail')?.textContent).toContain(
        'EcoRIGAATTC · 5′ overhang · cuts once',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Find a partner ›' }));
      expect(screen.getByRole('combobox', { name: /Pair/ })).toHaveValue('EcoRI');
      expect(rowsOf('Double digests').slice(0, 4)).toEqual([
        'EcoRISspI439 + 161 bpTick both',
        'EcoRIXbaI451 + 149 bpTick both',
        'EcoRIBstEII482 + 118 bpTick both',
        'EcoRIBamHI390 + 210 bpTick both',
      ]);
      fireEvent.click(rowFor('Double digests', 'EcoRIBamHI'));
      expect(notes('.pairs-ws__gel text')).toContain('Both');
      expect(notes('.pairs-ws__gel .panel__note')[0]).toBe(
        'EcoRI + BamHI, beside each enzyme alone. Select another pair to draw its lanes; the ticks are not changed.',
      );
      // Choosing a row ticks nothing; the button does.
      expect(editorStore.getState().shownEnzymes.size).toBe(0);
      fireEvent.click(within(rowFor('Double digests', 'EcoRIBamHI')).getByRole('button'));
      expect([...editorStore.getState().shownEnzymes].sort()).toEqual(['BamHI', 'EcoRI']);
      expect(within(rowFor('Double digests', 'EcoRIBamHI')).getByRole('button')).toHaveTextContent(
        'Ticked',
      );

      goTo(/^Digest/);
      expect(chips()).toEqual(['BamHI', 'EcoRI']);
      expect(notes('[data-testid=gel-singles]')).toEqual([
        'Beside it, each alone: BamHI 600 bp; EcoRI 600 bp.',
      ]);
      expect(notes('[data-testid=gel-reading]')).toEqual(['On a gel: 2 bands, 390 + 210 bp.']);
      expect(gelNumbers()).toEqual(
        expect.arrayContaining(['BamHI', 'EcoRI', 'Both', '390', '210']),
      );
      expect(rowsOf('Fragments')).toEqual([
        '1390 bp302–91BamHI 5′ GATCEcoRI 5′ AATTsynthetic promoter, synthetic cassette, synthetic terminatorAdd',
        '2210 bp92–301EcoRI 5′ AATTBamHI 5′ GATCsynthetic cassetteAdd',
      ]);
      expect(notes('.dig-frag .panel__note')[0]).toBe(
        '2 fragments, largest first. Add the ones to join to the shelf, and join them on the Bench.',
      );
    });
  });

  describe('Exercise 3: methylation', () => {
    const fragments = (): (string | null)[] =>
      screen.queryByRole('grid', { name: 'Fragments' }) === null
        ? []
        : rowsOf('Fragments').map((r) => r?.slice(0, 14) ?? null);

    it('XbaI has two sites and one is marked Dam', () => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
      fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
        target: { value: 'XbaI' },
      });
      expect(rowsOf('Enzymes')).toEqual(['XbaITCTAGA5′2193m5421 of 2349 + 251 bp']);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Tick XbaI' }));
      expect([...editorStore.getState().shownEnzymes]).toContain('XbaI');
      fireEvent.click(rowFor('Enzymes', 'XbaI'));
      const detail = document.body.querySelector('.enz-detail')?.textContent ?? '';
      expect(detail).toContain('1 of 2 sites may be blocked by Dam/Dcm methylation');
      expect(detail).toContain('193forwardAGGACGGAGATCTAGAGGCGAGCAGCDamSelect');
      expect(detail).toContain('542forwardGCGACTCTGGTCTAGACGATGCGTATSelect');
    });

    const open = (...ticked: string[]) => {
      act(() => {
        editorStore.setShownEnzymes(ticked);
        openEnzymeWorkspace(editorStore.getState().documentId, 'digest');
      });
      return render(<Tab />);
    };
    const host = (view: ReturnType<typeof render>, name: string): void => {
      grownIn(name);
      view.rerender(<Tab />);
    };
    const lengths = (): (string | null)[] => fragments();

    it('XbaI: one piece of 600 bp in dam+/dcm+ and dam+ only, two in dcm+ only and unmethylated', () => {
      const view = open('XbaI');
      expect(chips()).toEqual(['XbaI']);
      expect(lengths()).toEqual(['1600 bp543–542']);
      expect(notes('[data-testid=gel-reading]')).toEqual(['On a gel: 1 band, 600 bp.']);
      expect(notes('.dig-frag .panel__note--quiet')).toEqual([
        '1 site of XbaI is left out: EN-Plasmid is dam+/dcm+, and its methylation blocks it.',
      ]);
      host(view, 'dam+ only');
      expect(lengths()).toEqual(['1600 bp543–542']);
      expect(notes('.dig-frag .panel__note--quiet')).toEqual([
        '1 site of XbaI is left out: EN-Plasmid is dam+ only, and its methylation blocks it.',
      ]);
      host(view, 'dcm+ only');
      expect(lengths()).toEqual(['1349 bp194–542', '2251 bp543–193']);
      expect(notes('[data-testid=gel-reading]')).toEqual(['On a gel: 2 bands, 349 + 251 bp.']);
      expect(notes('.dig-frag .panel__note--quiet')).toEqual([]);
      host(view, 'unmethylated');
      expect(lengths()).toEqual(['1349 bp194–542', '2251 bp543–193']);
    });

    it('MscI: blocked by Dcm, so nothing is cut unless the host lacks Dcm', () => {
      const view = open('MscI');
      expect(chips()).toEqual(['MscI']);
      // Its one site is blocked, so the chip is drawn dashed (#407).
      expect(document.body.querySelectorAll('.dig-chip--idle')).toHaveLength(1);
      expect(notes('.dig-frag .panel__note')).toEqual([
        'Every site of MscI in EN-Plasmid is blocked by its dam+/dcm+ methylation, so nothing is cut. If the DNA came from a dam−/dcm− strain or a PCR, say so under Grown in above.',
      ]);
      host(view, 'dcm+ only');
      expect(notes('.dig-frag .panel__note')[0]).toContain('blocked by its dcm+ only methylation');
      host(view, 'dam+ only');
      expect(notes('.dig-chip--idle')).toEqual([]);
      expect(lengths()).toEqual(['1600 bp386–385']);
      expect(notes('[data-testid=gel-reading]')).toEqual(['On a gel: 1 band, 600 bp.']);
    });

    it('the tab counts the blocked site while MscI is ticked, and not once it is not', () => {
      const view = render(<Tab />);
      expect(status()).toContain('1 ticked site blocked by Dam/Dcm (grown in dam+/dcm+).');
      host(view, 'unmethylated');
      expect(status()).toBe(
        '127 enzymes: 21 cut once, 16 more than once, 90 not at all. 21 ticked.',
      );
    });
  });
});
