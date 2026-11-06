// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { forgetAlignSessions, readAlignSession, updateAlignSession } from '../alignSession';
import { openAlignWorkspace, recallAlignPage } from '../alignWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { AlignPanel } from './AlignPanel';
import { AlignWorkspace } from './AlignWorkspace';

const doc = SeqDocument.create({ name: 'target', sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT' });

function Host({ layout }: { layout?: 'split' | 'full' | 'phone' }) {
  const { workspace } = useEditorState();
  return workspace === 'align' ? (
    <AlignWorkspace doc={doc} layout={layout ?? 'split'} />
  ) : (
    <AlignPanel doc={doc} />
  );
}

function box(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Sequence to align' });
}

describe('AlignWorkspace (item 129, #354)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
  });
  afterEach(() => {
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
    forgetAlignSessions();
    forgetPanels();
  });

  it('opens from the slim panel on the page asked for, with the sidebar on Align', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Align workspace ›' }));
    expect(editorStore.getState()).toMatchObject({
      workspace: 'align',
      sidebarTab: 'align',
      sidebarOpen: true,
    });
    expect(screen.getByRole('tab', { name: /^Align$/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Align to the document' })).toHaveFocus();
    expect(recallAlignPage(editorStore.getState().documentId)).toBe('align');
  });

  it('shares the box with the panel both ways, and remembers the page', () => {
    render(<Host />);
    fireEvent.change(box(), { target: { value: '>one\nACGTACGTAC\n>two\nACGTACGAAC\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assemble reads ›' }));
    expect(screen.getByRole('heading', { name: 'Assemble reads' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assemble reads' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: /^Align$/ }));
    expect(box()).toHaveValue('>one\nACGTACGTAC\n>two\nACGTACGAAC\n');
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.click(screen.getByRole('button', { name: /close the align workspace/i }));
    expect(editorStore.getState().workspace).toBeNull();
    expect(box()).toHaveValue('GGCCAATTGGCC');
    // Reopened, it is on the page it was left on.
    fireEvent.click(screen.getByRole('button', { name: 'Open Align workspace ›' }));
    expect(screen.getByRole('heading', { name: 'Align to the document' })).toBeInTheDocument();
  });

  it('walks the rail with the arrow keys, keeping the keyboard on the rail', () => {
    render(<Host />);
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId, 'align');
    });
    const align = screen.getByRole('tab', { name: /^Align$/ });
    align.focus();
    fireEvent.keyDown(align, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: /^Results/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: /^Results/ }), { key: 'End' });
    expect(screen.getByRole('tab', { name: /^Multiple/ })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Multiple alignment' })).toBeInTheDocument();
  });

  it('shuts on Escape with the keyboard inside, handing it back to the panel; a window of its own keeps Escape', async () => {
    render(<Host />);
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId, 'align');
    });
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    const large = await screen.findByRole('button', { name: 'Large view' });
    fireEvent.click(large);
    const dialog = screen.getByRole('dialog');
    // Escape inside the large view closes it, not the workspace behind it.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(editorStore.getState().workspace).toBe('align');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(editorStore.getState().workspace).toBe('align');
    // With nothing inner to take it, Escape shuts the workspace.
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Results' }), { key: 'Escape' });
    expect(editorStore.getState().workspace).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Align workspace ›' })).toHaveFocus();
  });

  it('is shut by another sidebar tab, and by the sidebar being put away', () => {
    render(<Host />);
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId);
    });
    act(() => {
      editorStore.setSidebarTab('features');
    });
    expect(editorStore.getState().workspace).toBeNull();
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId);
      editorStore.setSidebarOpen(false);
    });
    expect(editorStore.getState().workspace).toBeNull();
    // One workspace at a time: opening the other replaces it.
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId);
      editorStore.setWorkspace('primers');
    });
    expect(editorStore.getState()).toMatchObject({ workspace: 'primers', sidebarTab: 'primers' });
  });

  it('on a phone fills the screen, the rail across the top and a way back', () => {
    render(<Host layout="phone" />);
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId, 'results');
    });
    expect(screen.getByRole('tablist', { name: 'Align workspace pages' })).toHaveAttribute(
      'aria-orientation',
      'horizontal',
    );
    expect(document.querySelector('.ws--phone')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to target' }));
    expect(editorStore.getState().workspace).toBeNull();
  });

  it('counts the results and the contigs on the rail, from the session', () => {
    render(<Host />);
    act(() => {
      openAlignWorkspace(editorStore.getState().documentId, 'results');
      updateAlignSession(editorStore.getState().documentId, {
        batch: {
          rows: [
            { index: 0, name: 'a', length: 8, status: 'failed', message: 'no' },
            { index: 1, name: 'b', length: 8, status: 'failed', message: 'no' },
          ],
          total: 3,
          cancelled: false,
          reference: { sequence: 'ACGT', offset: 0, wrap: null },
          features: [{}, {}, {}],
        },
      });
    });
    expect(screen.getByRole('tab', { name: /^Results ?0$/ })).toBeInTheDocument();
    expect(screen.getByText('3 reads')).toBeInTheDocument();
    expect(readAlignSession(editorStore.getState().documentId).batch?.total).toBe(3);
  });
});
