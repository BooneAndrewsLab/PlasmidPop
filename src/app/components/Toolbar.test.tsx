// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { Toolbar } from './Toolbar';

const PLASMID = SeqDocument.create({
  name: 'pTest',
  sequence: 'ATGCGTACGTTAGCCATGGATCCGAATTCAAGCTTGGTACC',
  topology: 'circular',
});

/** The toolbar over whatever document is in front, as the app puts it. */
function Bar() {
  const state = useEditorState();
  return <Toolbar doc={state.history?.present ?? null} />;
}

function nameButton(): HTMLElement {
  return screen.getByRole('button', { name: /^pTest|^pRenamed/ });
}

/** The topology word, when it is marked as changed; null when it is plain. */
function shape(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.toolbar__changed');
}

describe('the toolbar says what the edit marks cannot (#31)', () => {
  beforeEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(PLASMID, 'pTest.gb');
      editorStore.setEditsBaseline('opened');
    });
  });

  it('marks nothing on a document as it was opened', () => {
    const { container } = render(<Bar />);
    expect(nameButton().className).not.toContain('toolbar__name--changed');
    expect(nameButton().title).not.toContain('Renamed');
    expect(shape(container)).toBeNull();
  });

  it('marks a rename on the name, saying what it was', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
    });
    expect(nameButton().className).toContain('toolbar__name--changed');
    expect(nameButton().title).toMatch(/^Renamed from “pTest”\n/);
    expect(nameButton().title).toContain('Click to rename');
    expect(shape(container)).toBeNull();
    expect(screen.getByRole('button', { name: /Edits/ }).title).toContain('Since opened: renamed');
  });

  it('marks a change of topology on the shape, saying what it was', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    expect(shape(container)?.textContent).toBe('linear');
    expect(shape(container)?.title).toBe('Was circular');
    expect(nameButton().className).not.toContain('toolbar__name--changed');
    expect(screen.getByRole('button', { name: /Edits/ }).title).toContain('made linear');
  });

  it('marks both at once', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    expect(nameButton().title).toMatch(/^Renamed from “pTest”/);
    expect(shape(container)?.title).toBe('Was circular');
    expect(screen.getByRole('button', { name: /Edits/ }).title).toContain('renamed · made linear');
  });

  it('takes the name a working copy gives itself for no rename', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    expect(nameButton().textContent).toContain('pTest copy');
    expect(nameButton().className).not.toContain('toolbar__name--changed');
    expect(shape(container)).toBeNull();
  });

  it('marks nothing while the marks are off', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
      editorStore.setEditsBaseline('off');
    });
    expect(nameButton().className).not.toContain('toolbar__name--changed');
    expect(nameButton().title).not.toContain('Renamed');
    expect(shape(container)).toBeNull();
  });

  it('follows the baseline: marked, back to opened, and compared', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
      editorStore.markEditsFromHere();
    });
    // Measured from here, the rename is part of the baseline.
    expect(nameButton().className).not.toContain('toolbar__name--changed');

    act(() => {
      editorStore.setEditsBaseline('opened');
    });
    expect(nameButton().title).toMatch(/^Renamed from “pTest”/);

    // Against another file, the tooltip says what that one is called and is.
    const theirs = SeqDocument.create({
      name: 'pOther',
      sequence: PLASMID.sequence.toString(),
      topology: 'linear',
    });
    act(() => {
      editorStore.markComparedInViews('theirs.gb', theirs);
    });
    expect(nameButton().title).toMatch(/^Named “pOther” in theirs\.gb\n/);
    expect(shape(container)?.title).toBe('Linear in theirs.gb');
  });
});
