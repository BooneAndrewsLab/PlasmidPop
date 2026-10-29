// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { editorStore } from '../state/editorStore';
import { LONG_PRESS_MS, LinearSequenceView, TAP_TIP_MS } from './LinearSequenceView';
import { currentFollowTooltip, hideFollowTooltip } from './tooltip';

/**
 * Without a canvas, `measureCharWidth` falls back to 8 px a character and the
 * default font gives a 72 px gutter, so a column's x is predictable here.
 */
const CHAR_WIDTH = 8;
const LEFT_GUTTER = 72;

const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(500) });

function setup(d = doc) {
  act(() => {
    editorStore.openDocument(d);
    editorStore.setSeqBasesPerRow(120);
  });
  const view = render(<LinearSequenceView doc={d} />);
  const canvas = view.container.querySelector('canvas');
  const container = view.container.querySelector('.seq-view');
  if (canvas === null || container === null) throw new Error('no view');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  return { canvas, container };
}

/** Scrolls the container sideways the way a real scrollbar would. */
function scrollTo(container: Element, scrollLeft: number): void {
  Object.defineProperty(container, 'scrollLeft', { value: scrollLeft, configurable: true });
  fireEvent.scroll(container);
}

function clickColumn(canvas: Element, x: number): void {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
}

/** A finger at column `x`. */
function touch(x: number): Record<string, unknown> {
  return { clientX: x, clientY: 30, button: 0, pointerId: 2, pointerType: 'touch' };
}

describe('LinearSequenceView', () => {
  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.closeDocument();
    });
  });

  it('floats the selection bar beside a selection once the drag that makes it ends (#89)', () => {
    const { canvas, container } = setup();
    const bar = (): Element | null => container.querySelector('.selection-bar');
    expect(bar()).toBeNull();
    const at = (column: number) => ({
      clientX: LEFT_GUTTER + column * CHAR_WIDTH,
      clientY: 30,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerDown(canvas, at(10));
    fireEvent.pointerMove(canvas, at(20));
    // Not while the selection is still being dragged out.
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 20 });
    expect(bar()).toBeNull();
    fireEvent.pointerUp(canvas, at(20));
    expect(bar()).not.toBeNull();
    expect(bar()?.textContent).toContain('10 bp');
    // A caret has nothing for it to act on.
    clickColumn(canvas, LEFT_GUTTER + 5 * CHAR_WIDTH);
    expect(bar()).toBeNull();
  });

  it('puts the selection bar under the translations of a row, not over them (#115)', () => {
    const barTop = (d: SeqDocument): number => {
      act(() => {
        editorStore.openDocument(d);
        editorStore.setSeqBasesPerRow(120);
        editorStore.setSelection({ start: 100, end: 150 });
      });
      const view = render(<LinearSequenceView doc={d} />);
      const bar = view.container.querySelector<HTMLElement>('.selection-bar');
      if (bar === null) throw new Error('no bar');
      const top = parseFloat(bar.style.top);
      view.unmount();
      return top;
    };
    const cds = createFeature({
      id: 'c',
      type: 'CDS',
      name: 'orf',
      segments: [{ kind: 'range', start: 0, end: 600, partialStart: false, partialEnd: false }],
    });
    const plain = barTop(doc);
    const withCds = barTop(SeqDocument.create({ sequence: 'ACGT'.repeat(500), features: [cds] }));
    // The translation and the feature lane make the row taller; the bar clears both.
    expect(withCds).toBeGreaterThan(plain + 20);
  });

  describe('scrolling to a request (#317)', () => {
    const tops = new WeakMap<Element, number>();
    const range = (start: number, end: number) => ({
      kind: 'range' as const,
      start,
      end,
      partialStart: false,
      partialEnd: false,
    });
    /** The signal peptide that gets selected; it is not itself translated. */
    const peptide = createFeature({
      id: 'p',
      type: 'sig_peptide',
      name: 'peptide',
      segments: [range(249, 320)],
    });
    /** The gene whose translation is shown under the rows. */
    const gene = (strand: 'forward' | 'reverse', segments: readonly [number, number][]) =>
      createFeature({
        id: 'c',
        type: 'CDS',
        name: 'INS',
        strand,
        segments: segments.map(([start, end]) => range(start, end)),
        qualifiers: [{ name: 'gene', value: 'INS' }],
      });

    beforeEach(() => {
      // jsdom has no layout: a settable scroll position and a 60 px viewport, shorter than a row.
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: Element) {
          return tops.get(this) ?? 0;
        },
        set(this: Element, value: number) {
          tops.set(this, value);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => 60,
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    });

    /** Selects the feature, then a codon far down it, as a click on an amino acid does. */
    function selectLaterCodon(
      d: SeqDocument,
      codon: { start: number; end: number },
    ): { container: Element; scrolled: number } {
      act(() => {
        editorStore.openDocument(d);
        editorStore.setSeqBasesPerRow(100);
        editorStore.selectFeature('p');
      });
      const { container } = render(<LinearSequenceView doc={d} />);
      const view = container.querySelector('.seq-view');
      if (view === null) throw new Error('no view');
      expect(view.scrollTop).toBeGreaterThan(0);
      // The reader scrolls down the translation to the amino acid.
      const atFeature = view.scrollTop + 200;
      view.scrollTop = atFeature;
      fireEvent.scroll(view);
      act(() => {
        // A click on an amino acid: it selects the codon's bases, and the
        // peptide is no longer the selected feature.
        editorStore.setSelection(codon);
      });
      expect(view.scrollTop).toBe(atFeature);
      return { container: view, scrolled: atFeature };
    }

    const long = 'ACGT'.repeat(500);

    it('does not scroll back to the feature when the selection leaves it', () => {
      const d = SeqDocument.create({
        sequence: long,
        features: [peptide, gene('forward', [[249, 700]])],
      });
      const { scrolled } = selectLaterCodon(d, { start: 426, end: 429 });
      expect(scrolled).toBeGreaterThan(0);
    });

    it('does the same for a reverse-strand feature', () => {
      const d = SeqDocument.create({
        sequence: long,
        features: [peptide, gene('reverse', [[249, 700]])],
      });
      selectLaterCodon(d, { start: 426, end: 429 });
    });

    it('does the same for a feature joined across rows', () => {
      const d = SeqDocument.create({
        sequence: long,
        features: [
          peptide,
          gene('forward', [
            [249, 435],
            [1223, 1368],
          ]),
        ],
      });
      selectLaterCodon(d, { start: 426, end: 429 });
    });

    it('does the same on a circular document', () => {
      const d = SeqDocument.create({
        sequence: long,
        topology: 'circular',
        features: [peptide, gene('forward', [[249, 700]])],
      });
      selectLaterCodon(d, { start: 426, end: 429 });
    });
  });

  it('shows the selection bar for Ctrl+A on a sequence longer than the view', () => {
    const { container } = setup();
    expect(container.querySelector('.selection-bar')).toBeNull();
    fireEvent.keyDown(container, { key: 'a', ctrlKey: true });
    expect(editorStore.getState().selection).toEqual({ start: 0, end: doc.length });
    const bar = container.querySelector<HTMLElement>('.selection-bar');
    expect(bar?.textContent).toContain('2,000 bp');
    // Neither the first row's ruler nor the last row's foot is in view, so
    // the bar is pinned to the top of the view.
    expect(parseFloat(bar?.style.top ?? '')).toBe(4);
  });

  it('keeps the pinned bar in view as a whole-sequence selection scrolls', () => {
    const { container } = setup();
    fireEvent.keyDown(container, { key: 'a', ctrlKey: true });
    Object.defineProperty(container, 'scrollTop', {
      value: 500,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(container);
    const bar = container.querySelector<HTMLElement>('.selection-bar');
    expect(parseFloat(bar?.style.top ?? '')).toBe(504);
  });

  it('pins the bar for a wrapping selection whose ends are both off screen', () => {
    const circular = SeqDocument.create({ sequence: 'ACGT'.repeat(500), topology: 'circular' });
    act(() => {
      editorStore.openDocument(circular);
      editorStore.setSeqBasesPerRow(120);
      // From near the end, across the origin, to well past the view's foot.
      editorStore.setSelection({ start: 1900, end: 2000 + 1500 });
    });
    const view = render(<LinearSequenceView doc={circular} />);
    const bar = view.container.querySelector<HTMLElement>('.selection-bar');
    expect(bar?.textContent).toContain('1,600 bp');
    expect(parseFloat(bar?.style.top ?? '')).toBe(4);
  });

  it('shows the selection bar for Ctrl+A on a short sequence', () => {
    const short = SeqDocument.create({ sequence: 'ACGTACGTAC' });
    act(() => {
      editorStore.openDocument(short);
    });
    const view = render(<LinearSequenceView doc={short} />);
    const container = view.container.querySelector('.seq-view');
    if (container === null) throw new Error('no view');
    fireEvent.keyDown(container, { key: 'a', ctrlKey: true });
    expect(view.container.querySelector('.selection-bar')?.textContent).toContain('10 bp');
  });

  it('shows no selection bar in the phone reader', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setSelection({ start: 10, end: 20 });
    });
    const view = render(<LinearSequenceView doc={doc} reader />);
    expect(view.container.querySelector('.selection-bar')).toBeNull();
  });

  it('puts the caret where the pointer is', () => {
    const { canvas } = setup();
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('acts on a finger only once it lifts where it landed', () => {
    const { canvas } = setup();
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(x));
    // Down alone decides nothing: it may be the start of a scroll.
    expect(editorStore.getState().selection).toBeNull();
    fireEvent.pointerUp(canvas, touch(x));
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('leaves a finger that scrolled alone', () => {
    const { canvas } = setup();
    const from = LEFT_GUTTER + 10 * CHAR_WIDTH;
    const to = LEFT_GUTTER + 30 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerMove(canvas, touch(to));
    fireEvent.pointerUp(canvas, touch(to));
    expect(editorStore.getState().selection).toBeNull();
    // The browser taking the gesture for a scroll arrives as a cancel.
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerCancel(canvas, touch(from));
    expect(editorStore.getState().selection).toBeNull();
  });

  it('shows the bases alone in the reader, whatever the toggles say', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setShowComplement(true);
    });
    const spacerHeight = (view: ReturnType<typeof render>): number => {
      const spacer = view.container.querySelector<HTMLElement>('.seq-view__spacer');
      if (spacer === null) throw new Error('no spacer');
      return parseFloat(spacer.style.height);
    };
    const full = render(<LinearSequenceView doc={doc} />);
    const fullHeight = spacerHeight(full);
    full.unmount();
    const reader = render(<LinearSequenceView doc={doc} reader />);
    expect(spacerHeight(reader)).toBeLessThan(fullHeight);
  });

  it('sends a click on a clickable previewed span to the panel that drew it', () => {
    const { canvas } = setup();
    act(() => {
      editorStore.setPreview('cloning', [
        {
          id: 'frag',
          label: '200 bp',
          range: { start: 0, end: 200 },
          strand: 'none',
          shape: 'span',
          clickable: true,
        },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    // The band sits below the feature lanes, whose height depends on the
    // metrics; walk the first row from the top and click each pixel until
    // something answers, rather than restating the layout's arithmetic here.
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    for (
      let y = 0;
      y < 220 && (editorStore.getState().previewActivated?.nonce ?? 0) === before;
      y++
    ) {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 3 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 3 });
    }
    const after = editorStore.getState().previewActivated;
    expect(after?.id).toBe('frag');
    expect(after?.owner).toBe('cloning');
    act(() => {
      editorStore.clearPreview('cloning');
    });
  });

  it('leaves a previewed span that is not clickable inert', () => {
    const { canvas } = setup();
    act(() => {
      editorStore.setPreview('find', [
        { id: 'm0', label: 'match', range: { start: 0, end: 200 }, strand: 'none', shape: 'arrow' },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    for (let y = 0; y < 220; y++) {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 4 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 4 });
    }
    expect(editorStore.getState().previewActivated?.nonce ?? 0).toBe(before);
    act(() => {
      editorStore.clearPreview('find');
    });
  });

  it('follows the view sideways when a fixed row width scrolls', () => {
    const { canvas, container } = setup();
    act(() => {
      scrollTo(container, 10 * CHAR_WIDTH);
    });
    // The canvas stays put (it is sticky); the same point on screen is now ten
    // bases further into the row.
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 20, end: 20 });
  });
  describe('long press (#43)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const column = (n: number): number => LEFT_GUTTER + n * CHAR_WIDTH + CHAR_WIDTH / 2;

    it('selects the base under a finger that rests, and a drag then extends it', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
      });
      // Not yet: a finger that has only just come down may be a scroll.
      expect(editorStore.getState().selection).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 11 });
      fireEvent.pointerMove(canvas, touch(column(24)));
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 25 });
      // Back past where it began: the anchor base stays in.
      fireEvent.pointerMove(canvas, touch(column(4)));
      expect(editorStore.getState().selection).toEqual({ start: 4, end: 11 });
      fireEvent.pointerUp(canvas, touch(column(4)));
      // The lift is not a tap: the selection stays.
      expect(editorStore.getState().selection).toEqual({ start: 4, end: 11 });
    });

    it('takes the drag from the browser only once the press has fired', () => {
      const { canvas } = setup();
      const touchmove = (): boolean => {
        const e = new Event('touchmove', { cancelable: true });
        canvas.dispatchEvent(e);
        return e.defaultPrevented;
      };
      fireEvent.pointerDown(canvas, touch(column(10)));
      expect(touchmove()).toBe(false); // still a scroll
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      expect(touchmove()).toBe(true);
      fireEvent.pointerUp(canvas, touch(column(10)));
      expect(touchmove()).toBe(false);
    });

    it('leaves a scroll that started before the press fired a scroll', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerMove(canvas, touch(column(30)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toBeNull();
      // And the browser taking it (a cancel) ends the wait as well.
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerCancel(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toBeNull();
    });

    it('still fires for a finger that trembles within the slop', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerMove(canvas, { ...touch(column(10)), clientY: 34 });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 11 });
    });

    it('offers Copy where the finger let go, and copies the bases', () => {
      const writeText = vi.fn(() => Promise.resolve());
      const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      try {
        const { canvas, container } = setup();
        fireEvent.pointerDown(canvas, touch(column(10)));
        act(() => {
          vi.advanceTimersByTime(LONG_PRESS_MS);
        });
        // Nothing is offered while the finger is still selecting.
        expect(container.querySelector('.seq-view__copy')).toBeNull();
        fireEvent.pointerMove(canvas, touch(column(17)));
        fireEvent.pointerUp(canvas, touch(column(17)));
        const button = container.querySelector('.seq-view__copy');
        expect(button).toHaveTextContent('Copy 8 bp');
        if (button === null) throw new Error('no button');
        fireEvent.click(button);
        expect(writeText).toHaveBeenCalledWith(doc.sequence.slice(10, 18));
        expect(button).toHaveTextContent('Copied');
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(container.querySelector('.seq-view__copy')).toBeNull();
      } finally {
        if (real === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
        else Object.defineProperty(navigator, 'clipboard', real);
      }
    });

    it('takes the offer away when the selection changes', () => {
      const { canvas, container } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      fireEvent.pointerUp(canvas, touch(column(10)));
      expect(container.querySelector('.seq-view__copy')).not.toBeNull();
      act(() => {
        editorStore.setSelection({ start: 0, end: 3 });
      });
      expect(container.querySelector('.seq-view__copy')).toBeNull();
    });

    it('leaves a quick tap a tap', () => {
      const { canvas, container } = setup();
      fireEvent.pointerDown(canvas, touch(LEFT_GUTTER + 10 * CHAR_WIDTH));
      fireEvent.pointerUp(canvas, touch(LEFT_GUTTER + 10 * CHAR_WIDTH));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
      expect(container.querySelector('.seq-view__copy')).toBeNull();
    });
  });
});

describe('grouped features (#308)', () => {
  const qualifier = (name: string, value: string) => ({ name, value });
  const copies = SeqDocument.create({
    sequence: 'ACGT'.repeat(500),
    features: [
      createFeature({
        id: 'c1',
        type: 'CDS',
        name: 'p',
        segments: [rangeSegment(0, 600)],
        qualifiers: [qualifier('protein_id', 'NP_1')],
      }),
      createFeature({
        id: 'c2',
        type: 'CDS',
        name: 'p',
        segments: [rangeSegment(0, 600)],
        qualifiers: [qualifier('protein_id', 'NP_2')],
      }),
    ],
  });
  const transcripts = SeqDocument.create({
    sequence: 'ACGT'.repeat(500),
    features: [
      createFeature({
        id: 'm1',
        type: 'mRNA',
        name: 'v1',
        segments: [rangeSegment(0, 100), rangeSegment(300, 600)],
        qualifiers: [qualifier('gene', 'G')],
      }),
      createFeature({
        id: 'm2',
        type: 'mRNA',
        name: 'v2',
        segments: [rangeSegment(0, 200), rangeSegment(300, 600)],
        qualifiers: [qualifier('gene', 'G')],
      }),
    ],
  });

  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.closeDocument();
    });
  });

  /**
   * Walks the first row from the top at column 10, pressing each pixel until
   * a feature is selected, and gives that pixel's y back: the bar's place
   * depends on the metrics, which are not restated here.
   */
  function clickFirstBar(canvas: Element): number {
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    for (let y = 0; y < 220; y++) {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 6 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 6 });
      if (editorStore.getState().selectedFeatureId !== null) return y;
    }
    throw new Error('no bar in the first row');
  }

  it('selects the first copy on a click on the shared bar, and names them on hover', () => {
    const { canvas } = setup(copies);
    const y = clickFirstBar(canvas);
    expect(editorStore.getState().selectedFeatureId).toBe('c1');
    expect(editorStore.getState().selection).toEqual({ start: 0, end: 600 });
    expect(editorStore.getState().expandedFeatureGroups.size).toBe(0);
    fireEvent.pointerMove(canvas, { clientX: LEFT_GUTTER + 10 * CHAR_WIDTH, clientY: y });
    expect(currentFollowTooltip()?.text).toBe(
      '2 features drawn as one bar\np: /protein_id=NP_1\np: /protein_id=NP_2',
    );
    fireEvent.pointerMove(canvas, { clientX: LEFT_GUTTER + 10 * CHAR_WIDTH, clientY: 2 });
    expect(currentFollowTooltip()).toBeNull();
  });

  it("selects a gene's transcripts on a click on their row, opens them on the next and closes them on a third", () => {
    const { canvas } = setup(transcripts);
    const y = clickFirstBar(canvas);
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    const click = (): void => {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 6 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 6 });
    };
    expect(editorStore.getState().selectedFeatureId).toBe('m1');
    expect(editorStore.getState().expandedFeatureGroups.size).toBe(0);
    fireEvent.pointerMove(canvas, { clientX: x, clientY: y });
    expect(currentFollowTooltip()?.text).toMatch(/\(click to select, again to expand\)/);
    click();
    expect(editorStore.getState().expandedFeatureGroups.size).toBe(1);
    expect(editorStore.getState().selectedFeatureId).toBe('m1');
    // The row keeps the lane nearest the sequence when it opens, so the same
    // pixel is still the row; the transcripts stack above it.
    fireEvent.pointerMove(canvas, { clientX: x, clientY: y });
    expect(currentFollowTooltip()?.text).toMatch(/\(click to collapse\)/);
    click();
    expect(editorStore.getState().expandedFeatureGroups.size).toBe(0);
    // Selecting something else first: the next click selects again, not opens.
    act(() => {
      editorStore.setSelection(null);
    });
    click();
    expect(editorStore.getState().selectedFeatureId).toBe('m1');
    expect(editorStore.getState().expandedFeatureGroups.size).toBe(0);
  });
});

describe('split and unfinished codons (#318)', () => {
  // ATG AAA G | 20 bases of intron | TG AAA C: codon 3 is G (7) + TG (28-29) = GTG.
  const sequence = `ATGAAAG${'C'.repeat(20)}TGAAAC`;
  const joined = SeqDocument.create({
    sequence,
    features: [
      createFeature({
        id: 'cds',
        type: 'CDS',
        name: 'orf',
        segments: [rangeSegment(0, 7), rangeSegment(27, 33)],
      }),
    ],
  });
  const open = SeqDocument.create({
    sequence,
    features: [
      createFeature({
        id: 'cds',
        type: 'CDS',
        name: 'orf',
        segments: [rangeSegment(0, 7, { partialEnd: true })],
      }),
    ],
  });
  const split = 'Codon 3: G (7) + TG (28-29) = GTG, Val. The codon continues in the next exon.';
  const column = (n: number): number => LEFT_GUTTER + n * CHAR_WIDTH + CHAR_WIDTH / 2;

  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.closeDocument();
    });
    hideFollowTooltip();
  });

  /** The y of the translation line: the first pixel down the column where it says something. */
  function lineAt(canvas: Element, x: number): number {
    for (let y = 0; y < 220; y++) {
      fireEvent.pointerMove(canvas, { clientX: x, clientY: y });
      if (currentFollowTooltip() !== null) return y;
    }
    throw new Error('no tooltip in the first row');
  }

  it('says what a split codon is when the pointer is over its stub or its continuation', () => {
    const { canvas } = setup(joined);
    const y = lineAt(canvas, column(6));
    expect(currentFollowTooltip()?.text).toBe(split);
    fireEvent.pointerMove(canvas, { clientX: column(28), clientY: y });
    expect(currentFollowTooltip()?.text).toBe(split);
    fireEvent.pointerMove(canvas, { clientX: column(27), clientY: y });
    expect(currentFollowTooltip()?.text).toBe(split);
  });

  it('says nothing over an ordinary codon, the intron, or the sequence', () => {
    const { canvas } = setup(joined);
    const y = lineAt(canvas, column(6));
    fireEvent.pointerMove(canvas, { clientX: column(1), clientY: y });
    expect(currentFollowTooltip()).toBeNull();
    fireEvent.pointerMove(canvas, { clientX: column(15), clientY: y });
    expect(currentFollowTooltip()).toBeNull();
    fireEvent.pointerMove(canvas, { clientX: column(6), clientY: 2 });
    expect(currentFollowTooltip()).toBeNull();
  });

  it('says where a CDS that ends open leaves its codon unfinished', () => {
    const { canvas } = setup(open);
    lineAt(canvas, column(6));
    expect(currentFollowTooltip()?.text).toBe('Incomplete codon: the CDS ends open at 7.');
  });

  describe('on a tap', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const tap = (canvas: Element, x: number, y: number): void => {
      const finger = { clientX: x, clientY: y, button: 0, pointerId: 3, pointerType: 'touch' };
      fireEvent.pointerDown(canvas, finger);
      fireEvent.pointerUp(canvas, finger);
      fireEvent.pointerLeave(canvas, finger);
    };

    it('shows it where the finger came down, keeps it after the finger leaves, and takes it away after a while', () => {
      const { canvas } = setup(joined);
      const y = lineAt(canvas, column(6));
      hideFollowTooltip();
      tap(canvas, column(28), y);
      expect(currentFollowTooltip()).toMatchObject({ text: split, x: column(28), y });
      act(() => {
        vi.advanceTimersByTime(TAP_TIP_MS - 1);
      });
      expect(currentFollowTooltip()?.text).toBe(split);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(currentFollowTooltip()).toBeNull();
    });

    it('takes it away at the next tap, which says nothing of an ordinary codon', () => {
      const { canvas } = setup(joined);
      const y = lineAt(canvas, column(6));
      hideFollowTooltip();
      tap(canvas, column(6), y);
      expect(currentFollowTooltip()?.text).toBe(split);
      tap(canvas, column(1), y);
      expect(currentFollowTooltip()).toBeNull();
    });
  });
});
