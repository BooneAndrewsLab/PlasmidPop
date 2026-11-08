// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, reverseComplement } from '@/core';
import { analysisClient } from '@/workers/analysisClient';

import { forgetCrisprSessions } from '../crisprSession';
import { openCrisprWorkspace, recallCrisprPage } from '../crisprWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { CrisprPanel } from './CrisprPanel';
import { CrisprWorkspace } from './CrisprWorkspace';

/** One SpCas9 site: 20 A's and a TGG PAM, then filler with no GG or CC. */
const UNIT = `${'A'.repeat(20)}TGG`;
const FILLER = 'CTCTCTCTCT';
const doc = SeqDocument.create({
  name: 'target',
  sequence: `${UNIT}${FILLER}${reverseComplement(UNIT)}`,
});

function Host({ layout }: { layout?: 'split' | 'full' | 'phone' }) {
  const { workspace } = useEditorState();
  return workspace === 'crispr' ? (
    <CrisprWorkspace doc={doc} layout={layout ?? 'split'} />
  ) : (
    <CrisprPanel doc={doc} />
  );
}

/** Waits for the scan, then asks for the flagged guides the all-A spacer is. */
async function scanned(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
  });
}

const door = () => screen.getByRole('button', { name: 'Open CRISPR workspace ›' });

describe('CrisprWorkspace (item 133, C2)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
  });
  afterEach(() => {
    cleanup();
    forgetCrisprSessions();
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
    vi.restoreAllMocks();
  });

  it('opens from the slim panel on the Guides page, with the sidebar on CRISPR', async () => {
    render(<Host />);
    // The slim panel works with the workspace closed.
    await scanned();
    expect(screen.getByLabelText('Nuclease')).toBeInTheDocument();
    expect(screen.queryByLabelText('Spacer contains')).not.toBeInTheDocument();
    fireEvent.click(door());
    expect(editorStore.getState()).toMatchObject({
      workspace: 'crispr',
      sidebarTab: 'crispr',
      sidebarOpen: true,
    });
    expect(screen.getByRole('region', { name: 'CRISPR workspace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Guides/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /^Guides/ })).toHaveFocus();
    expect(recallCrisprPage(editorStore.getState().documentId)).toBe('guides');
  });

  it('is one scan with the panel: no rescan on opening, and the filter outlives it', async () => {
    const scans = vi.spyOn(analysisClient, 'crisprGuides');
    render(<Host />);
    await scanned();
    const before = scans.mock.calls.length;
    fireEvent.click(door());
    expect(screen.queryByText('Looking for guides…')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Spacer contains'), { target: { value: 'AAAA' } });
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    expect(editorStore.getState().workspace).toBeNull();
    // Back in the panel, and in the workspace again: the filter is the session's.
    fireEvent.click(door());
    expect(screen.getByLabelText('Spacer contains')).toHaveValue('AAAA');
    expect(scans.mock.calls.length).toBe(before);
  });

  it('has the pairs table and the prime form on their pages, and remembers the page', async () => {
    render(<Host />);
    await scanned();
    fireEvent.click(door());
    fireEvent.click(screen.getByRole('tab', { name: /^Pairs/ }));
    expect(screen.getByRole('heading', { name: 'Paired nickases' })).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: 'Paired nickases' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nickase')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Prime/ }));
    expect(screen.getByRole('heading', { name: 'Prime editing' })).toBeInTheDocument();
    expect(await screen.findByLabelText('New bases')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close the crispr workspace/i }));
    // Reopened, it is on the page it was left on.
    fireEvent.click(door());
    expect(screen.getByRole('heading', { name: 'Prime editing' })).toBeInTheDocument();
  });

  it('says why Pairs and Prime are empty for a nuclease that cannot, and goes back to Guides', async () => {
    render(<Host />);
    await scanned();
    fireEvent.click(door());
    const nuclease = screen.getByRole('combobox', { name: /nuclease/i });
    fireEvent.change(nuclease, { target: { value: 'ascas12a' } });
    await scanned();
    fireEvent.click(screen.getByRole('tab', { name: /^Pairs/ }));
    expect(screen.getByText(/Paired nickases need a Cas9-like nuclease/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));
    expect(screen.getByRole('heading', { name: 'Guides' })).toBeInTheDocument();
  });

  it('walks the rail with the arrow keys, keeping the keyboard on the rail', async () => {
    render(<Host />);
    await scanned();
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId, 'guides');
    });
    const first = screen.getByRole('tab', { name: /^Guides/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: /^Pairs/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Pairs/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /^Prime/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Prime editing' })).toBeInTheDocument();
  });

  it('shuts on Escape with the keyboard inside, handing it back to the panel', async () => {
    render(<Host />);
    await scanned();
    // The tab's own door: Escape stays on this tab (a link on another tab goes back to it, #404).
    act(() => {
      editorStore.setSidebarTab('crispr');
    });
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId, 'guides');
    });
    fireEvent.keyDown(screen.getByRole('heading', { name: /^Guides/ }), { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
    expect(door()).toHaveFocus();
  });

  it('is shut by another sidebar tab, and by the sidebar being put away', async () => {
    render(<Host />);
    await scanned();
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId);
    });
    act(() => {
      editorStore.setSidebarTab('features');
    });
    expect(editorStore.getState().workspace).toBeNull();
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId);
      editorStore.setSidebarOpen(false);
    });
    expect(editorStore.getState().workspace).toBeNull();
    // One workspace at a time: opening the other replaces it.
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId);
      editorStore.setWorkspace('enzymes');
    });
    expect(editorStore.getState()).toMatchObject({ workspace: 'enzymes', sidebarTab: 'enzymes' });
  });

  it('on a phone fills the screen, the rail across the top and a way back', async () => {
    render(<Host layout="phone" />);
    await scanned();
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId, 'pairs');
    });
    expect(screen.getByRole('tablist', { name: 'CRISPR workspace pages' })).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
    expect(document.querySelector('.ws--phone')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to target' }));
    expect(editorStore.getState().workspace).toBeNull();
  });

  it('counts the guides listed on the rail', async () => {
    render(<Host />);
    await scanned();
    act(() => {
      openCrisprWorkspace(editorStore.getState().documentId, 'guides');
    });
    const rail = screen.getByRole('tablist', { name: 'CRISPR workspace pages' });
    // The all-A spacers are flagged, so hidden until asked for; the count is of what is listed.
    await waitFor(() => {
      expect(within(rail).getByRole('tab', { name: /^Guides/ })).toHaveTextContent(/\d/);
    });
  });
});
