// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { SHORT_WINDOW_QUERY, SHOW_IN_FORMAT_QUERY } from '../state/layout';
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
    expect(nameButton().getAttribute('data-tip')).not.toContain('Renamed');
    expect(shape(container)).toBeNull();
  });

  it('marks a rename on the name, saying what it was', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
    });
    expect(nameButton().className).toContain('toolbar__name--changed');
    expect(nameButton().getAttribute('data-tip')).toMatch(/^Renamed from “pTest”\n/);
    expect(nameButton().getAttribute('data-tip')).toContain('Click to rename');
    expect(shape(container)).toBeNull();
    expect(screen.getByRole('button', { name: /Edits/ }).getAttribute('data-tip')).toContain(
      'Since opened: renamed',
    );
  });

  it('marks a change of topology on the shape, saying what it was', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    expect(shape(container)?.textContent).toBe('linear');
    expect(shape(container)?.getAttribute('data-tip')).toBe('Was circular');
    expect(nameButton().className).not.toContain('toolbar__name--changed');
    expect(screen.getByRole('button', { name: /Edits/ }).getAttribute('data-tip')).toContain(
      'made linear',
    );
  });

  it('marks both at once', () => {
    const { container } = render(<Bar />);
    act(() => {
      editorStore.apply({ type: 'rename', name: 'pRenamed' });
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    expect(nameButton().getAttribute('data-tip')).toMatch(/^Renamed from “pTest”/);
    expect(shape(container)?.getAttribute('data-tip')).toBe('Was circular');
    expect(screen.getByRole('button', { name: /Edits/ }).getAttribute('data-tip')).toContain(
      'renamed · made linear',
    );
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
    expect(nameButton().getAttribute('data-tip')).not.toContain('Renamed');
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
    expect(nameButton().getAttribute('data-tip')).toMatch(/^Renamed from “pTest”/);

    // Against another file, the tooltip says what that one is called and is.
    const theirs = SeqDocument.create({
      name: 'pOther',
      sequence: PLASMID.sequence.toString(),
      topology: 'linear',
    });
    act(() => {
      editorStore.markComparedInViews('theirs.gb', theirs);
    });
    expect(nameButton().getAttribute('data-tip')).toMatch(/^Named “pOther” in theirs\.gb\n/);
    expect(shape(container)?.getAttribute('data-tip')).toBe('Linear in theirs.gb');
  });
});

describe('the toolbar on a short window (#296)', () => {
  // Answer the queries of a phone on its side, about 800 x 400.
  const real = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeEach(() => {
    const matchMedia = (query: string): MediaQueryList =>
      ({
        matches: query === SHOW_IN_FORMAT_QUERY || query === SHORT_WINDOW_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      value: matchMedia,
      configurable: true,
      writable: true,
    });
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(PLASMID, 'pTest.gb');
    });
  });
  afterEach(() => {
    if (real === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', real);
  });

  it('moves Complement, Translations and Cut sites into Format and keeps the rest', () => {
    render(<Bar />);
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
    expect(screen.getByRole('group', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edits/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.getByRole('menuitemcheckbox', { name: /^Complement/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /^Translations/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /^Cut sites/ })).toBeInTheDocument();
  });

  it('keeps them out of Format for a protein, which has none of the three', () => {
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({ name: 'pProt', sequence: 'MKVLAAGIVG', alphabet: 'protein' }),
        'pProt.fasta',
      );
    });
    render(<Bar />);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Complement/ })).toBeNull();
  });
});

describe('the toolbar on a wide window', () => {
  it('has the three toggles as its own buttons and not in Format', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(PLASMID, 'pTest.gb');
    });
    render(<Bar />);
    expect(screen.getByRole('group', { name: 'Show' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Complement/ })).toBeNull();
  });
});
