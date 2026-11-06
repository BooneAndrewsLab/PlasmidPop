// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  type CrisprGuide,
  type SeqDocument,
  NUCLEASES,
  findCrisprGuides,
  guideOligos,
  OLIGO_SCHEMES,
  pairNickases,
  rangeSegment,
  designPegRnas,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { forgetCrisprSessions } from '../crisprSession';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';

/**
 * Verifies docs/tutorials/crispr.md: the file it hands out and every number
 * and message it quotes, as the CRISPR tab and the CRISPR workspace print
 * them (the real components, over the real scan), so the page cannot name a
 * button or a count the app does not show.
 */

const text = readFileSync(join(__dirname, '../../../docs/tutorials/files/CR-Target.gb'), 'utf8');
const first = parseGenBank(text).documents[0];
if (first === undefined) throw new Error('CR-Target has no record');
const target: SeqDocument = first;

const SPCAS9 = NUCLEASES[0];
if (SPCAS9 === undefined) throw new Error('no SpCas9');

/** The guides as the app's scan finds them, for the numbers the page says before it shows them. */
const guides: CrisprGuide[] = findCrisprGuides(target.sequence.toString(), 'linear', SPCAS9, {
  maxMismatches: 3,
});
const byStart = (start: number): CrisprGuide => {
  const g = guides.find((x) => x.range.start + 1 === start);
  if (g === undefined) throw new Error(`no guide at ${String(start)}`);
  return g;
};

function Host() {
  const { workspace } = useEditorState();
  const doc = editorStore.document;
  if (doc === null) throw new Error('no document');
  return workspace === 'crispr' ? <CrisprWorkspace doc={doc} /> : <CrisprPanel doc={doc} />;
}

const waitForScan = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
};
const status = (): string | null => screen.getByRole('status').textContent;
const statuses = (): string[] => screen.getAllByRole('status').map((s) => s.textContent);
const notes = (selector: string): string[] =>
  [...document.body.querySelectorAll(selector)].map((n) => n.textContent);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const door = () => button('Open CRISPR workspace ›');
const rows = (name: string): HTMLElement[] =>
  within(screen.getByRole('grid', { name })).getAllByRole('row').slice(1);
const cellsOf = (row: HTMLElement): string[] =>
  [...row.querySelectorAll('td')].map((c) => c.textContent);
const railBadge = (page: RegExp): string | null =>
  screen.getByRole('tab', { name: page }).querySelector('.ws__badge')?.textContent ?? null;
const field = (label: string): HTMLElement => screen.getByLabelText(label);
const type = (label: string, value: string): void => {
  fireEvent.change(field(label), { target: { value } });
};
const detail = (): string[] =>
  [...document.querySelectorAll('.crispr-detail dt')].map(
    (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent ?? ''}`,
  );
const features = (): string[] => [...(editorStore.document?.features ?? [])].map((f) => f.name);

let copied: string[] = [];
beforeEach(() => {
  copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (t: string) => {
        copied.push(t);
        return Promise.resolve();
      },
    },
    configurable: true,
  });
  act(() => {
    editorStore.openDocument(target);
  });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetCrisprSessions();
  forgetPanels();
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

describe('the CRISPR tutorial file', () => {
  it('is the size and the features the page gives, and base 409 is the first G of a PAM', () => {
    expect(target.sequence.toString().toUpperCase().slice(407, 410)).toBe('TGG');
    expect([target.length, target.topology, target.alphabet]).toEqual([
      600,
      'linear',
      'nucleotide',
    ]);
    const [feature] = [...target.features];
    expect(feature?.name).toBe('synthetic target');
    expect(feature?.segments).toEqual([rangeSegment(230, 300)]);
  });

  it('has nine SpCas9 guides: five without flags, and the four flags the page names', () => {
    expect(guides).toHaveLength(9);
    const flagged = guides.filter(
      (g) => g.offTargets[0] !== 0 || g.polyT || g.gc < 0.4 || g.gc > 0.8 || g.longestRun >= 5,
    );
    expect(flagged.map((g) => g.range.start + 1)).toEqual([74, 133, 184, 329]);
  });
});

describe('docs/tutorials/crispr.md as the CRISPR tab and workspace show it', () => {
  describe('Exercise 1: find a guide and pick it', () => {
    it('the tab counts the guides and lists the five without flags', async () => {
      render(<Host />);
      await waitForScan();
      expect(field('Nuclease')).toHaveDisplayValue('SpCas9 (NGG)');
      expect(status()).toBe('9 guides, 5 without flags.');
      const listed = [...document.querySelectorAll('.crispr-row')];
      expect(listed.map((r) => r.textContent)).toEqual([
        '→TGTATACTCACTTGAGCGCTTGG45%0·0·0·0',
        '←ACTCTACTGTAGCGTTGATCAGG45%0·0·0·0',
        '→CATCAGCATTCATGCTCGACTGG50%0·0·0·0',
        '→CGTGTGATTCTCACGCACATTGG50%0·0·0·0',
        '←TGTCTAGAGTCTAAGTGCGATGG45%0·0·0·0',
      ]);
      // The three doors under the list.
      button('Paired nickases ›');
      button('Prime editing ›');
      fireEvent.click(door());
      expect(screen.getByRole('region', { name: 'CRISPR workspace' })).toBeInTheDocument();
    });

    it('the Guides page: 5 of 9, the note, Show flagged, and the four flags', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(door());
      expect(screen.getAllByRole('tab').map((t) => t.textContent.replace(/\d+$/, ''))).toEqual([
        'Guides',
        'Pairs',
        'Prime',
      ]);
      expect(notes('.panel__heading-note')).toEqual(['5 of 9']);
      expect(rows('Guides').map((r) => cellsOf(r).slice(0, 3).join(' '))).toEqual([
        '1 → 23–42',
        '2 ← 240–259',
        '3 → 266–285',
        '4 → 388–407',
        '5 ← 414–433',
      ]);
      expect(
        within(screen.getByRole('grid', { name: 'Guides' }))
          .getAllByRole('columnheader')
          .map((h) => h.textContent.replace(/[▲▼]/, ''))
          .filter((t) => t !== ''),
      ).toEqual(['#', 'Position', 'Spacer', 'PAM', 'GC', 'Exact', '1 mm', '2 mm', '3 mm', 'Spec.']);
      expect(statuses()).toEqual([
        '5 guides listed, of 9 found. 5 of the 9 have no flags. Flagged guides are hidden; Show flagged lists them.',
      ]);
      const note =
        'Off-targets are counted in the open documents only. PlasmidPop has no genome to search, so this says nothing about specificity in a cell: check a guide against the host genome with a genome-wide tool before ordering it.';
      expect(notes('.panel__note')).toContain(`${note} Got it`);
      fireEvent.click(button('Got it'));
      expect(notes('.panel__note').some((n) => n.startsWith('Off-targets are counted'))).toBe(
        false,
      );
      expect(screen.getByText('Off-targets up to')).toHaveAttribute('data-tip', note);

      fireEvent.click(button('Show flagged'));
      expect(notes('.panel__heading-note')).toEqual(['9 · 5 clean']);
      expect(statuses()).toEqual(['9 guides listed. 5 of the 9 have no flags.']);
      const marked = rows('Guides')
        .filter((r) => cellsOf(r).at(-1) === '!')
        .map((r) => cellsOf(r)[2]);
      expect(marked).toEqual(['74–93', '133–152', '184–203', '329–348']);
      const flagsOf = (start: number): string | null | undefined =>
        rows('Guides')
          .find((r) => cellsOf(r)[2]?.startsWith(`${String(start)}–`))
          ?.querySelector('.crispr-ws__flag')
          ?.getAttribute('data-tip');
      expect(flagsOf(74)).toBe('Binds somewhere else exactly');
      expect(flagsOf(133)).toBe('TTTT ends a U6 transcript');
      expect(flagsOf(184)).toBe('Low GC');
      expect(flagsOf(329)).toBe('Binds somewhere else exactly');
    });

    it('the guide at 74 matches the one at 329 exactly: Specificity 50 / 100 and an Other sites row', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(door());
      fireEvent.click(button('Show flagged'));
      const row = rows('Guides')[1];
      if (row === undefined) throw new Error('no row');
      expect(cellsOf(row)).toEqual([
        '2',
        '→',
        '74–93',
        'CTTCTCGCGTGAGCATCTAA',
        'AGG',
        '50%',
        '1',
        '0',
        '0',
        '0',
        '50',
        '!',
      ]);
      fireEvent.click(row);
      expect(document.querySelector('aside strong')?.textContent).toBe('Guide at 74 (forward)');
      expect(detail()).toEqual([
        'Protospacer: 74–93 (forward)',
        'Spacer: CTTCTCGCGTGAGCATCTAA',
        'PAM: AGG',
        'Cut: blunt, after base 90',
        'GC: 50%',
        'Specificity: 50 / 100',
        'Flags: Binds somewhere else exactly',
      ]);
      expect(notes('.crispr-ws__sites tbody tr')).toEqual(['exactCR-Target→ 329–348Show']);
      // The same spacer is at 329, which is the guide's own twin.
      expect(byStart(329).spacer).toBe(byStart(74).spacer);
      fireEvent.click(row);
      expect(document.querySelector('aside')).toBeNull();
    });

    it('a spacer filter finds the guide at 266, and its details and oligos are what the page says', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(door());
      type('Spacer contains', 'GCTCGAC');
      expect(notes('.panel__heading-note')).toEqual(['1 of 9']);
      expect(rows('Guides').map((r) => cellsOf(r)[2])).toEqual(['266–285']);
      // Show flagged adds the TTTT guide that shares the run.
      fireEvent.click(button('Show flagged'));
      expect(rows('Guides').map((r) => cellsOf(r)[2])).toEqual(['133–152', '266–285']);
      fireEvent.click(button('Show flagged'));
      const row = rows('Guides')[0];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(row);
      expect(document.querySelector('aside strong')?.textContent).toBe('Guide at 266 (forward)');
      expect(detail()).toEqual([
        'Protospacer: 266–285 (forward)',
        'Spacer: CATCAGCATTCATGCTCGAC',
        'PAM: TGG',
        'Cut: blunt, after base 282',
        'GC: 50%',
        'Specificity: 100 / 100',
        'Flags: none',
      ]);
      expect(field('Overhangs')).toHaveDisplayValue('pX330 / lentiCRISPRv2 (CACC / AAAC, U6 G)');
      const px330 = OLIGO_SCHEMES.find((o) => o.id === 'px330');
      if (px330 === undefined) throw new Error('no pX330');
      const oligos = guideOligos(byStart(266).spacer, px330);
      expect(notes('.crispr-oligo')).toEqual([oligos.top, oligos.bottom]);
      expect(oligos).toEqual({
        top: 'CACCGCATCAGCATTCATGCTCGAC',
        bottom: 'AAACGTCGAGCATGAATGCTGATGC',
      });
      fireEvent.click(button('Copy oligos'));
      expect(copied).toEqual([`${oligos.top}\n${oligos.bottom}`]);
      fireEvent.change(field('Overhangs'), { target: { value: 'none' } });
      expect(notes('.crispr-oligo')).toEqual(['CATCAGCATTCATGCTCGAC', 'GTCGAGCATGAATGCTGATG']);
    });

    it('Save to My primers keeps the two oligos', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(door());
      type('Spacer contains', 'GCTCGAC');
      const row = rows('Guides')[0];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(row);
      fireEvent.click(button('Save to My primers'));
      expect(await screen.findByText('Saved 2 oligos to My primers.')).toBeInTheDocument();
    });
  });

  describe('Exercise 2: guides as features', () => {
    it('Add as feature says what it did, and Undo takes it back', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(door());
      type('Spacer contains', 'GCTCGAC');
      const row = rows('Guides')[0];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(row);
      fireEvent.click(
        within(screen.getByRole('complementary')).getByRole('button', {
          name: 'Add as feature',
        }),
      );
      expect(statuses().at(-1)).toBe('Added 1 feature. Undo');
      expect(features()).toEqual(['synthetic target', 'guide 266']);
      const added = [...(editorStore.document?.features ?? [])].find((f) => f.name === 'guide 266');
      expect([
        added?.type,
        added?.strand,
        added?.qualifiers.map((q) => `${q.name}=${q.value}`),
      ]).toEqual(['misc_feature', 'forward', ['note=CRISPR protospacer, TGG PAM']]);
      fireEvent.click(button('Undo'));
      expect(features()).toEqual(['synthetic target']);
    });

    it('with the target selected, Only cuts in the selection lists two guides, and Add all adds both', async () => {
      render(<Host />);
      await waitForScan();
      const checkbox = screen.getByLabelText('Only cuts in the selection');
      expect(checkbox).toBeDisabled();
      act(() => {
        editorStore.setSelection({ start: 230, end: 300 });
      });
      expect(checkbox).toBeEnabled();
      fireEvent.click(checkbox);
      await waitForScan();
      expect(notes('.panel__note')).toContain('Cuts in 231–300');
      expect(status()).toBe('2 guides, 2 without flags.');
      fireEvent.click(door());
      expect(notes('.panel__heading-note')).toEqual(['2 · 2 clean']);
      expect(rows('Guides').map((r) => cellsOf(r).slice(1, 3).join(' '))).toEqual([
        '← 240–259',
        '→ 266–285',
      ]);
      fireEvent.click(button('Add all 2 listed as features'));
      expect(statuses().at(-1)).toBe('Added 2 features. Undo');
      expect(features()).toEqual(['synthetic target', 'guide 240', 'guide 266']);
      const strands = [...(editorStore.document?.features ?? [])].map((f) => f.strand);
      expect(strands.slice(1)).toEqual(['reverse', 'forward']);
      fireEvent.click(button('Undo'));
      expect(features()).toEqual(['synthetic target']);
    });
  });

  describe('Exercise 3: paired nickases', () => {
    it('the tab door opens Pairs, which lists five pairs, the closest first', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Paired nickases ›'));
      expect(screen.getByRole('heading', { name: 'Paired nickases' })).toBeInTheDocument();
      expect(railBadge(/^Pairs/)).toBe('5');
      expect(field('Nickase')).toHaveDisplayValue('D10A (nicks the strand the guide pairs with)');
      expect(field('Nicks at most (bp) apart')).toHaveValue(100);
      expect(
        within(screen.getByRole('grid', { name: 'Paired nickases' }))
          .getAllByRole('columnheader')
          .map((h) => h.textContent),
      ).toEqual(['#', 'Forward nick', 'Reverse nick', 'Apart (bp)', 'Overhang']);
      expect(rows('Paired nickases').map(cellsOf)).toEqual([
        [
          '1',
          '← 414–433 TGTCTAGAGTCTAAGTGCGA',
          '→ 388–407 CGTGTGATTCTCACGCACAT',
          '12',
          '12 nt 3′ overhang',
        ],
        [
          '2',
          '← 240–259 ACTCTACTGTAGCGTTGATC',
          '→ 266–285 CATCAGCATTCATGCTCGAC',
          '40',
          '40 nt 5′ overhang',
        ],
        [
          '3',
          '← 240–259 ACTCTACTGTAGCGTTGATC',
          '→ 184–203 TCATTAACAATTTGTCAGAC',
          '42',
          '42 nt 3′ overhang',
        ],
        [
          '4',
          '← 414–433 TGTCTAGAGTCTAAGTGCGA',
          '→ 329–348 CTTCTCGCGTGAGCATCTAA',
          '71',
          '71 nt 3′ overhang',
        ],
        [
          '5',
          '← 240–259 ACTCTACTGTAGCGTTGATC',
          '→ 133–152 GTTGTCGATTTTGCTCGACT',
          '93',
          '93 nt 3′ overhang',
        ],
      ]);
      expect(status()).toBe(
        '5 pairs of guides nick within 100 bp of each other, the closest first. Select one to draw its two guides.',
      );
      // The same pairs, from the function the page calls.
      const pairs = pairNickases(guides, 600, 'linear');
      expect(pairs.map((p) => [p.offset, p.overhang])).toEqual([
        [-12, '3prime'],
        [40, '5prime'],
        [-42, '3prime'],
        [-71, '3prime'],
        [-93, '3prime'],
      ]);
    });

    it('Nicks at most 50 apart leaves three, and a row selects the two guides', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Paired nickases ›'));
      type('Nicks at most (bp) apart', '50');
      expect(status()).toBe(
        '3 pairs of guides nick within 50 bp of each other, the closest first. Select one to draw its two guides.',
      );
      expect(railBadge(/^Pairs/)).toBe('3');
      type('Nicks at most (bp) apart', '');
      expect(railBadge(/^Pairs/)).toBe('5');
      expect(status()).toContain('within 100 bp');
      type('Nicks at most (bp) apart', '50');
      const row = rows('Paired nickases')[1];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(row);
      expect(editorStore.getState().selection).toEqual({ start: 239, end: 285 });
      expect(editorStore.getState().preview?.items.map((i) => [i.label, i.strand])).toEqual([
        ['AGG', 'reverse'],
        ['TGG', 'forward'],
      ]);
      expect(status()).toBe(
        '3 pairs of guides nick within 50 bp of each other, the closest first.',
      );
      fireEvent.click(row);
      expect(editorStore.getState().selection).toBeNull();
    });

    it('H840A nicks the PAM strand instead, and the pairs change', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Paired nickases ›'));
      fireEvent.change(field('Nickase'), { target: { value: 'pam' } });
      expect(rows('Paired nickases').map((r) => cellsOf(r).slice(3))).toEqual([
        ['12', '12 nt 5′ overhang'],
        ['40', '40 nt 3′ overhang'],
        ['42', '42 nt 5′ overhang'],
        ['71', '71 nt 5′ overhang'],
        ['93', '93 nt 5′ overhang'],
      ]);
      expect(
        pairNickases(guides, 600, 'linear', { nickStrand: 'pam' }).map((p) => p.offset),
      ).toEqual([12, -40, 42, 71, 93]);
    });
  });

  describe('Exercise 4: prime editing', () => {
    it('the tab door opens Prime, which asks for an edit before it lists anything', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Prime editing ›'));
      expect(screen.getByRole('heading', { name: 'Prime editing' })).toBeInTheDocument();
      expect(railBadge(/^Prime/)).toBeNull();
      expect(
        notes('.panel__note').includes(
          'Give the position of the edit, how many bases it replaces and what goes in. pegRNAs are listed for guides whose nick is up to 30 bases before it.',
        ),
      ).toBe(true);
      expect(screen.getByText('With')).toBeInTheDocument();
      expect(field('PBS (nt)')).toHaveValue(13);
    });

    it('Edit at 409, Replace 1, With C: two pegRNAs, the nearer one changing the PAM', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Prime editing ›'));
      type('Edit at', '409');
      type('Replace (bases)', '1');
      type('New bases', 'C');
      expect(railBadge(/^Prime/)).toBe('2');
      expect(
        within(screen.getByRole('grid', { name: 'pegRNAs' }))
          .getAllByRole('columnheader')
          .map((h) => h.textContent),
      ).toEqual(['#', 'Guide', 'Nick', 'Distance', 'PBS', 'PAM changed', '']);
      expect(rows('pegRNAs').map(cellsOf)).toEqual([
        ['1', '→ CGTGTGATTCTCACGCACAT TGG', '404', '4', 'TGCGTGAGAATCA', 'yes', ''],
        ['2', '← TGTCTAGAGTCTAAGTGCGA TGG', '416', '7', 'CACTTAGACTCTA', '', '!'],
      ]);
      expect(status()).toBe(
        '2 pegRNAs for this edit, the nearest nick first. Select one for its parts to copy.',
      );
      // The same, from the function the page calls.
      const pegs = designPegRnas(target.sequence.toString(), 'linear', guides, SPCAS9, {
        start: 408,
        deleteLength: 1,
        insert: 'C',
      });
      expect(pegs.map((p) => [p.nick, p.distance, p.pbs, p.disruptsPam])).toEqual([
        [404, 4, 'TGCGTGAGAATCA', true],
        [416, 7, 'CACTTAGACTCTA', false],
      ]);
      expect(rows('pegRNAs')[1]?.querySelector('.crispr-ws__flag')?.getAttribute('data-tip')).toBe(
        'The template starts with C, which can pair with the scaffold; Primer binding site GC outside 40-60%',
      );
    });

    it('the open row shows the PBS, the RT template and the 3′ extension, and copies the two lines', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Prime editing ›'));
      type('Edit at', '409');
      type('Replace (bases)', '1');
      type('New bases', 'C');
      const row = rows('pegRNAs')[0];
      if (row === undefined) throw new Error('no row');
      fireEvent.click(row);
      expect(document.querySelector('aside strong')?.textContent).toBe(
        'pegRNA for the guide at 388 (forward)',
      );
      expect(detail()).toEqual([
        'Protospacer: 388–407',
        'Nick: after base 404, 4 before the edit',
        'PAM: changed by the edit',
      ]);
      expect(notes('.crispr-peg__part')).toEqual([
        'PBSTGCGTGAGAATCACopy',
        'RT templateGTGCGATGGCGAATGCopy',
        '3′ extensionGTGCGATGGCGAATGTGCGTGAGAATCACopy',
      ]);
      expect(status()).toBe('2 pegRNAs for this edit, the nearest nick first.');
      fireEvent.click(button('Copy spacer and extension'));
      expect(copied).toEqual(['CGTGTGATTCTCACGCACAT\nGTGCGATGGCGAATGTGCGTGAGAATCA']);
      expect(screen.getByText('Copied the spacer and extension.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy the PBS' }));
      expect(copied.at(-1)).toBe('TGCGTGAGAATCA');
      // The views carry both guides and the edit, as a tick labelled with the new base.
      expect(
        editorStore.getState().preview?.items.map((i) => [i.label, i.range.start + 1, i.range.end]),
      ).toEqual([
        ['C', 409, 409],
        ['TGG', 388, 407],
        ['TGG', 414, 433],
      ]);
    });

    it('PBS (nt) 10 shortens the primer binding site, and Use the selection takes the position', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Prime editing ›'));
      expect(button('Use the selection')).toBeDisabled();
      act(() => {
        editorStore.setSelection({ start: 408, end: 409 });
      });
      fireEvent.click(button('Use the selection'));
      expect(field('Edit at')).toHaveValue(409);
      expect(field('Replace (bases)')).toHaveValue(1);
      type('New bases', 'C');
      type('PBS (nt)', '10');
      expect(rows('pegRNAs').map((r) => cellsOf(r)[4])).toEqual(['TGCGTGAGAA', 'CACTTAGACT']);
      const ten = designPegRnas(
        target.sequence.toString(),
        'linear',
        guides,
        SPCAS9,
        { start: 408, deleteLength: 1, insert: 'C' },
        { pbsLength: 10 },
      );
      expect(ten.map((p) => p.pbs)).toEqual(['TGCGTGAGAA', 'CACTTAGACT']);
    });

    it('an edit far from every guide says so', async () => {
      render(<Host />);
      await waitForScan();
      fireEvent.click(button('Prime editing ›'));
      type('Edit at', '560');
      type('Replace (bases)', '1');
      type('New bases', 'A');
      expect(status()).toBe('None of the guides found nicks within 30 bases upstream of the edit.');
      act(() => {
        editorStore.setSelection({ start: 408, end: 409 });
      });
      fireEvent.click(button('Use the selection'));
      expect(
        [field('Edit at'), field('Replace (bases)')].map((f) => (f as HTMLInputElement).value),
      ).toEqual(['409', '1']);
    });
  });
});
