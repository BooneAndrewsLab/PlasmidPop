// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';
import { analytics } from '../analytics';
import { analysisClient } from '@/workers/analysisClient';

import {
  type CrisprSession,
  type PegEdit,
  forgetCrisprSessions,
  updateCrisprSession,
} from '../crisprSession';
import { openCrisprWorkspace } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';

// The Prime page of the CRISPR workspace (item 133, C5): the pegRNAs of item
// 81 as a table over the session's scan, with the open one's parts under it.

const FILLER = 'CTCTCTCTCT';
const SPACER = 'GACCTAGCATCGATCGGTAC';
/**
 * Three guides: the forward ones at 15-34 (CGG, which nicks after base 31)
 * and 21-40 (TGG, after base 37), and a reverse one whose nick is behind
 * both. A pegRNA is made for each of the first two for an edit at the 42nd
 * base, 10 and 4 bases past their nicks.
 */
const SEQUENCE = `${FILLER}${FILLER}${SPACER}TGGATATCTATCTAGATCTATATCTCTAGATATCT`;
const NICK = 37;
const FAR_NICK = 31;
/** A guide of A's: its PBS is all T, which no PBS should be, and ends a U6 transcript. */
const POOR = `${FILLER}${'A'.repeat(20)}TGG${FILLER}`;

function docOf(sequence: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence, topology, name: 'test' });
}

function Host({ doc }: { doc: SeqDocument }) {
  const { workspace } = useEditorState();
  return workspace === 'crispr' ? <CrisprWorkspace doc={doc} /> : <CrisprPanel doc={doc} />;
}

/** Opens the workspace on Prime, with the edit as `edit` in the session, and waits for the scan. */
async function openPrime(
  doc: SeqDocument,
  edit: Partial<PegEdit> = {},
  session: Partial<CrisprSession> = {},
) {
  act(() => {
    editorStore.openDocument(doc);
    const { documentId } = editorStore.getState();
    updateCrisprSession(documentId, (s) => ({ ...session, pegEdit: { ...s.pegEdit, ...edit } }));
    openCrisprWorkspace(documentId, 'prime');
  });
  const view = render(<Host doc={doc} />);
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
  return view;
}

/** The edit that replaces the base 4 after the nick (1-based 42), which is G, with `insert`. */
const EDIT_4 = (insert: string): Partial<PegEdit> => ({
  position: String(NICK + 4 + 1),
  replace: '1',
  insert,
});

const rowEls = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('tr[data-row]')];
const rowAt = (i: number): HTMLElement => {
  const row = rowEls()[i];
  if (row === undefined) throw new Error(`no row ${String(i)}`);
  return row;
};
const cells = (r: HTMLElement | undefined): string[] =>
  [...(r?.querySelectorAll('td') ?? [])].map((c) => c.textContent);
const railBadge = (name: RegExp): string | null =>
  screen.getByRole('tab', { name }).querySelector('.ws__badge')?.textContent ?? null;
const preview = () => editorStore.getState().preview;

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
});

afterEach(() => {
  cleanup();
  forgetCrisprSessions();
  forgetPanels();
  vi.restoreAllMocks();
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

/** The PBS of the pegRNA nicking after base `nick`: the 13 bases before it, reverse-complemented. */
const pbsAt = (doc: SeqDocument, nick: number): string =>
  reverseComplement(doc.sequence.toString().slice(nick - 13, nick));

describe('the Prime page', () => {
  it('has the edit form across the top, and says what to give while it is empty', async () => {
    await openPrime(docOf(SEQUENCE));
    const form = screen.getByRole('group', { name: 'Edit' });
    expect(within(form).getByRole('spinbutton', { name: 'Edit at' })).toHaveValue(null);
    expect(within(form).getByRole('spinbutton', { name: 'Replace (bases)' })).toHaveValue(1);
    expect(within(form).getByLabelText('New bases')).toHaveValue('');
    expect(within(form).getByRole('spinbutton', { name: 'PBS (nt)' })).toHaveValue(13);
    expect(within(form).getByRole('button', { name: 'Use the selection' })).toBeDisabled();
    expect(screen.getByText(/Give the position of the edit/)).toBeVisible();
    expect(screen.getByText(/up to 30 bases before it/)).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(railBadge(/^Prime/)).toBeNull();
  });

  it('designs pegRNAs for an edit near a nick, and says when none is near enough', async () => {
    await openPrime(docOf(SEQUENCE));
    fireEvent.change(screen.getByLabelText('New bases'), { target: { value: 'g' } });
    // Position 1 is the far left: no guide nicks before it.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: String(NICK + 4 + 1) },
    });
    expect(await screen.findByRole('grid', { name: 'pegRNAs' })).toBeVisible();
    expect(rowEls()).toHaveLength(2);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: '1' },
    });
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByText(/None of the guides found nicks within 30 bases/)).toBeVisible();
    // An edit that is nothing, or off the end, is said so, and lists nothing.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: '' },
    });
    expect(screen.getByText(/Give the position of the edit/)).toBeVisible();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: String(SEQUENCE.length + 5) },
    });
    expect(screen.getByText('The edit position is outside the sequence.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('New bases'), { target: { value: 'xx' } });
    expect(screen.getByText('The new bases must be plain A, C, G and T.')).toBeVisible();
  });

  it('lists a row for each, nearest nick first, with the guide, the nick, the distance, the PBS and the PAM', async () => {
    const doc = docOf(SEQUENCE);
    await openPrime(doc, EDIT_4('T'));
    const grid = screen.getByRole('grid', { name: 'pegRNAs' });
    expect([...grid.querySelectorAll('thead th')].map((h) => h.textContent)).toEqual([
      '#',
      'Guide',
      'Nick',
      'Distance',
      'PBS',
      'PAM changed',
      '',
    ]);
    // The base that is replaced is a G of the first guide's PAM, so this edit changes it.
    expect(cells(rowAt(0))).toEqual([
      '1',
      `→ ${SPACER} TGG`,
      String(NICK),
      '4',
      pbsAt(doc, NICK),
      'yes',
      '',
    ]);
    expect(cells(rowAt(1))).toEqual([
      '2',
      '→ CTCTCTGACCTAGCATCGAT CGG',
      String(FAR_NICK),
      '10',
      pbsAt(doc, FAR_NICK),
      '',
      '',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('2 pegRNAs for this edit');
    expect(railBadge(/^Prime/)).toBe('2');
  });

  it('says the PAM is kept where the edit leaves it alone', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('G'));
    expect(cells(rowAt(0))[5]).toBe('');
  });

  it('puts a flag in the last column, with the whole text in its tooltip', async () => {
    await openPrime(docOf(POOR), { position: '32', replace: '1', insert: 'C' });
    const flag = rowAt(0).querySelector<HTMLElement>('.crispr-ws__flag');
    expect(flag?.textContent).toBe('!');
    expect(flag?.getAttribute('data-tip')).toBe(
      'Primer binding site GC outside 40-60%; TTTT ends a U6 transcript',
    );
  });

  it('takes the PBS length from its box, within what is allowed', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'PBS (nt)' }), {
      target: { value: '10' },
    });
    expect(cells(rowAt(0))[4]).toHaveLength(10);
  });

  it('takes the edit from the selection', async () => {
    await openPrime(docOf(SEQUENCE));
    act(() => {
      editorStore.setSelection({ start: 41, end: 43 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use the selection' }));
    expect(screen.getByRole('spinbutton', { name: 'Edit at' })).toHaveValue(42);
    expect(screen.getByRole('spinbutton', { name: 'Replace (bases)' })).toHaveValue(2);
  });

  it('keeps the form when the page is left and come back to, with no new scan', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const before = scans.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Prime/ }));
    expect(screen.getByLabelText('New bases')).toHaveValue('T');
    expect(rowEls()).toHaveLength(2);
    expect(scans.mock.calls.length).toBe(before);
  });
});

describe('selecting a pegRNA', () => {
  it('selects its protospacer, opens its parts under the table, and a second click closes them', async () => {
    const doc = docOf(SEQUENCE);
    await openPrime(doc, EDIT_4('T'));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByText(/Select one for its parts to copy/)).toBeVisible();
    fireEvent.click(rowAt(0));
    expect(editorStore.getState().selection).toEqual({ start: 20, end: 40 });
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
    const detail = screen.getByRole('complementary');
    expect(within(detail).getByText('PBS')).toBeVisible();
    expect(within(detail).getByText('RT template')).toBeVisible();
    expect(within(detail).getByText('3′ extension')).toBeVisible();
    expect(
      within(detail).getByText(pbsAt(doc, NICK), { selector: '.crispr-peg__seq' }),
    ).toBeVisible();
    // The nick and what it is to the edit, and the PAM, in words.
    expect(within(detail).getByText(`after base ${String(NICK)}, 4 before the edit`)).toBeVisible();
    expect(within(detail).getByText('changed by the edit')).toBeVisible();
    fireEvent.click(rowAt(0));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(editorStore.getState().selection).toBeNull();
  });

  it('puts the whole flag text in the detail', async () => {
    await openPrime(docOf(POOR), { position: '32', replace: '1', insert: 'C' });
    fireEvent.click(rowAt(0));
    expect(
      within(screen.getByRole('complementary')).getByText(
        'Primer binding site GC outside 40-60%; TTTT ends a U6 transcript',
      ),
    ).toBeVisible();
  });

  it('copies each part, and the spacer with the extension, with one analytics event each', async () => {
    const track = vi.spyOn(analytics, 'track');
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    fireEvent.click(rowAt(0));
    const detail = within(screen.getByRole('complementary'));
    const part = (label: string): string =>
      detail.getByText(label).parentElement?.querySelector('.crispr-peg__seq')?.textContent ?? '';
    const [pbs, rtt, extension] = [part('PBS'), part('RT template'), part('3′ extension')];
    expect(extension).toBe(rtt + pbs);

    fireEvent.click(detail.getByRole('button', { name: 'Copy the PBS' }));
    expect(copied).toEqual([pbs]);
    expect(detail.getByText('Copied the PBS.')).toBeVisible();
    fireEvent.click(detail.getByRole('button', { name: 'Copy the RT template' }));
    fireEvent.click(detail.getByRole('button', { name: 'Copy the 3′ extension' }));
    fireEvent.click(detail.getByRole('button', { name: 'Copy spacer and extension' }));
    expect(copied).toEqual([pbs, rtt, extension, `${SPACER}\n${extension}`]);
    expect(detail.getByText('Copied the spacer and extension.')).toBeVisible();
    expect(track.mock.calls.filter((c) => c[1] === 'pegrna')).toHaveLength(4);
  });

  it('draws the guides that could carry the edit and a tick where it goes', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const drawn = preview();
    expect(drawn?.owners).toEqual(['crispr']);
    expect(drawn?.items.map((i) => [i.label, i.strand, i.range])).toEqual([
      ['T', 'none', { start: NICK + 4, end: NICK + 5 }],
      ['TGG', 'forward', { start: 20, end: 40 }],
      ['CGG', 'forward', { start: 14, end: 34 }],
    ]);
  });

  it('draws the tick over the bases a longer edit replaces, and one base for an insertion', async () => {
    await openPrime(docOf(SEQUENCE), { position: '42', replace: '3', insert: '' });
    expect(preview()?.items[0]).toMatchObject({ label: 'edit', range: { start: 41, end: 44 } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Replace (bases)' }), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('New bases'), { target: { value: 'ACGTACGTAC' } });
    expect(preview()?.items[0]).toMatchObject({ label: 'ACGTAC', range: { start: 41, end: 42 } });
  });

  it('draws only the tick when no guide is near it, and nothing when there is no edit', async () => {
    await openPrime(docOf(SEQUENCE), { position: '1', replace: '1', insert: 'T' });
    expect(preview()?.items.map((i) => i.strand)).toEqual(['none']);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: '' },
    });
    expect(preview()).toBeNull();
  });

  it('opens the row of a guide clicked on a view', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const guide = preview()?.items.find((i) => i.label === 'CGG');
    if (guide === undefined) throw new Error('the guide was not drawn');
    act(() => {
      editorStore.activatePreview(guide.id);
    });
    // The second row is the guide that was clicked, and its selection is the guide's.
    expect(rowAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('complementary')).toBeVisible();
  });

  it('takes the preview off when the page goes, and the tick when the workspace does', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    fireEvent.click(screen.getByRole('tab', { name: /^Pairs/ }));
    expect(preview()).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^Prime/ }));
    expect(preview()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    // The slim tab is back and draws the guides it lists, but the edit's tick is gone.
    expect(preview()?.items.some((i) => i.strand === 'none')).toBe(false);
  });

  it('keeps its pegRNA open across a page change', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    fireEvent.click(rowAt(0));
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Prime/ }));
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('complementary')).toBeVisible();
  });
});

describe('the Prime rail badge and fallbacks', () => {
  it('counts the pegRNAs from any page, and nothing before an edit is typed', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    expect(railBadge(/^Prime/)).toBe('2');
    fireEvent.click(screen.getByRole('tab', { name: /^Guides/ }));
    expect(railBadge(/^Prime/)).toBe('2');
    fireEvent.click(screen.getByRole('tab', { name: /^Prime/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Edit at' }), {
      target: { value: '1' },
    });
    expect(railBadge(/^Prime/)).toBe('0');
    fireEvent.change(screen.getByLabelText('New bases'), { target: { value: 'zz' } });
    expect(railBadge(/^Prime/)).toBeNull();
  });

  it('says what Prime needs when the nuclease cannot, and a way back', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'), { nucleaseId: 'ascas12a' });
    expect(screen.getByText(/Prime editing needs a Cas9-like nuclease/)).toBeVisible();
    expect(screen.queryByLabelText('New bases')).not.toBeInTheDocument();
    expect(railBadge(/^Prime/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByRole('heading', { name: /^Guides/ })).toBeVisible();
  });
});

describe('the keys in the pegRNA table', () => {
  it('are one stop in the tab order: the open row, or the first', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const stops = (): string[] =>
      rowEls()
        .filter((r) => r.tabIndex === 0)
        .map((r) => cells(r)[0] ?? '');
    expect(stops()).toEqual(['1']);
    fireEvent.click(rowAt(1));
    expect(stops()).toEqual(['2']);
  });

  it('walk the selection with the arrows, Home and End, and show the detail of each', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const first = rowAt(0);
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(rowAt(1)).toHaveAttribute('aria-selected', 'true');
    expect(rowAt(1)).toHaveFocus();
    expect(editorStore.getState().selection).toEqual({ start: 14, end: 34 });
    expect(screen.getByText(/pegRNA for the guide at 15/)).toBeVisible();
    fireEvent.keyDown(rowAt(1), { key: 'ArrowDown' });
    expect(rowAt(1)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(rowAt(1), { key: 'Home' });
    expect(rowAt(0)).toHaveFocus();
    expect(editorStore.getState().selection).toEqual({ start: 20, end: 40 });
    fireEvent.keyDown(rowAt(0), { key: 'End' });
    expect(rowAt(1)).toHaveFocus();
    fireEvent.keyDown(rowAt(1), { key: 'ArrowUp' });
    expect(rowAt(0)).toHaveAttribute('aria-selected', 'true');
  });

  it('select the focused row with Enter, leave the Copy buttons their own, and leave other keys alone', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const first = rowAt(0);
    first.focus();
    fireEvent.keyDown(first, { key: 'a' });
    fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true });
    expect(editorStore.getState().selection).toBeNull();
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(first).toHaveAttribute('aria-selected', 'false');
  });

  it('put the pegRNA away with Escape first, and shut the workspace with the next', async () => {
    await openPrime(docOf(SEQUENCE), EDIT_4('T'));
    const first = rowAt(0);
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(editorStore.getState().selection).toBeNull();
    expect(editorStore.getState().workspace).toBe('crispr');
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
  });
});
