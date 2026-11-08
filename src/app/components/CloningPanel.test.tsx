// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type CutSite,
  SeqDocument,
  createFeature,
  findCutSites,
  getEnzyme,
  rangeSegment,
} from '@/core';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { recallEnzymePage } from '../enzymeWorkspace';
import { batchSession } from '../batchSession';
import { recallWorkspace } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { Bench } from './Bench';
import { CloningPanel } from './CloningPanel';
import { PrimerWorkspace } from './PrimerWorkspace';

// 4,000 bp circular, cut at 400 and 1,400 by the first enzyme in the table:
// two fragments of 1,000 and 3,000 bp.
const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(1000), topology: 'circular' });
const found = getEnzyme('EcoRI');
if (found === undefined) throw new Error('EcoRI is not in the enzyme table');
const enzyme = found.name;

const sites: CutSite[] = [400, 1400].map((cut) => ({
  enzyme,
  cut,
  cutBottom: cut + 4,
  siteStart: cut - 1,
  strand: 'forward' as const,
}));

/** The Cloning tab, and with `bench` the Bench beside it, where the shelf's parts are joined. */
function setup(bench = false) {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setAnalysis(doc, sites, []);
    editorStore.setShownEnzymes([enzyme]);
  });
  return render(
    bench ? (
      <>
        <CloningPanel doc={doc} />
        <Bench />
      </>
    ) : (
      <CloningPanel doc={doc} />
    ),
  );
}

const preview = () => editorStore.getState().preview;

describe('CloningPanel', () => {
  beforeEach(() => {
    act(() => {
      editorStore.setCloningReaction('digest');
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  afterEach(() => {
    act(() => {
      editorStore.clearShelf();
      editorStore.closeDocument();
    });
  });

  it('ends in two doors: the Bench, and cloning an insert in the primer workspace (#381)', () => {
    setup();
    const frontId = editorStore.getState().documentId ?? '';
    fireEvent.click(screen.getByRole('button', { name: 'Clone an insert into this plasmid ›' }));
    expect(editorStore.getState().workspace).toBe('primers');
    expect(recallWorkspace(editorStore.getState().documentId)).toEqual({
      page: 'design',
      mode: 'cloning',
    });
    act(() => {
      editorStore.setWorkspace(null);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open the Bench ›' }));
    expect(editorStore.getState().front).toBe('bench');
    // The Bench left no document in front: put this one back for the next test.
    act(() => {
      editorStore.activateDocument(frontId);
    });
  });

  it('has a door to many inserts at once: the Batch page on a cloning method, and Escape goes back (#360, #404)', () => {
    setup();
    batchSession.forget();
    act(() => {
      editorStore.setSidebarTab('cloning');
    });
    const id = editorStore.getState().documentId;
    fireEvent.click(screen.getByRole('button', { name: 'Design many inserts ›' }));
    expect(editorStore.getState().workspace).toBe('primers');
    expect(recallWorkspace(id).page).toBe('batch');
    expect(batchSession.read(id).method).toBe('restriction');

    // A cloning method already chosen there stays chosen.
    batchSession.update(id, { method: 'golden-gate' });
    act(() => {
      editorStore.setWorkspace(null);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Design many inserts ›' }));
    expect(batchSession.read(id).method).toBe('golden-gate');

    // In the workspace the page is Batch design, and Escape returns to the Cloning tab it came from.
    act(() => {
      editorStore.setWorkspace(null);
      editorStore.setSidebarTab('cloning');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Design many inserts ›' }));
    render(<PrimerWorkspace doc={doc} />);
    expect(screen.getByRole('combobox', { name: 'Method' })).toHaveValue('golden-gate');
    act(() => {
      fireEvent.keyDown(screen.getByRole('heading', { name: 'Batch design' }), {
        key: 'Escape',
      });
    });
    expect(editorStore.getState()).toMatchObject({ workspace: null, sidebarTab: 'cloning' });
  });

  it('offers no primer door where there is no Primers tab (#381)', () => {
    const protein = SeqDocument.create({ sequence: 'MKLV', alphabet: 'protein' });
    act(() => {
      editorStore.openDocument(protein);
    });
    render(<CloningPanel doc={protein} />);
    expect(screen.getByRole('button', { name: 'Open the Bench ›' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clone an insert/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Design many inserts/ })).toBeNull();
  });

  it('shows one of the digest, PCR and Mutate at a time', () => {
    setup();
    const pick = (name: string): HTMLElement =>
      within(screen.getByRole('group', { name: 'Reaction' })).getByRole('button', { name });
    expect(screen.getByRole('heading', { name: /Digest with ticked enzymes/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /PCR/ })).toBeNull();
    // The reactions that join parts are on the Bench (item 49).
    expect(
      within(screen.getByRole('group', { name: 'Reaction' })).getAllByRole('button'),
    ).toHaveLength(3);

    act(() => {
      fireEvent.click(pick('PCR'));
    });
    expect(screen.getByRole('heading', { name: /PCR/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Digest with/ })).toBeNull();
    // One preview channel: the digest gives it up to the panel being worked in.
    expect(preview()).toBeNull();
    act(() => {
      fireEvent.click(pick('Mutate'));
    });
    expect(screen.getByRole('heading', { name: /Site-directed mutagenesis/ })).toBeInTheDocument();
    // It is a preference, not panel state: it outlives the panel.
    expect(editorStore.getState().sidebarReaction).toBe('mutagenesis');
    act(() => {
      fireEvent.click(pick('Digest'));
    });
    expect(preview()?.owners).toEqual(['cloning']);
  });

  it('says the digest in one status line: the enzymes, the count, the order (#392)', () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('EcoRI: 2 fragments, largest first.');
    // The enzymes are no longer a note on the heading, and the line has no
    // second sentence about the shelf: the shelf line below says that.
    expect(document.querySelector('.panel__heading-note')).toBeNull();
  });

  it('keeps one status line for each recovery state of the digest (#392)', () => {
    setup();
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    // Nothing ticked: it says so, and the link goes to the Enzymes tab.
    expect(screen.getByRole('status')).toHaveTextContent(
      'No enzyme is ticked. Tick enzymes in the Enzymes tab to cut',
    );
    expect(screen.queryAllByRole('listitem').filter((li) => li.className === 'fragment')).toEqual(
      [],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tick enzymes' }));
    expect(editorStore.getState().sidebarTab).toBe('enzymes');
  });

  it('gives each fragment two lines and puts its range and features in the tooltip (#392)', () => {
    const annotated = doc.addFeature(
      createFeature({
        type: 'misc_feature',
        name: 'marker',
        segments: [rangeSegment(500, 900)],
      }),
    );
    act(() => {
      editorStore.openDocument(annotated);
      editorStore.setAnalysis(annotated, sites, []);
      editorStore.setShownEnzymes([enzyme]);
    });
    render(<CloningPanel doc={annotated} />);
    const rows = screen.getAllByRole('listitem').filter((li) => li.className === 'fragment');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Lengths and buttons, then the ends: no third line for the features.
      expect([...row.children].map((c) => c.className)).toEqual([
        'fragment__head',
        'fragment__ends',
      ]);
    }
    const small = rows[1];
    if (small === undefined) throw new Error('expected two fragment rows');
    // The 1,000 bp piece is 401-1,400; the marker lies inside it.
    expect(small.getAttribute('data-tip')).toBe('401–1,400 · marker');
    expect(rows[0]?.getAttribute('data-tip')).toBe('1,401–400');
    // The length button carries it too, with what a click does.
    expect(within(small).getByRole('button', { name: '1,000 bp' })).toHaveAttribute(
      'data-tip',
      '401–1,400 · marker. Click to select this fragment in the views',
    );
    // The row still has no range or feature text of its own.
    expect(small).not.toHaveTextContent('marker');
    expect(small).not.toHaveTextContent('401');
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('draws the digest fragments on both views', () => {
    setup();
    const spans = preview()?.items ?? [];
    expect(preview()?.owners).toEqual(['cloning']);
    // Largest first, as the list is; each a bracket with a tick at the cuts.
    expect(spans.map((s) => s.label)).toEqual(['3,000 bp', '1,000 bp']);
    expect(spans.map((s) => s.shape)).toEqual(['span', 'span']);
    // The 3,000 bp piece is the one that runs over the origin, unrolled.
    expect(spans[0]?.range).toEqual({ start: 1400, end: 4400 });
    expect(spans[1]?.range).toEqual({ start: 400, end: 1400 });
  });

  it('lights the fragment under the pointer, and no other', () => {
    setup();
    const rows = screen.getAllByRole('listitem').filter((li) => li.className === 'fragment');
    const second = rows[1];
    if (second === undefined) throw new Error('expected two fragment rows');
    act(() => {
      fireEvent.mouseEnter(second);
    });
    expect(preview()?.items.map((s) => s.shape)).toEqual(['span', 'arrow']);
    act(() => {
      fireEvent.mouseLeave(second);
    });
    expect(preview()?.items.map((s) => s.shape)).toEqual(['span', 'span']);
  });

  it('adds a fragment to the shelf when its span is clicked in a view', () => {
    setup();
    const spans = preview()?.items ?? [];
    expect(spans.every((s) => s.clickable === true)).toBe(true);
    const small = spans[1];
    if (small === undefined) throw new Error('expected two spans');
    act(() => {
      editorStore.activatePreview(small.id);
    });
    const shelf = editorStore.getState().shelf;
    expect(shelf).toHaveLength(1);
    expect(shelf[0]?.fragment.sequence.length).toBe(1000);
    // The Cloning tab's summary of the shelf counts it, so it is seen landing (#16).
    expect(screen.getByText(/The shelf holds 1 part, 1,000 bp/)).toBeInTheDocument();

    // The same fragment twice is two parts: a shelf is a list, not a set.
    act(() => {
      editorStore.activatePreview(small.id);
    });
    expect(editorStore.getState().shelf).toHaveLength(2);
  });

  it('says a fragment is on the shelf, how many times, and that Add worked (#81)', () => {
    vi.useFakeTimers();
    try {
      setup();
      const rows = () => screen.getAllByRole('listitem');
      const row = (i: number) => {
        const r = rows()[i];
        if (r === undefined) throw new Error(`no fragment row ${String(i)}`);
        return within(r);
      };
      expect(row(0).queryByText(/On shelf/)).toBeNull();

      fireEvent.click(row(0).getByRole('button', { name: 'Add' }));
      expect(row(0).getByRole('button', { name: 'Added ✓' })).toBeInTheDocument();
      expect(row(0).getByText('On shelf')).toBeInTheDocument();
      expect(row(0).getByText(/bp fragment added to the shelf/)).toBeInTheDocument();
      // The other fragment is not on the shelf.
      expect(row(1).queryByText(/On shelf/)).toBeNull();

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(row(0).getByRole('button', { name: 'Add again' })).toBeInTheDocument();
      expect(row(0).queryByText(/fragment added to the shelf/)).toBeNull();

      fireEvent.click(row(0).getByRole('button', { name: 'Add again' }));
      expect(row(0).getByText('On shelf ×2')).toBeInTheDocument();
      expect(editorStore.getState().shelf).toHaveLength(2);

      // Taken off on the Bench, the count follows.
      const first = editorStore.getState().shelf[0];
      if (first === undefined) throw new Error('empty shelf');
      act(() => {
        editorStore.removeFromShelf(first.id);
      });
      expect(row(0).getByText('On shelf')).toBeInTheDocument();
      act(() => {
        editorStore.clearShelf();
        vi.advanceTimersByTime(1500);
      });
      expect(row(0).queryByText(/On shelf/)).toBeNull();
      expect(row(0).getByRole('button', { name: 'Add' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ligates the ticked shelf parts in the shelf's order", () => {
    setup(true);
    for (const add of screen.getAllByRole('button', { name: 'Add' })) {
      act(() => {
        fireEvent.click(add);
      });
    }
    const order = (): string[] =>
      within(screen.getByRole('list', { name: 'Ligation order' }))
        .getAllByRole('listitem')
        .filter((li) => li.className === 'part')
        .map((li) => li.querySelector('.part__detail')?.textContent ?? '');
    expect(order()).toEqual(['3,000 bp', '1,000 bp']);
    // A shelf part can be meant for another reaction, so the tick leaves it
    // out of this one without taking it off the shelf.
    const ticks = within(
      screen.getByRole('list', { name: 'Fragments in the ligation' }),
    ).getAllByRole('checkbox');
    const second = ticks[1];
    if (second === undefined) throw new Error('expected two ticks');
    act(() => {
      fireEvent.click(second);
    });
    expect(order()).toEqual(['3,000 bp']);
    expect(editorStore.getState().shelf).toHaveLength(2);
    // The shelf's order is the ligation's.
    act(() => {
      fireEvent.click(second);
      fireEvent.click(screen.getByRole('button', { name: 'Move part 2 up' }));
    });
    expect(order()).toEqual(['1,000 bp', '3,000 bp']);
  });

  it('gives a fragment and a ligation what they were made from (#67)', () => {
    setup(true);
    for (const add of screen.getAllByRole('button', { name: 'Add' })) {
      act(() => {
        fireEvent.click(add);
      });
    }
    const [part] = editorStore.getState().shelf;
    expect(part?.fragment.lineage?.step).toMatchObject({ op: 'digest', enzymes: [enzyme] });
    expect(part?.fragment.lineage?.step?.parents[0]?.name).toBe(doc.name);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    });
    const product = editorStore.document?.metadata.lineage;
    expect(product?.step).toMatchObject({
      op: 'ligation',
      circular: true,
      flipped: [false, false],
    });
    expect(product?.step?.parents.map((p) => p.step?.op)).toEqual(['digest', 'digest']);
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('opens a fragment made by a digest of the document (#67)', () => {
    setup();
    const [open] = screen.getAllByRole('button', { name: 'Open' });
    act(() => {
      if (open !== undefined) fireEvent.click(open);
    });
    const lineage = editorStore.document?.metadata.lineage;
    expect(lineage?.step).toMatchObject({ op: 'digest', enzymes: [enzyme], uncut: 0 });
    expect(lineage?.step?.parents[0]?.length).toBe(doc.length);
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('has no Partial digest toggle: a door opens the workspace on Digest (#393)', () => {
    setup();
    expect(screen.queryByRole('checkbox', { name: 'Partial digest' })).toBeNull();
    const door = screen.getByRole('button', { name: 'All fragments and partial digest ›' });
    expect(door).toHaveClass('panel__door');
    act(() => {
      fireEvent.click(door);
    });
    const id = editorStore.getState().documentId;
    expect(editorStore.getState().workspace).toBe('enzymes');
    expect(recallEnzymePage(id)).toBe('digest');
  });

  it('shows the door only while a digest has fragments (#393)', () => {
    setup();
    act(() => {
      editorStore.setShownEnzymes([]);
    });
    expect(screen.queryByRole('button', { name: /All fragments and partial digest/ })).toBeNull();
  });

  it('stops a dephosphorylated part closing on itself', () => {
    setup(true);
    const [addLarge] = screen.getAllByRole('button', { name: 'Add' });
    if (addLarge === undefined) throw new Error('no Add');
    act(() => {
      fireEvent.click(addLarge);
    });
    const closing = (): string | null =>
      screen.getByRole('listitem', { name: /Closing join/ }).getAttribute('aria-label');
    expect(closing()).toMatch(/, compatible$/);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dephosphorylate part 1' }));
    });
    expect(closing()).toMatch(/incompatible$/);
    expect(screen.getByText(/both sides dephosphorylated/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assemble' })).toBeDisabled();
    expect(editorStore.getState().shelf[0]?.fragment.dephosphorylated).toBe(true);
  });

  it('ignores an activation meant for another panel', () => {
    setup();
    act(() => {
      editorStore.setPreview('find', [
        { id: 'm0', label: 'match', range: { start: 0, end: 4 }, strand: 'none', shape: 'arrow' },
      ]);
      editorStore.activatePreview('m0');
    });
    expect(editorStore.getState().shelf).toHaveLength(0);
  });

  it('does not answer a click again when the tab comes back', () => {
    const first = setup();
    const id = preview()?.items[0]?.id;
    if (id === undefined) throw new Error('no preview');
    act(() => {
      editorStore.activatePreview(id);
    });
    expect(editorStore.getState().shelf).toHaveLength(1);
    act(() => {
      first.unmount();
    });
    // Leaving the Cloning tab and coming back must not add it a second time.
    // The panel alone is remounted, as switching sidebar tabs does; the
    // document and its ticks are untouched.
    const again = render(<CloningPanel doc={doc} />);
    expect(editorStore.getState().shelf).toHaveLength(1);
    act(() => {
      again.unmount();
    });
  });

  it('takes the fragments off the views when the tab is left', () => {
    const view = setup();
    expect(preview()).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(preview()).toBeNull();
  });

  describe('after an edit, before the rescan (#138)', () => {
    // 1,006 bp circle with one EcoRI site at 300 and one BamHI site at 606.
    const filler = (n: number, seed: number) => {
      let out = '';
      let x = seed;
      for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        out += 'ACGT'.charAt((x >> 16) % 4);
      }
      return out.replace(/GAATTC|GGATCC/g, 'AAAAAA');
    };
    const right = filler(694, 42);
    const text = filler(300, 41) + 'GAATTC' + right.slice(0, 300) + 'GGATCC' + right.slice(300);
    const plasmid = SeqDocument.create({ name: 'pE', sequence: text, topology: 'circular' });
    const both = ['EcoRI', 'BamHI'].map((n) => {
      const e = getEnzyme(n);
      if (e === undefined) throw new Error(n);
      return e;
    });

    function edited(op: Parameters<typeof editorStore.apply>[0]) {
      act(() => {
        editorStore.openDocument(plasmid);
        editorStore.setAnalysis(plasmid, findCutSites(text, 'circular', both), []);
        editorStore.setShownEnzymes(['EcoRI', 'BamHI']);
        editorStore.apply(op);
      });
      const present = editorStore.document;
      if (present === null) throw new Error('no document');
      expect(editorStore.getState().analysis?.provisional).toBe(true);
      return present;
    }

    it('neither lists nor shelves fragments cut at a site the edit destroyed', () => {
      const doc2 = edited({ type: 'replace', range: { start: 300, end: 306 }, text: 'GAATTA' });
      expect(doc2.sequence.toString()).not.toContain('GAATTC');
      const view = render(<CloningPanel doc={doc2} />);
      expect(screen.getByText('Scanning for restriction sites…')).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: 'Add' })).toHaveLength(0);
      // The worker answers: BamHI alone opens the circle into one piece.
      act(() => {
        editorStore.setAnalysis(doc2, findCutSites(doc2.sequence.toString(), 'circular', both), []);
      });
      view.rerender(<CloningPanel doc={doc2} />);
      const adds = screen.getAllByRole('button', { name: 'Add' });
      expect(adds).toHaveLength(1);
      const [add] = adds;
      if (add === undefined) throw new Error('no Add');
      act(() => {
        fireEvent.click(add);
      });
      const frag = editorStore.getState().shelf[0]?.fragment;
      expect([frag?.left.enzyme, frag?.right.enzyme]).toEqual(['BamHI', 'BamHI']);
      expect(frag?.sequence.length).toBe(1006);
    });

    it('waits for the rescan rather than miss a site the edit made', () => {
      const doc2 = edited({ type: 'replace', range: { start: 100, end: 106 }, text: 'GAATTC' });
      render(<CloningPanel doc={doc2} />);
      expect(screen.getByText('Scanning for restriction sites…')).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: 'Add' })).toHaveLength(0);
    });
  });
});
