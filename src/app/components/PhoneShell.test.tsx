// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature } from '@/core';

import { editorStore } from '../state/editorStore';
import { PhoneShell } from './PhoneShell';

const doc = SeqDocument.create({
  name: 'circle',
  sequence: 'ACGT'.repeat(1000),
  topology: 'circular',
  features: [
    createFeature({
      id: 'f1',
      type: 'CDS',
      name: 'thing',
      segments: [{ kind: 'range', start: 100, end: 900, partialStart: false, partialEnd: false }],
    }),
  ],
});

function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setSidebarTab('features');
  });
  return render(<PhoneShell doc={doc} />);
}

const pane = (name: string): HTMLElement => screen.getByRole('tab', { name });
const map = (): HTMLElement | null => screen.queryByRole('img', { name: 'Map of circle' });
const sequence = (): HTMLElement | null => screen.queryByRole('textbox', { name: 'Sequence' });

describe('PhoneShell', () => {
  beforeEach(() => {
    localStorage.removeItem('plasmidpop.phoneNoticeSeen');
  });
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('starts on the map and shows one pane at a time', () => {
    setup();
    expect(map()).toBeInTheDocument();
    expect(sequence()).toBeNull();
    fireEvent.click(pane('Sequence'));
    expect(sequence()).toBeInTheDocument();
    expect(map()).toBeNull();
    fireEvent.click(pane('Details'));
    expect(sequence()).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Features' })).toBeInTheDocument();
  });

  it('lists features to look at, not to edit', () => {
    setup();
    fireEvent.click(pane('Details'));
    const row = screen.getByRole('button', { name: /thing/ });
    fireEvent.click(row);
    expect(editorStore.getState().selectedFeatureId).toBe('f1');
    // No Rename, Edit or Remove under the selected row, and a double tap
    // does not open a rename: any of them would fork a working copy.
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.doubleClick(row);
    expect(editorStore.getState().renameRequest).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers Features and Enzymes, falling back to Features from a tab it has not got', () => {
    setup();
    act(() => {
      editorStore.setSidebarTab('primers');
    });
    fireEvent.click(pane('Details'));
    expect(screen.getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('complementary', { name: 'Features' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Enzymes' }));
    expect(editorStore.getState().sidebarTab).toBe('enzymes');
    expect(screen.queryByRole('complementary', { name: 'Features' })).toBeNull();
  });

  it('goes back to the view last looked at when a list reveals a position', () => {
    setup();
    fireEvent.click(pane('Sequence'));
    fireEvent.click(pane('Details'));
    expect(sequence()).toBeNull();
    act(() => {
      editorStore.selectFeature('f1');
    });
    expect(sequence()).toBeInTheDocument();
  });

  it('stays put when a view reveals a position itself', () => {
    setup();
    act(() => {
      editorStore.selectFeature('f1');
    });
    expect(map()).toBeInTheDocument();
    fireEvent.click(pane('Details'));
    // No reveal since the switch: the list stays.
    expect(screen.getByRole('complementary', { name: 'Features' })).toBeInTheDocument();
  });

  it("comes back to a tab's own pane after a switch of tabs (#43)", () => {
    const first = setup();
    fireEvent.click(pane('Sequence'));
    const firstId = editorStore.getState().documentId;
    first.unmount();
    // Another tab: the shell is keyed by document, so it mounts afresh.
    const other = SeqDocument.create({ name: 'other', sequence: 'GGCC'.repeat(10) });
    act(() => {
      editorStore.openDocument(other);
    });
    const second = render(<PhoneShell doc={other} />);
    expect(screen.queryByRole('img', { name: 'Map of other' })).toBeInTheDocument();
    second.unmount();
    act(() => {
      editorStore.closeDocument();
      editorStore.activateDocument(firstId);
    });
    render(<PhoneShell doc={doc} />);
    expect(sequence()).toBeInTheDocument();
    expect(pane('Sequence')).toHaveAttribute('aria-selected', 'true');
  });

  it('answers a reveal with the map when the tab came back on Details', () => {
    setup();
    fireEvent.click(pane('Sequence'));
    fireEvent.click(pane('Details'));
    cleanup();
    // Remounted on Details, as a switch of tabs or a reload brings it back.
    render(<PhoneShell doc={doc} />);
    act(() => {
      editorStore.revealPosition(500);
    });
    // Details was the pane; the view it came from before was not seen by
    // this mount, so the map is where it goes.
    expect(map()).toBeInTheDocument();
  });

  it('says once that this is the reader', () => {
    const view = setup();
    expect(screen.getByRole('status')).toHaveTextContent(/reader/);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status')).toBeNull();
    view.unmount();
    setup();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
