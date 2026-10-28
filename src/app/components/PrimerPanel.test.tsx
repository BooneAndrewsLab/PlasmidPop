// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { closePrimerWorkspace, recallWorkspace, rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerPanel } from './PrimerPanel';
import { PrimerWorkspace } from './PrimerWorkspace';

// The same fixed 600-bp template the workspace tests design on.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const doc = SeqDocument.create({ name: 'pSlim', sequence: template() });

function open(d: SeqDocument = doc) {
  act(() => {
    editorStore.openDocument(d);
  });
  return render(<PrimerPanel doc={d} />);
}

describe('the slim Primers tab (item 107)', () => {
  afterEach(() => {
    forgetPanels();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('opens the workspace on Design with nothing selected too', () => {
    open();
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Design primers…' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const state = editorStore.getState();
    expect(state).toMatchObject({ primerWorkspace: true, sidebarTab: 'primers' });
    expect(recallWorkspace(state.documentId).page).toBe('design');
  });

  it('names the selection and opens the workspace on Design from it', () => {
    open();
    const button = screen.getByRole('button', { name: 'Design primers…' });
    act(() => {
      editorStore.setSelection({ start: 250, end: 350 });
    });
    expect(screen.getByText('251–350 · 100 bp')).toBeInTheDocument();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const state = editorStore.getState();
    expect(state).toMatchObject({
      primerWorkspace: true,
      sidebarTab: 'primers',
      sidebarOpen: true,
    });
    expect(recallWorkspace(state.documentId).page).toBe('design');
  });

  it('checks a pasted primer at a glance: length, Tm, GC, clamp and where it binds', () => {
    open();
    const primer = template().slice(100, 122);
    fireEvent.change(screen.getByLabelText('Primer sequence'), { target: { value: primer } });
    const stats = screen.getByText('22 nt').closest('p');
    expect(stats?.textContent).toMatch(/^22 ntTm \d+\.\d °CGC \d+%(clamp)?$/);
    const sites = screen.getByRole('list', { name: 'Binding sites' });
    const [site] = within(sites).getAllByRole('button');
    expect(site?.textContent).toBe('→101–122exact');
    // The sites are the tab's preview, and a click selects one.
    expect(editorStore.getState().preview?.items).toHaveLength(1);
    if (site === undefined) throw new Error('no site');
    fireEvent.click(site);
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 122 });
    // The full check, with the warnings and the actions, is the workspace's Check page.
    fireEvent.click(screen.getByRole('button', { name: 'Full check ›' }));
    expect(editorStore.getState().primerWorkspace).toBe(true);
    expect(recallWorkspace(editorStore.getState().documentId).page).toBe('check');
  });

  it('lists the primer_bind features of the document, and selects one on a click', () => {
    const annotated = doc
      .addFeature(
        createFeature({
          type: 'primer_bind',
          name: 'M13 rev',
          strand: 'reverse',
          segments: [rangeSegment(470, 487)],
        }),
      )
      .addFeature(
        createFeature({ type: 'primer_bind', name: 'M13 fwd', segments: [rangeSegment(373, 390)] }),
      )
      .addFeature(
        createFeature({ type: 'CDS', name: 'not a primer', segments: [rangeSegment(1, 50)] }),
      );
    open(annotated);
    const list = screen.getByRole('list', { name: 'Primers on this document' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['→M13 fwd374–390', '←M13 rev471–487']);
    const [, rev] = within(list).getAllByRole('button');
    if (rev === undefined) throw new Error('no second primer');
    fireEvent.click(rev);
    expect(editorStore.getState().selection).toEqual({ start: 470, end: 487 });
  });

  it('offers the last design, which reopens the workspace on Results, and My primers on its page', () => {
    // A design made in the workspace, which then shuts.
    act(() => {
      const id = editorStore.openDocument(doc);
      rememberWorkspacePage(id, 'design');
      editorStore.setPrimerWorkspace(true);
      editorStore.setSelection({ start: 250, end: 350 });
    });
    const workspace = render(<PrimerWorkspace doc={doc} />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    act(() => {
      closePrimerWorkspace(true);
    });
    workspace.unmount();
    render(<PrimerPanel doc={doc} />);
    // Shut with Escape, the keyboard comes back to the button that opens it.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Design primers…' }));
    fireEvent.click(screen.getByRole('button', { name: /^Last design · \d+ pairs ›$/ }));
    expect(editorStore.getState().primerWorkspace).toBe(true);
    expect(recallWorkspace(editorStore.getState().documentId).page).toBe('results');
    act(() => {
      closePrimerWorkspace();
    });
    fireEvent.click(screen.getByRole('button', { name: /^My primers…/ }));
    expect(recallWorkspace(editorStore.getState().documentId).page).toBe('mine');
  });
});
