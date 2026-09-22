// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

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
