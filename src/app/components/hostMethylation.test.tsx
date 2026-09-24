// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type HostMethylationState, SeqDocument, findCutSites, getEnzyme } from '@/core';

import { editorStore } from '../state/editorStore';
import { CloningPanel } from './CloningPanel';
import { EnzymePanel } from './EnzymePanel';

/**
 * The host a document was grown in, as the panels use it (#45, item 44).
 *
 * One plasmid carries three sites whose fate is known by construction: an
 * MscI site inside a Dcm CCWGG, an XbaI site overlapping a Dam GATC, and a
 * ClaI site with neither. For each of the four hosts **Grown in** offers,
 * choosing it applies the edit, the select then shows it, the Enzymes
 * tab's digest of everything ticked and the Cloning tab's digest cut
 * exactly the enzymes that host leaves open — and none of that is done by
 * asking `cuttableSites` what to expect. Then the double-digest ranking: an
 * enzyme whose only site the host blocks is offered neither as a partner
 * nor in the **Pair** list, and comes back when the host no longer blocks
 * it.
 */

const HOSTS: readonly { readonly label: string; readonly state: HostMethylationState }[] = [
  { label: 'dam+/dcm+', state: { dam: true, dcm: true } },
  { label: 'dam+ only', state: { dam: true, dcm: false } },
  { label: 'dcm+ only', state: { dam: false, dcm: true } },
  { label: 'unmethylated', state: { dam: false, dcm: false } },
];

/** Which of the three enzymes a host leaves cutting, sorted. */
function open(state: HostMethylationState): string[] {
  return [...(state.dcm ? [] : ['MscI']), ...(state.dam ? [] : ['XbaI']), 'ClaI'].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** `text` with `motif` written over it from `at`. */
function over(text: string, at: number, motif: string): string {
  return text.slice(0, at) + motif + text.slice(at + motif.length);
}

function enzymes(...names: string[]) {
  return names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(`no enzyme ${n}`);
    return e;
  });
}

function current(): SeqDocument {
  const doc = editorStore.document;
  if (doc === null) throw new Error('no document');
  return doc;
}

// 'ACGT' repeated holds no GATC and no CCWGG, so only the planted ones count.
// MscI TGGCCA in CCTGGCCA (Dcm), XbaI TCTAGA in GATCTAGA (Dam), ClaI alone;
// on a 4 kb circle the three cuts leave pieces of distinct sizes.
const PLASMID = [
  [500, 'AACCTGGCCAA'],
  [1500, 'CCGATCTAGACC'],
  [2800, 'AAATCGATAAA'],
].reduce((t, [at, motif]) => over(t, Number(at), String(motif)), 'ACGT'.repeat(1000));

afterEach(() => {
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

beforeEach(() => {
  act(() => {
    editorStore.setEnzymeCutFilter('any');
    editorStore.setEnzymeSupplier('');
    editorStore.setEnzymeSort('name');
    editorStore.setEnzymeSortReversed(false);
    editorStore.setGelAgarose(1);
    editorStore.setGelLadder('auto');
    editorStore.setCloningReaction('ligation');
  });
});

describe('Grown in', () => {
  const doc = SeqDocument.create({ name: 'pHost', sequence: PLASMID, topology: 'circular' });
  const all = enzymes('MscI', 'XbaI', 'ClaI');

  function start() {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, findCutSites(PLASMID, 'circular', all), []);
      editorStore.setShownEnzymes(['MscI', 'XbaI', 'ClaI']);
    });
    return render(<EnzymePanel doc={current()} />);
  }

  const host = (): HTMLElement => screen.getByLabelText('Host methylation');
  const bands = (): number =>
    // Sizes are listed ", "-separated; a size's own thousands comma has no space.
    (document.querySelector('.panel__mono')?.textContent ?? '').split(', ').length;

  it('the plasmid has each site once, so what is cut is only a matter of the host', () => {
    expect(findCutSites(PLASMID, 'circular', all).map((s) => s.enzyme)).toEqual([
      'MscI',
      'XbaI',
      'ClaI',
    ]);
  });

  it('offers the four hosts, starting from an ordinary strain', () => {
    start();
    expect(host()).toHaveValue('dam+/dcm+');
    expect([...host().querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      HOSTS.map((h) => h.label),
    );
  });

  it.each(HOSTS)('applies $label, and digests what it leaves open', ({ label, state }) => {
    const view = start();
    act(() => {
      fireEvent.change(host(), { target: { value: label } });
    });
    expect(current().methylation).toEqual(state);
    view.rerender(<EnzymePanel doc={current()} />);
    expect(host()).toHaveValue(label);
    // On a circle every cut left open is one more piece.
    expect(bands()).toBe(open(state).length);
    // Choosing the host it already has is no edit at all.
    const before = editorStore.getState().documents.length;
    const doc0 = current();
    act(() => {
      fireEvent.change(host(), { target: { value: label } });
    });
    expect(current()).toBe(doc0);
    expect(editorStore.getState().documents.length).toBe(before);
  });

  it('is undone a step at a time, back through each host chosen', () => {
    const view = start();
    for (const { label } of [...HOSTS.slice(1), HOSTS[0]].filter((h) => h !== undefined)) {
      act(() => {
        fireEvent.change(host(), { target: { value: label } });
      });
      view.rerender(<EnzymePanel doc={current()} />);
    }
    // Chosen: dam+ only, dcm+ only, unmethylated, then dam+/dcm+ again.
    for (const { state } of [HOSTS[0], HOSTS[3], HOSTS[2], HOSTS[1]].filter(
      (h) => h !== undefined,
    )) {
      expect(current().methylation).toEqual(state);
      act(() => {
        editorStore.undo();
      });
    }
    expect(current().methylation).toEqual(HOSTS[0]?.state);
  });

  it.each(HOSTS)('makes the Cloning tab digest cut only what $label leaves open', ({ state }) => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, findCutSites(PLASMID, 'circular', all), []);
      editorStore.setShownEnzymes(['MscI', 'XbaI', 'ClaI']);
      editorStore.apply({ type: 'setMethylation', methylation: state });
    });
    // The host is an annotation edit, so the scan stays good for the new version.
    render(<CloningPanel doc={current()} />);
    const used = document.querySelector('.panel__heading-note')?.textContent ?? '';
    expect(used.split(', ')).toEqual(open(state));
    const n = open(state).length;
    expect(
      screen.getByText(new RegExp(`^${n === 1 ? '1 fragment' : `${n} fragments`}`)),
    ).toBeVisible();
    expect(editorStore.getState().preview?.items).toHaveLength(n);
  });
});

describe('double-digest partners and the host', () => {
  // A linear 4 kb: EcoRI at 800, XbaI (Dam-blocked) at 1,900, MscI
  // (Dcm-blocked) at 2,000, ClaI (never blocked) at 3,400. With EcoRI each
  // of the three gives three well-separated pieces.
  const text = [
    [796, 'AGAATTCA'],
    [1896, 'CCGATCTAGACC'],
    [1996, 'AACCTGGCCAA'],
    [3396, 'AAATCGATAAA'],
  ].reduce((t, [at, motif]) => over(t, Number(at), String(motif)), 'ACGT'.repeat(1000));
  const doc = SeqDocument.create({ name: 'pPairs', sequence: text });
  const all = enzymes('EcoRI', 'XbaI', 'MscI', 'ClaI');

  const partners = (): string[] =>
    [...screen.getByTestId('double-digests').querySelectorAll('.enzyme-row__pair')]
      .map((n) => n.textContent.split(' + ')[1] ?? '')
      .sort((a, b) => a.localeCompare(b));
  const pairOptions = (): string[] =>
    [...screen.getByRole('combobox', { name: 'Pair' }).querySelectorAll('option')]
      .map((o) => o.getAttribute('value') ?? '')
      .filter((v) => v !== '')
      .sort((a, b) => a.localeCompare(b));

  it.each(HOSTS)('with $label, pairs EcoRI only with what cuts', ({ state }) => {
    expect(findCutSites(text, 'linear', all).map((s) => s.enzyme)).toEqual([
      'EcoRI',
      'XbaI',
      'MscI',
      'ClaI',
    ]);
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, findCutSites(text, 'linear', all), []);
      editorStore.setShownEnzymes(['EcoRI']);
      editorStore.apply({ type: 'setMethylation', methylation: state });
      editorStore.setEnzymeSort('bands');
    });
    render(<EnzymePanel doc={current()} />);
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Pair' }), {
        target: { value: 'EcoRI' },
      });
    });
    expect(partners()).toEqual(open(state));
    expect(pairOptions()).toEqual(['EcoRI', ...open(state)].sort((a, b) => a.localeCompare(b)));
  });
});

describe('the Cloning tab says what the host took out', () => {
  const all = enzymes('MscI', 'XbaI', 'ClaI');

  function show(ticked: readonly string[], state: HostMethylationState) {
    const doc = SeqDocument.create({
      name: 'pHost',
      sequence: PLASMID,
      topology: 'circular',
      methylation: state,
    });
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, findCutSites(PLASMID, 'circular', all), []);
      editorStore.setShownEnzymes([...ticked]);
    });
    return render(<CloningPanel doc={current()} />);
  }

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('does not call a blocked enzyme unticked', () => {
    show(['MscI', 'XbaI'], { dam: true, dcm: true });
    expect(screen.queryByText(/No enzyme is ticked/)).toBeNull();
    expect(
      screen.getByText(
        /Every site of MscI, XbaI in pHost is blocked by its dam\+\/dcm\+ methylation/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grown in' })).toBeInTheDocument();
  });

  it('names the sites it leaves out when others still cut', () => {
    show(['MscI', 'ClaI'], { dam: true, dcm: true });
    expect(
      screen.getByText(/1 site of MscI is left out: pHost is dam\+\/dcm\+/),
    ).toBeInTheDocument();
  });

  it('says nothing when the host blocks nothing, and still says when nothing is ticked', () => {
    show(['MscI', 'XbaI', 'ClaI'], { dam: false, dcm: false });
    expect(screen.queryByText(/left out/)).toBeNull();
    expect(screen.queryByText(/is blocked by its/)).toBeNull();
  });

  it('keeps the plain message when no enzyme is ticked at all', () => {
    show([], { dam: true, dcm: true });
    expect(screen.getByText(/No enzyme is ticked/)).toBeInTheDocument();
  });
});
