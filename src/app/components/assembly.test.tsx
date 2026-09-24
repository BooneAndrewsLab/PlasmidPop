// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type DigestFragment,
  type FragmentEnd,
  SeqDocument,
  assemblyJunctions,
  createFeature,
  describeEnd,
  flipFragment,
  rangeSegment,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { AssemblyWarnings } from './AssemblyWarnings';
import { LigationPanel } from './LigationPanel';
import { ProductSummary } from './ProductSummary';
import { ShelfPanel } from './ShelfPanel';

/**
 * The bench's shared pieces (#15, #16), checked over every combination
 * rather than one of each.
 *
 * `ProductSummary` is a sentence with four decisions in it — circular or
 * linear, no features or some, which features count, how many are named
 * before "+N more" — so each is taken at its boundary: exactly six names
 * against seven, a document whose only features are `primer_bind` and
 * `source` (which reads "no features", not an empty list), and two features
 * of the same name (one name).
 *
 * `LigationPanel` is the one reaction the user orders themselves, so what it
 * says about a set of parts has to hold for every arrangement of them, not
 * for the arrangement a test thought of. Ticks, order, orientation and
 * dephosphorylation are enumerated over two and three shelf parts, and every
 * junction the panel draws is compared with `assemblyJunctions` computed
 * from the same fragments: the aria-label of each junction row, whether
 * **Assemble** is offered, and whether the product line is there at all.
 * The shelf is deliberately left alone by an assembly (a cut vector is
 * ligated to one insert after another), which is checked too.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

// ------------------------------------------------------------ ProductSummary

function withFeatures(names: readonly string[], types: readonly string[] = []): SeqDocument {
  return SeqDocument.create({
    name: 'product',
    sequence: 'ACGT'.repeat(300),
    topology: 'circular',
    features: [
      ...names.map((name, i) =>
        createFeature({
          id: `f${i}`,
          type: 'CDS',
          name,
          segments: [rangeSegment(i * 10, i * 10 + 9)],
        }),
      ),
      ...types.map((type, i) =>
        createFeature({
          id: `t${i}`,
          type,
          name: `${type} ${i}`,
          segments: [rangeSegment(500 + i * 10, 509 + i * 10)],
        }),
      ),
    ],
  });
}

const summary = (): string => must(screen.getByLabelText('Product').textContent, 'the summary');

describe('ProductSummary', () => {
  it('says the length and the topology', () => {
    render(<ProductSummary product={SeqDocument.create({ sequence: 'ACGT'.repeat(300) })} />);
    expect(summary()).toBe('Product: 1,200 bp, linear, no features');
  });

  it('says a circle is a circle', () => {
    render(<ProductSummary product={withFeatures(['ori'])} />);
    expect(summary()).toBe('Product: 1,200 bp, circular · ori');
  });

  it('names six features, and counts the rest', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const view = render(<ProductSummary product={withFeatures(six)} />);
    expect(summary()).toBe('Product: 1,200 bp, circular · a, b, c, d, e, f');
    expect(summary()).not.toContain('more');
    view.unmount();

    render(<ProductSummary product={withFeatures([...six, 'g'])} />);
    expect(summary()).toBe('Product: 1,200 bp, circular · a, b, c, d, e, f, +1 more');
    // Seven is the first "+N more", and every further feature raises N.
    const nine = render(<ProductSummary product={withFeatures([...six, 'g', 'h', 'i'])} />);
    expect(within(nine.container).getByLabelText('Product').textContent).toContain('+3 more');
  });

  it('leaves out the features a product is not described by', () => {
    // A primer_bind is the primer that made the piece and a source is the
    // whole molecule: neither says what the product carries.
    const view = render(<ProductSummary product={withFeatures([], ['primer_bind', 'source'])} />);
    expect(summary()).toBe('Product: 1,200 bp, circular, no features');
    view.unmount();
    render(<ProductSummary product={withFeatures(['gene'], ['primer_bind', 'source'])} />);
    expect(summary()).toBe('Product: 1,200 bp, circular · gene');
  });

  it('names a feature once however many copies of it there are', () => {
    render(<ProductSummary product={withFeatures(['gene', 'gene', 'ori', 'gene'])} />);
    expect(summary()).toBe('Product: 1,200 bp, circular · gene, ori');
  });

  it('falls back to the type when a feature has no name', () => {
    const product = SeqDocument.create({
      sequence: 'ACGT'.repeat(10),
      features: [createFeature({ id: 'f', type: 'misc_feature', segments: [rangeSegment(0, 4)] })],
    });
    render(<ProductSummary product={product} />);
    expect(summary()).toBe('Product: 40 bp, linear · misc_feature');
  });
});

// ---------------------------------------------------------- AssemblyWarnings

describe('AssemblyWarnings', () => {
  it('draws nothing at all when there is nothing to warn about', () => {
    const { container } = render(<AssemblyWarnings texts={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('list', { name: 'Assembly warnings' })).toBeNull();
  });

  it('lists what it was given, under a sentence saying the design still works', () => {
    render(<AssemblyWarnings texts={['first risk', 'second risk']} />);
    expect(
      screen.getByText(/The parts assemble, but the tube may also give something else/),
    ).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Assembly warnings' })).getAllByRole(
      'listitem',
    );
    expect(items.map((li) => li.textContent)).toEqual(['first risk', 'second risk']);
  });
});

// ----------------------------------------------------- the shelf and ligation

function end(kind: FragmentEnd['kind'], overhang: string, enzyme: string | null): FragmentEnd {
  return { kind, overhang, enzyme };
}

/** A piece as a digest leaves it: 5′ overhangs, so they are in `sequence`. */
function fragment(
  source: string,
  sequence: string,
  left: FragmentEnd,
  right: FragmentEnd,
): DigestFragment {
  return {
    sequence,
    features: [],
    range: { start: 0, end: sequence.length },
    left,
    right,
    source,
  };
}

const ECO = end("5'", 'AATT', 'EcoRI');
const NCO = end("5'", 'CATG', 'NcoI');

const VECTOR = fragment('pUC', `AATT${'ACGTACGTAC'.repeat(3)}`, ECO, ECO);
const INSERT = fragment('gene', `AATT${'GGCCTTAAGG'.repeat(2)}`, ECO, ECO);
/** An NcoI end, so one junction cannot be made whichever way it is turned. */
const ODD = fragment('odd', `CATG${'TTTTCCCCAA'.repeat(2)}`, NCO, ECO);

function putOnShelf(fragments: readonly DigestFragment[]): void {
  act(() => {
    editorStore.clearShelf();
    for (const f of fragments) editorStore.addToShelf(f);
  });
}

function shelfPart(index: number) {
  return must(editorStore.getState().shelf[index], `shelf part ${index}`);
}

function flipPart(index: number): void {
  const part = shelfPart(index);
  act(() => {
    editorStore.flipShelfPart(part.id, flipFragment(part.fragment));
  });
}

function dephosphorylate(index: number): void {
  const part = shelfPart(index);
  act(() => {
    editorStore.setShelfPartDephosphorylated(part.id, true);
  });
}

/** The junction rows as the panel labels them, in order. */
function junctionLabels(): string[] {
  return screen
    .queryAllByRole('listitem', { name: /^(Join|Closing join):/ })
    .map((li) => must(li.getAttribute('aria-label'), 'a junction label'));
}

/** What those labels must read, from the fragments themselves. */
function expectedLabels(fragments: readonly DigestFragment[]): string[] {
  const junctions = assemblyJunctions(fragments, true);
  return junctions.map((j, i) => {
    const closing = i === fragments.length - 1;
    return `${closing ? 'Closing join' : 'Join'}: ${describeEnd(j.from)} to ${describeEnd(j.to)}, ${
      j.compatible ? 'compatible' : 'incompatible'
    }`;
  });
}

/** Ticks off the parts at `excluded`, by their place in the tube. */
function exclude(excluded: readonly number[]): void {
  const ticks = within(
    screen.getByRole('list', { name: 'Fragments in the ligation' }),
  ).getAllByRole('checkbox');
  for (const i of excluded) {
    const tick = must(ticks[i], `tick ${i}`);
    act(() => {
      fireEvent.click(tick);
    });
  }
}

function subsets(n: number): number[][] {
  const out: number[][] = [];
  for (let bits = 0; bits < 1 << n; bits++) {
    out.push([...Array(n).keys()].filter((i) => (bits >> i) % 2 === 1));
  }
  return out;
}

describe('LigationPanel over every arrangement of the shelf', () => {
  afterEach(() => {
    act(() => {
      editorStore.clearShelf();
      editorStore.closeDocument();
    });
  });

  it('asks for parts when the shelf is empty', () => {
    putOnShelf([]);
    render(<LigationPanel />);
    expect(screen.getByText(/Put the vector and the insert on the shelf/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assemble' })).toBeNull();
  });

  /**
   * One arrangement: the parts on the shelf, some turned round, some
   * dephosphorylated, some ticked out — and every claim the panel makes
   * about it held to `assemblyJunctions` over the same fragments.
   */
  function checkArrangement(
    fragments: readonly DigestFragment[],
    options: {
      readonly flipped?: readonly number[];
      readonly bare?: readonly number[];
      readonly excluded?: readonly number[];
      readonly moveUp?: number;
    } = {},
  ): void {
    putOnShelf(fragments);
    for (const i of options.flipped ?? []) flipPart(i);
    for (const i of options.bare ?? []) dephosphorylate(i);
    if (options.moveUp !== undefined) {
      const part = shelfPart(options.moveUp);
      act(() => {
        editorStore.moveShelfPart(part.id, -1);
      });
    }
    const view = render(<LigationPanel />);
    const excluded = options.excluded ?? [];
    exclude(excluded);

    const used = editorStore
      .getState()
      .shelf.filter((_, i) => !excluded.includes(i))
      .map((p) => p.fragment);
    const expected = used.length === 0 ? [] : expectedLabels(used);
    const where = JSON.stringify({ ...options, parts: fragments.map((f) => f.source) });
    expect(junctionLabels(), where).toEqual(expected);

    const assemblable = used.length > 0 && expected.every((l) => l.endsWith(', compatible'));
    const button = screen.queryByRole('button', { name: 'Assemble' });
    expect(must(button, 'the Assemble button').hasAttribute('disabled'), where).toBe(!assemblable);
    // The product is described only when there is one to describe (#15).
    expect(screen.queryByLabelText('Product') !== null, where).toBe(assemblable);
    if (used.length === 0) {
      expect(screen.getByText('Every fragment is left out.')).toBeInTheDocument();
    }
    view.unmount();
  }

  it('matches assemblyJunctions for every tick of three parts, and every orientation', () => {
    const parts = [VECTOR, INSERT, ODD];
    // Every subset of the ticks, against a few orientations; then every
    // orientation with all three in. (The product of the two is 64
    // renders, which is a second and a half of jsdom for nothing new.)
    for (const excluded of subsets(3)) {
      for (const flipped of [[], [1], [0, 2]]) {
        checkArrangement(parts, { excluded, flipped });
      }
    }
    for (const flipped of subsets(3)) {
      checkArrangement(parts, { flipped });
    }
  });

  it('matches it for every dephosphorylation and tick of two parts', () => {
    const parts = [VECTOR, INSERT];
    for (const bare of subsets(2)) {
      for (const excluded of subsets(2)) {
        checkArrangement(parts, { bare, excluded });
      }
    }
    // And the shelf's order is the order of joining, phosphates and all.
    checkArrangement(parts, { bare: [0], moveUp: 1 });
    checkArrangement(parts, { bare: [0, 1], moveUp: 1 });
  });

  it('is the shelf order that the ligation follows, and the flips with it', () => {
    putOnShelf([VECTOR, INSERT]);
    render(<LigationPanel />);
    const order = (): string[] =>
      within(screen.getByRole('list', { name: 'Ligation order' }))
        .getAllByRole('listitem')
        .filter((li) => li.className === 'part')
        .map((li) => must(li.querySelector('.part__name')?.textContent, 'a name'));
    expect(order()).toEqual(['pUC EcoRI fragment', 'gene EcoRI fragment']);
    flipPart(1);
    expect(order()).toEqual(['pUC EcoRI fragment', 'gene EcoRI fragment (flipped)']);
    const second = shelfPart(1);
    act(() => {
      editorStore.moveShelfPart(second.id, -1);
    });
    expect(order()).toEqual(['gene EcoRI fragment (flipped)', 'pUC EcoRI fragment']);
  });

  it('keeps the shelf as it was after assembling, so the vector can take another insert', () => {
    putOnShelf([VECTOR, INSERT]);
    render(
      <>
        <ShelfPanel />
        <LigationPanel />
      </>,
    );
    const before = editorStore.getState().shelf;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    });
    const after = editorStore.getState().shelf;
    expect(after).toEqual(before);
    expect(after).toHaveLength(2);
    // The product is opened as a document of its own.
    const open = editorStore.getState().documents;
    expect(open).toHaveLength(1);
    expect(must(open[0], 'the product').history.present.name).toBe('pUC+gene assembly');
    expect(must(open[0], 'the product').history.present.isCircular).toBe(true);
    // And the shelf still lists both parts, ready for the next reaction.
    expect(
      within(screen.getByRole('list', { name: 'Shelf' })).getAllByRole('listitem').length,
    ).toBe(2);
  });

  it('takes the name typed for the product, and offers the parts names otherwise', () => {
    putOnShelf([VECTOR, INSERT]);
    render(<LigationPanel />);
    const field = screen.getByLabelText('Name of the assembled document');
    expect(field).toHaveAttribute('placeholder', 'pUC+gene assembly');
    act(() => {
      fireEvent.change(field, { target: { value: '  pFinal  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    });
    expect(must(editorStore.getState().documents[0], 'the product').history.present.name).toBe(
      'pFinal',
    );
  });

  it('says a linear product is linear, and closes no circle', () => {
    putOnShelf([VECTOR, INSERT]);
    render(<LigationPanel />);
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Circular product' }));
    });
    // One junction now, and no closing one.
    expect(junctionLabels()).toEqual(expectedLabels([VECTOR, INSERT]).slice(0, 1));
    expect(must(screen.getByLabelText('Product').textContent, 'summary')).toContain('linear');
  });
});

describe('ShelfPanel', () => {
  afterEach(() => {
    act(() => {
      editorStore.clearShelf();
    });
  });

  it('says what is on the shelf, and nothing about an empty one', () => {
    putOnShelf([]);
    const view = render(<ShelfPanel />);
    expect(screen.getByText(/Nothing collected yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Shelf' })).toBeNull();
    view.unmount();

    putOnShelf([VECTOR, INSERT]);
    render(<ShelfPanel />);
    expect(screen.getByText('2 parts, 58 bp')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Shelf' })).getAllByRole('listitem');
    expect(must(rows[0], 'the first row').textContent).toContain('EcoRI 5′ AATT → EcoRI 5′ AATT');
  });

  it('marks a dephosphorylated part, and lets the treatment be taken back', () => {
    putOnShelf([VECTOR]);
    render(<ShelfPanel />);
    const button = screen.getByRole('button', { name: 'Dephosphorylate part 1' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.getByRole('button', { name: 'Dephosphorylate part 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/dephosphorylated/)).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dephosphorylate part 1' }));
    });
    expect(shelfPart(0).fragment.dephosphorylated).toBe(false);
  });

  it('cannot move the first part up or the last one down', () => {
    putOnShelf([VECTOR, INSERT]);
    render(<ShelfPanel />);
    expect(screen.getByRole('button', { name: 'Move part 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move part 2 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move part 2 up' })).toBeEnabled();
  });

  it('takes a part off, and clears the lot', () => {
    putOnShelf([VECTOR, INSERT]);
    render(<ShelfPanel />);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove part 1' }));
    });
    expect(editorStore.getState().shelf).toHaveLength(1);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear shelf' }));
    });
    expect(editorStore.getState().shelf).toEqual([]);
    expect(screen.getByText(/Nothing collected yet/)).toBeInTheDocument();
  });
});
