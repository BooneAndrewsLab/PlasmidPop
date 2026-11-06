// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { type CutSite, SeqDocument, activeEnzymes } from '@/core';

import { openEnzymeWorkspace, recallEnzymePage } from '../enzymeWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { EnzymePanel } from './EnzymePanel';
import { EnzymeWorkspace } from './EnzymeWorkspace';

// 4,000 bp, linear.
const doc = SeqDocument.create({ name: 'target', sequence: 'ACGT'.repeat(1000) });

/** The first `n` enzymes of the active table, each cutting the document once. */
function singleCutters(n: number): CutSite[] {
  return activeEnzymes()
    .slice(0, n)
    .map((enzyme, i) => ({
      enzyme: enzyme.name,
      cut: i * 100 + 1,
      cutBottom: i * 100 + 1,
      siteStart: i * 100,
      strand: 'forward' as const,
    }));
}

function Host({ layout }: { layout?: 'split' | 'full' | 'phone' }) {
  const { workspace } = useEditorState();
  return workspace === 'enzymes' ? (
    <EnzymeWorkspace doc={doc} layout={layout ?? 'split'} />
  ) : (
    <EnzymePanel doc={doc} />
  );
}

function filterBox(): HTMLElement {
  return screen.getByRole('searchbox', { name: 'Filter enzymes' });
}

describe('EnzymeWorkspace (item 133, E2)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, singleCutters(5), []);
    });
  });
  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  it('opens from the slim panel on the Enzymes page, with the sidebar on Enzymes', () => {
    render(<Host />);
    // The panel's list works with the workspace closed.
    expect(filterBox()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
    expect(editorStore.getState()).toMatchObject({
      workspace: 'enzymes',
      sidebarTab: 'enzymes',
      sidebarOpen: true,
    });
    expect(screen.getByRole('region', { name: 'Enzyme workspace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Enzymes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: /^Enzymes/ })).toHaveFocus();
    expect(recallEnzymePage(editorStore.getState().documentId)).toBe('enzymes');
  });

  it('keeps the filter and the ticks with the panel both ways, and remembers the page', () => {
    render(<Host />);
    fireEvent.change(filterBox(), { target: { value: 'E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
    expect(filterBox()).toHaveValue('E');
    fireEvent.click(screen.getByRole('button', { name: 'Hide all' }));
    fireEvent.click(screen.getByRole('tab', { name: /^Digest/ }));
    // Nothing ticked: the page is there but off, and the heading says why.
    expect(screen.getByRole('heading', { name: 'DigestNothing is ticked' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is ticked, so there is no digest/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close the enzyme workspace/i }));
    expect(editorStore.getState().workspace).toBeNull();
    expect(filterBox()).toHaveValue('E');
    expect(editorStore.getState().shownEnzymes.size).toBe(0);
    // Reopened, it is on the page it was left on.
    fireEvent.click(screen.getByRole('button', { name: 'Open Enzyme workspace ›' }));
    expect(screen.getByRole('heading', { name: /^Digest/ })).toBeInTheDocument();
  });

  it('has Grown in in the head of every page, the same edit as the panel', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    for (const tab of [/^Enzymes/, /^Digest/, /^Double/, /^Table/]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getAllByRole('combobox', { name: 'Host methylation' })).toHaveLength(1);
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'Host methylation' }), {
      target: { value: 'unmethylated' },
    });
    expect(editorStore.getState().history?.present.methylation).toEqual({
      dam: false,
      dcm: false,
    });
  });

  it('mounts the gel and fragments on Digest, the pairs on Double and the open forms on Table', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'digest');
    });
    expect(screen.getByRole('grid', { name: 'Fragments' })).toBeVisible();
    expect(screen.getByTestId('gel-reading')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Double/ }));
    // One heading, the shell's: the page no longer has a second of its own.
    expect(screen.getAllByRole('heading', { name: 'Double digests' })).toHaveLength(1);
    expect(screen.getByRole('grid', { name: 'Double digests' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Table/ }));
    expect(screen.getByRole('heading', { name: 'Enzyme table' })).toBeInTheDocument();
    // Both forms are open sections, with nothing to open or close.
    expect(screen.getByRole('heading', { name: 'Import an enzyme table' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Add an enzyme' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('walks the rail with the arrow keys, keeping the keyboard on the rail', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    const first = screen.getByRole('tab', { name: /^Enzymes/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: /^Digest/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Digest' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Digest/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /^Table/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Enzyme table' })).toBeInTheDocument();
  });

  it('shuts on Escape with the keyboard inside, handing it back to the panel', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    fireEvent.keyDown(screen.getByRole('heading', { name: /^Enzymes/ }), { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Enzyme workspace ›' })).toHaveFocus();
  });

  it('is shut by another sidebar tab, and by the sidebar being put away', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId);
    });
    act(() => {
      editorStore.setSidebarTab('features');
    });
    expect(editorStore.getState().workspace).toBeNull();
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId);
      editorStore.setSidebarOpen(false);
    });
    expect(editorStore.getState().workspace).toBeNull();
    // One workspace at a time: opening the other replaces it.
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId);
      editorStore.setWorkspace('align');
    });
    expect(editorStore.getState()).toMatchObject({ workspace: 'align', sidebarTab: 'align' });
  });

  it('on a phone fills the screen, the rail across the top and a way back', () => {
    render(<Host layout="phone" />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'digest');
    });
    expect(screen.getByRole('tablist', { name: 'Enzyme workspace pages' })).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
    expect(document.querySelector('.ws--phone')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to target' }));
    expect(editorStore.getState().workspace).toBeNull();
  });

  it('counts the listed enzymes and the fragments on the rail', () => {
    render(<Host />);
    act(() => {
      openEnzymeWorkspace(editorStore.getState().documentId, 'enzymes');
    });
    const rail = screen.getByRole('tablist', { name: 'Enzyme workspace pages' });
    expect(within(rail).getByRole('tab', { name: /^Enzymes/ })).toHaveTextContent(/\d/);
    // Five single cutters ticked by themselves digest a linear piece into six.
    expect(within(rail).getByRole('tab', { name: /^Digest/ })).toHaveTextContent('6');
  });
});
