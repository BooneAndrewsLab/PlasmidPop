// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DEFAULT_PRIMER_CRITERIA, SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { PrimerPanel } from './PrimerPanel';

// A pseudo-random but fixed 600-bp template with balanced composition, the
// same one the design tests use, so pairs are found.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const doc = SeqDocument.create({ sequence: template() });

/** Opens the document with a target selected and the first pair designed. */
function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setSelection({ start: 250, end: 350 });
  });
  const view = render(<PrimerPanel doc={doc} />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
  });
  return view;
}

function firstToggle(): HTMLElement {
  const button = screen.getAllByRole('button', { name: /^Show$|^Hide$/ })[0];
  if (button === undefined) throw new Error('no pair was designed');
  return button;
}

describe('PrimerPanel', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('gives the selection back when a shown pair is hidden', () => {
    setup();
    const target = editorStore.getState().selection;
    act(() => {
      fireEvent.click(firstToggle());
    });
    const product = editorStore.getState().selection;
    expect(product).not.toBeNull();
    expect(product).not.toEqual(target);
    expect(editorStore.getState().preview?.items.length).toBe(3);

    act(() => {
      fireEvent.click(firstToggle());
    });
    // The preview and the highlight go together: a product left selected
    // reads as a pair still being shown.
    expect(editorStore.getState().selection).toBeNull();
    expect(editorStore.getState().preview).toBeNull();
  });

  it('leaves a selection the user made since alone', () => {
    setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    const mine = { start: 10, end: 20 };
    act(() => {
      editorStore.setSelection(mine);
    });
    act(() => {
      fireEvent.click(firstToggle());
    });
    expect(editorStore.getState().selection).toEqual(mine);
  });

  it('takes its selection away with it when the tab is left', () => {
    const view = setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    expect(editorStore.getState().selection).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(editorStore.getState().selection).toBeNull();
  });

  it('keeps the target when the same selection is designed for again', () => {
    setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    // Designing for the product is a new target, not a preview this panel
    // is holding: hiding nothing must not clear it.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(editorStore.getState().selection).not.toBeNull();
  });
});

describe('primer settings', () => {
  afterEach(() => {
    act(() => {
      editorStore.setPrimerCriteria(DEFAULT_PRIMER_CRITERIA);
    });
  });

  it('commits a typed number on leaving the box, and designs to it', () => {
    setup();
    const box = screen.getByLabelText('Shortest primer');
    act(() => {
      fireEvent.change(box, { target: { value: '2' } });
    });
    // Nothing is committed while the number is still being typed.
    expect(editorStore.getState().primerCriteria.minLength).toBe(18);
    act(() => {
      fireEvent.change(box, { target: { value: '22' } });
      fireEvent.blur(box);
    });
    const c = editorStore.getState().primerCriteria;
    expect(c.minLength).toBe(22);
    expect(c.maxLength).toBe(27);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(screen.getAllByText(/^[ACGT]{22,27}$/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/^[ACGT]{18,21}$/)).toHaveLength(0);
  });

  it('moves the other end of a range rather than leaving it backwards', () => {
    setup();
    const box = screen.getByLabelText('Lowest Tm');
    act(() => {
      fireEvent.change(box, { target: { value: '70' } });
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(editorStore.getState().primerCriteria).toMatchObject({ minTm: 70, maxTm: 70 });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    });
    expect(editorStore.getState().primerCriteria).toEqual(DEFAULT_PRIMER_CRITERIA);
  });
});

describe('checking a degenerate primer (#76)', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('shows ranges over the mix, and finds the site a code stands for', () => {
    act(() => {
      editorStore.openDocument(doc);
    });
    render(<PrimerPanel doc={doc} />);
    const site = template().slice(100, 122);
    // An N where the template has whatever base, and an R/Y that covers it.
    const b = site.charAt(12);
    const code = { A: 'R', G: 'R', C: 'Y', T: 'Y' }[b] ?? 'N';
    const primer = `${site.slice(0, 5)}N${site.slice(6, 12)}${code}${site.slice(13)}`;
    act(() => {
      fireEvent.change(screen.getByLabelText('Primer sequence'), { target: { value: primer } });
    });
    const summary = screen.getByText(/22 nt, Tm/);
    expect(summary.textContent).toMatch(/Tm \d+\.\d–\d+\.\d °C, GC \d+%–\d+%/);
    expect(screen.getByText(/Degenerate: 2 positions, a mix of 8 molecules/)).toBeInTheDocument();
    expect(screen.getByText('1 binding site:')).toBeInTheDocument();
    expect(screen.getByText('101–122')).toBeInTheDocument();
    expect(screen.getByText('exact')).toBeInTheDocument();
  });

  it('shows a plain primer as before', () => {
    act(() => {
      editorStore.openDocument(doc);
    });
    render(<PrimerPanel doc={doc} />);
    act(() => {
      fireEvent.change(screen.getByLabelText('Primer sequence'), {
        target: { value: template().slice(100, 122) },
      });
    });
    expect(screen.getByText(/22 nt, Tm/).textContent).toMatch(/Tm \d+\.\d °C, GC \d+%/);
    expect(screen.queryByText(/Degenerate:/)).toBeNull();
  });
});
