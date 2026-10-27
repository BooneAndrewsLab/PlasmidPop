// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { createFeature, DEFAULT_PRIMER_CRITERIA, rangeSegment, SeqDocument } from '@/core';

import { rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerWorkspace } from './PrimerWorkspace';

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

/** Opens the document with the workspace on `page`. */
function open(d: SeqDocument = doc, page: 'design' | 'results' | 'check' | 'mine' = 'design') {
  act(() => {
    const id = editorStore.openDocument(d);
    rememberWorkspacePage(id, page);
    editorStore.setPrimerWorkspace(true);
  });
  return render(<PrimerWorkspace doc={d} />);
}

/** Opens the document with a target selected and the first pair designed. */
function setup() {
  const view = open();
  act(() => {
    editorStore.setSelection({ start: 250, end: 350 });
  });
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
  });
  return view;
}

/** Goes to one of the pages by its rail tab. */
function page(name: 'Design' | 'Results' | 'Check' | 'My primers'): void {
  act(() => {
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
  });
}

/** The Results table's body rows, one a pair; none when there is no design. */
function pairRows(): HTMLElement[] {
  const grid = screen.queryByRole('grid', { name: 'Candidate pairs' });
  return grid === null ? [] : within(grid).getAllByRole('row').slice(1);
}

/** Selects the first pair, which shows it on the map (item 107). */
function selectFirst(): void {
  const row = pairRows()[0];
  if (row === undefined) throw new Error('no pair was designed');
  act(() => {
    fireEvent.click(row);
  });
}

/** The detail pane's "Show on map", the pair's preview and selection. */
function showOnMap(): HTMLElement {
  return screen.getByRole('checkbox', { name: 'Show on map' });
}

describe('PrimerWorkspace', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('gives the selection back when a shown pair is hidden', () => {
    setup();
    const target = editorStore.getState().selection;
    selectFirst();
    const product = editorStore.getState().selection;
    expect(product).not.toBeNull();
    expect(product).not.toEqual(target);
    expect(editorStore.getState().preview?.items.length).toBe(3);
    expect(showOnMap()).toBeChecked();

    act(() => {
      fireEvent.click(showOnMap());
    });
    // The preview and the highlight go together: a product left selected
    // reads as a pair still being shown. The row stays selected (point 3).
    expect(editorStore.getState().selection).toBeNull();
    expect(editorStore.getState().preview).toBeNull();
    expect(showOnMap()).not.toBeChecked();
    expect(screen.getByRole('row', { selected: true })).toBeInTheDocument();
  });

  it('leaves a selection the user made since alone', () => {
    setup();
    selectFirst();
    const mine = { start: 10, end: 20 };
    act(() => {
      editorStore.setSelection(mine);
    });
    act(() => {
      fireEvent.click(showOnMap());
    });
    expect(editorStore.getState().selection).toEqual(mine);
  });

  it('takes its selection away with it when the tab is left', () => {
    const view = setup();
    selectFirst();
    expect(editorStore.getState().selection).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(editorStore.getState().selection).toBeNull();
  });

  it('keeps the target when the same selection is designed for again', () => {
    setup();
    selectFirst();
    // Designing for the product is a new target, not a preview this panel
    // is holding: hiding nothing must not clear it.
    page('Design');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(editorStore.getState().selection).not.toBeNull();
  });
});

describe('a design made before the sequence changed (#132)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('drops the pairs when the bases are edited, so nothing stale can be added', () => {
    const view = setup();
    selectFirst();
    expect(screen.getByRole('button', { name: 'Add both as features' })).toBeInTheDocument();
    act(() => {
      editorStore.apply({ type: 'insert', position: 240, text: 'GGGGGGGGGG' });
    });
    const edited = editorStore.document;
    if (edited === null) throw new Error('no document');
    view.rerender(<PrimerWorkspace doc={edited} />);
    expect(pairRows()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Add both as features' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save both' })).toBeNull();
    // Designing again works on the new template.
    page('Design');
    act(() => {
      editorStore.setSelection({ start: 260, end: 360 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(pairRows().length).toBeGreaterThan(0);
  });

  it.each([
    ['reverse complement', { type: 'reverseComplement' }],
    ['topology change', { type: 'setTopology', topology: 'circular' }],
  ] as const)('drops the pairs after a %s too', (_, op) => {
    const view = setup();
    act(() => {
      editorStore.apply(op);
    });
    view.rerender(<PrimerWorkspace doc={editorStore.document ?? doc} />);
    expect(pairRows()).toHaveLength(0);
  });

  it('keeps the pairs when only the annotations change', () => {
    const view = setup();
    act(() => {
      editorStore.apply({
        type: 'addFeature',
        feature: createFeature({ type: 'gene', name: 'g', segments: [rangeSegment(10, 20)] }),
      });
    });
    view.rerender(<PrimerWorkspace doc={editorStore.document ?? doc} />);
    expect(pairRows().length).toBeGreaterThan(0);
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
    page('Design');
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
    page('Design');
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

  it('says nothing in the Settings row at the defaults, and sums a change up with a flag (#226, item 107)', () => {
    setup();
    page('Design');
    const summary = screen.getByText('Settings').closest('summary');
    expect(summary?.textContent).toBe('Settings');
    const box = screen.getByLabelText('Lowest Tm');
    act(() => {
      fireEvent.change(box, { target: { value: '58' } });
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    expect(summary?.textContent).toBe(
      'Settingschanged18–27 nt, Tm 58–65 °C, GC 35–65 %, within 0–200 bp of the target',
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    });
  });

  it('lists each pair as a row of rank, product, ΔTm, the two primers and Spec., and the selected one in full (item 107)', () => {
    setup();
    const [row] = pairRows();
    if (row === undefined) throw new Error('no pair was designed');
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(cells).toHaveLength(10);
    expect(cells[0]).toBe('1');
    expect(cells[3]).toMatch(/^[ACGT]{18,27}$/);
    expect(cells[6]).toMatch(/^[ACGT]{18,27}$/);
    expect(cells[9]).toBe('not checked');
    expect(screen.queryByRole('complementary')).toBeNull();
    selectFirst();
    const detail = within(screen.getByRole('complementary', { name: 'Pair 1' }));
    // The visible label is short; the accessible name is the guide's.
    expect(detail.getByRole('button', { name: 'Add both as features' }).textContent).toBe(
      'Add both',
    );
    expect(detail.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Add both',
      'Save both',
      'Copy',
    ]);
    expect(detail.getByText(/^hairpin \d · \d$/)).toBeInTheDocument();
    expect(detail.getByText(/^elsewhere /)).toBeInTheDocument();
  });
});

describe('checking a degenerate primer (#76)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('shows ranges over the mix, and finds the site a code stands for', () => {
    open(doc, 'check');
    const site = template().slice(100, 122);
    // An N where the template has whatever base, and an R/Y that covers it.
    const b = site.charAt(12);
    const code = { A: 'R', G: 'R', C: 'Y', T: 'Y' }[b] ?? 'N';
    const primer = `${site.slice(0, 5)}N${site.slice(6, 12)}${code}${site.slice(13)}`;
    act(() => {
      fireEvent.change(screen.getByLabelText('Primer sequence'), { target: { value: primer } });
    });
    const summary = screen.getByLabelText('Primer summary');
    expect(summary.textContent).toMatch(/^22 ntTm \d+\.\d–\d+\.\d °CGC \d+%–\d+%(clamp)?mix of 8$/);
    // The degenerate positions are the mix's tooltip, not a paragraph (item 107).
    expect(screen.getByText('mix of 8').getAttribute('data-tip')).toMatch(/2 degenerate positions/);
    const sites = screen.getByRole('table', { name: 'Binding sites' });
    const [row] = within(sites).getAllByRole('row').slice(1);
    expect(row?.textContent).toBe('→101–122exact');
  });

  it('shows a plain primer as before', () => {
    open(doc, 'check');
    act(() => {
      fireEvent.change(screen.getByLabelText('Primer sequence'), {
        target: { value: template().slice(100, 122) },
      });
    });
    expect(screen.getByLabelText('Primer summary').textContent).toMatch(
      /^22 ntTm \d+\.\d °CGC \d+%(clamp)?$/,
    );
    expect(screen.queryByText(/mix of/)).toBeNull();
    expect(screen.getByText(/^No hairpin|^Hairpin \d/)).toBeInTheDocument();
  });
});

describe('a target through the origin (#143)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('writes the target with its end wrapped onto the circle', () => {
    const circle = SeqDocument.create({ sequence: template(), topology: 'circular' });
    open(circle);
    act(() => {
      editorStore.setSelection({ start: 590, end: 620 });
    });
    expect(screen.getByText('591–20').closest('p')?.textContent).toBe('591–20 · 30 bp');
  });

  it('says which target found no pairs the same way', () => {
    const poly = SeqDocument.create({ sequence: 'A'.repeat(600), topology: 'circular' });
    open(poly);
    act(() => {
      editorStore.setSelection({ start: 590, end: 620 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(screen.getByText(/No suitable pairs for 591–20\./)).toBeInTheDocument();
  });
});

describe('the workspace shell (item 107)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('puts the keyboard on the page heading when it opens, and on the next page heading after a design', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Design primers' }));
    act(() => {
      editorStore.setSelection({ start: 250, end: 350 });
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Results' }));
  });

  it('walks the rail with the arrow keys, keeping the keyboard on the rail', () => {
    open();
    const rail = screen.getByRole('tablist', { name: 'Primer workspace pages' });
    const design = screen.getByRole('tab', { name: 'Design' });
    design.focus();
    act(() => {
      fireEvent.keyDown(rail, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('tab', { name: /^Results/ })).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Results/ }));
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(rail, { key: 'ArrowUp' });
    });
    act(() => {
      fireEvent.keyDown(rail, { key: 'ArrowUp' });
    });
    expect(screen.getByRole('heading', { name: /^My primers/ })).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(rail, { key: 'Home' });
    });
    expect(screen.getByRole('heading', { name: 'Design primers' })).toBeInTheDocument();
    // Only the active page's tab is a Tab stop.
    expect(design).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /^Check/ })).toHaveAttribute('tabindex', '-1');
  });

  it('shuts on Escape with the keyboard inside, unless something inner took the key', () => {
    open();
    const heading = screen.getByRole('heading', { name: 'Design primers' });
    // An open Settings disclosure folds first and keeps the workspace.
    const summary = screen.getByText('Settings').closest('summary');
    if (summary === null) throw new Error('no settings summary');
    act(() => {
      fireEvent.click(summary);
    });
    expect(summary.closest('details')).toHaveAttribute('open');
    act(() => {
      fireEvent.keyDown(summary, { key: 'Escape' });
    });
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(editorStore.getState().primerWorkspace).toBe(true);
    // With nothing inner to take it, Escape shuts the workspace.
    act(() => {
      fireEvent.keyDown(heading, { key: 'Escape' });
    });
    expect(editorStore.getState().primerWorkspace).toBe(false);
  });

  it('closes from its own button too', () => {
    open();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close the primer workspace' }));
    });
    expect(editorStore.getState().primerWorkspace).toBe(false);
  });

  it('says the target changed on Results and hides the preview, keeping the rows (point 3)', () => {
    setup();
    expect(screen.queryByText(/Target changed/)).toBeNull();
    selectFirst();
    // The shown pair's product is the design's own selection, not a new target.
    expect(screen.queryByText(/Target changed/)).toBeNull();
    expect(editorStore.getState().preview?.items).toHaveLength(3);
    act(() => {
      editorStore.setSelection({ start: 10, end: 20 });
    });
    expect(screen.getByText(/Target changed/)).toBeInTheDocument();
    expect(screen.getByRole('row', { selected: true })).toBeInTheDocument();
    expect(editorStore.getState().preview).toBeNull();
    // Design again goes back to the Design page, on the new selection.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design again' }));
    });
    expect(screen.getByRole('heading', { name: 'Design primers' })).toBeInTheDocument();
    expect(screen.getByText('11–20').closest('p')?.textContent).toBe('11–20 · 10 bp');
  });

  it('follows the selection live on Design, and draws the search windows around it', () => {
    open();
    expect(screen.getByText(/Nothing selected/)).toBeInTheDocument();
    expect(editorStore.getState().preview).toBeNull();
    act(() => {
      editorStore.setSelection({ start: 250, end: 350 });
    });
    expect(screen.getByText('251–350').closest('p')?.textContent).toBe('251–350 · 100 bp');
    const windows = editorStore.getState().preview?.items.map((i) => [i.id, i.range]);
    expect(windows).toEqual([
      ['primers:fwd-window', { start: 50, end: 250 }],
      ['primers:rev-window', { start: 350, end: 550 }],
    ]);
  });

  it('offers the features as targets, and names the one the selection is', () => {
    const annotated = doc.addFeature(
      createFeature({
        type: 'CDS',
        name: 'gfp',
        strand: 'reverse',
        segments: [rangeSegment(100, 400)],
      }),
    );
    open(annotated);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Feature' }));
    });
    const select = screen.getByRole('combobox', { name: 'Feature to design for' });
    act(() => {
      fireEvent.change(select, { target: { value: annotated.features.all()[0]?.id } });
    });
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 400 });
    expect(screen.getByText('gfp').closest('p')?.textContent).toBe(
      'gfp 101–400 · 300 bp · reverse strand',
    );
    // A click elsewhere on the map takes over: the chooser follows the selection.
    act(() => {
      editorStore.setSelection({ start: 10, end: 20 });
    });
    expect((select as HTMLSelectElement).value).toBe('');
    expect(screen.queryByText('gfp')).toBeNull();
  });
});

describe('the map strip (item 107, point 5)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('is there, unfolded, where the map cannot be beside the workspace, and not in the split', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setPrimerWorkspace(true);
    });
    const { unmount } = render(<PrimerWorkspace doc={doc} layout="full" />);
    const fold = screen.getByText('Map');
    expect(fold.closest('details')?.open).toBe(true);
    expect(screen.getByRole('img', { name: `Map strip of ${doc.name}` })).toBeInTheDocument();
    unmount();
    render(<PrimerWorkspace doc={doc} layout="split" />);
    expect(screen.queryByText('Map')).toBeNull();
  });

  it('folds and remembers it, across the phone and the full layout', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setPrimerWorkspace(true);
    });
    const { unmount } = render(<PrimerWorkspace doc={doc} layout="phone" />);
    const details = screen.getByText('Map').closest('details');
    if (details === null) throw new Error('no strip');
    act(() => {
      details.open = false;
      fireEvent(details, new Event('toggle'));
    });
    expect(screen.queryByRole('img', { name: /Map strip/ })).toBeNull();
    unmount();
    render(<PrimerWorkspace doc={doc} layout="full" />);
    expect(screen.getByText('Map').closest('details')?.open).toBe(false);
  });
});
