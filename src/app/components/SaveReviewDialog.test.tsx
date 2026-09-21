// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { editorStore } from '../state/editorStore';
import { CopyBanner } from './CopyBanner';
import { SaveReviewDialog } from './SaveReviewDialog';

const original = SeqDocument.create({
  name: 'pRev',
  sequence: 'ACGTTGCAAG'.repeat(30),
  topology: 'circular',
});

/** Opens the file, makes `edit` happen to it, and asks for the review. */
function setup(
  edit: () => void = () => {
    editorStore.apply({ type: 'insert', position: 10, text: 'TTTTT' });
  },
) {
  act(() => {
    editorStore.closeAllDocuments();
    const id = editorStore.openDocument(original, 'pRev.gb');
    edit();
    editorStore.requestSaveReview(id, 'pRev.gb');
  });
}

describe('SaveReviewDialog', () => {
  it('shows nothing until a save is under review', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(original, 'pRev.gb');
    });
    const { container } = render(<SaveReviewDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('names the copy and the file it came from, and draws what changed', () => {
    setup();
    const { container } = render(<SaveReviewDialog />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    // The copy is what is being saved; the original is named as untouched.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('pRev copy');
    expect(container.querySelector('.dialog__body')?.textContent).toContain('pRev.gb');
    expect(container.querySelector('.save-review__summary')?.textContent).toBe('+5 bp');
    // One changed neighbourhood, drawn as sequence rows.
    expect(container.querySelectorAll('.diff-strip')).toHaveLength(1);
    expect(container.querySelector('.diff-strip__label')?.textContent).toBe(
      'around 11 inserted 5 bp',
    );
    expect(container.querySelector('.diff-strip canvas')).toBeTruthy();
  });

  it('says where the copy goes, which depends on the browser', () => {
    setup();
    const { container, rerender } = render(<SaveReviewDialog />);
    // jsdom has no File System Access API, which is the case to describe:
    // there is nowhere to choose, and each save is another download.
    expect(container.querySelector('.dialog__body')?.textContent).toContain('downloads folder');
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();

    const w = window as unknown as Record<string, unknown>;
    w['showOpenFilePicker'] = () => Promise.resolve([]);
    w['showSaveFilePicker'] = () => Promise.resolve(null);
    rerender(<SaveReviewDialog />);
    expect(container.querySelector('.dialog__body')?.textContent).toContain('You choose where');
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    delete w['showOpenFilePicker'];
    delete w['showSaveFilePicker'];
  });

  it('gathers changes far apart into one strip each', () => {
    setup(() => {
      editorStore.apply({ type: 'insert', position: 10, text: 'TTTTT' });
      editorStore.apply({ type: 'insert', position: 250, text: 'GG' });
    });
    const { container } = render(<SaveReviewDialog />);
    expect(container.querySelectorAll('.diff-strip')).toHaveLength(2);
    expect(container.querySelector('.save-review__summary')?.textContent).toBe('+7 bp');
  });

  it('says what each snippet did to the sequence', () => {
    setup(() => {
      editorStore.apply({ type: 'delete', range: { start: 20, end: 26 } });
    });
    const { container } = render(<SaveReviewDialog />);
    expect(container.querySelector('.diff-strip__label')?.textContent).toContain('deleted 6 bp');
  });

  it('lists features that were added', () => {
    setup(() => {
      editorStore.apply({
        type: 'addFeature',
        feature: createFeature({
          type: 'CDS',
          name: 'bla',
          segments: [rangeSegment(10, 40)],
        }),
      });
    });
    const { container } = render(<SaveReviewDialog />);
    expect(container.querySelector('.save-review__features')?.textContent).toContain('bla');
    expect(container.querySelector('.save-review__summary')?.textContent).toBe('1 feature');
  });

  it('says so when the copy has drifted back to the original', () => {
    setup(() => {
      editorStore.apply({ type: 'insert', position: 10, text: 'TTTTT' });
      editorStore.undo();
    });
    const { container } = render(<SaveReviewDialog />);
    expect(container.querySelector('.save-review__empty')?.textContent).toContain(
      'Nothing differs',
    );
    expect(container.querySelectorAll('.diff-strip')).toHaveLength(0);
  });

  it('closes on Cancel and on Escape without saving', () => {
    setup();
    const view = render(<SaveReviewDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(editorStore.getState().saveReview).toBeNull();
    expect(view.container.firstChild).toBeNull();

    act(() => {
      editorStore.requestSaveReview(editorStore.getState().documentId ?? '', 'pRev.gb');
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(editorStore.getState().saveReview).toBeNull();
  });
});

describe('CopyBanner', () => {
  it('stays away until the document is a working copy', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(original, 'pRev.gb');
    });
    const view = render(<CopyBanner />);
    expect(view.container.firstChild).toBeNull();
    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    expect(view.container.querySelector('.copy-banner')?.textContent).toContain('pRev.gb');
    // It names the copy as well as the file, because that name is what a
    // download will be called.
    expect(view.container.querySelector('.copy-banner')?.textContent).toContain('pRev copy');
  });

  it('renames the copy in place', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(original, 'pRev.gb');
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    render(<CopyBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Document name' });
    fireEvent.change(field, { target: { value: 'my construct' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editorStore.document?.name).toBe('my construct');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    // The name the user chose stays put, edit after edit.
    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'T' });
    });
    expect(editorStore.document?.name).toBe('my construct');
  });

  it('opens the review of what changed', () => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(original, 'pRev.gb');
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    render(<CopyBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'See what changed' }));
    expect(editorStore.getState().saveReview).toEqual({ fileName: 'pRev.gb' });
    act(() => {
      editorStore.dismissSaveReview();
    });
  });
});
