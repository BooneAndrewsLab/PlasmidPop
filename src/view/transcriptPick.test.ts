import { type Feature, type Qualifier, createFeature, rangeSegment, siteSegment } from '@/core';
import { INS_LENGTH, insShapedRecord } from '@/test/insShapedRecord';

import { groupFeatures } from './featureGroups';
import {
  NO_PICKS,
  carries,
  describeTranscript,
  transcriptOptionLabel,
  planTranscripts,
  showTranscripts,
  transcriptChoice,
  transcriptKey,
  transcriptPicksBanner,
  transcriptPicksNote,
  transcriptVariants,
} from './transcriptPick';
import { drawableFeatures } from './visibleFeatures';

const q = (name: string, value: string | null = null): Qualifier => ({ name, value });
const gene = (g: string): Qualifier => q('gene', g);

const f = (
  id: string,
  type: string,
  segments: readonly [number, number][],
  options: {
    readonly name?: string;
    readonly strand?: 'forward' | 'reverse';
    readonly qualifiers?: readonly Qualifier[];
  } = {},
): Feature =>
  createFeature({
    id,
    type,
    name: options.name ?? '',
    strand: options.strand ?? 'forward',
    segments: segments.map(([s, e]) => rangeSegment(s, e)),
    qualifiers: options.qualifiers ?? [],
  });

const picks = (...entries: readonly (readonly [string, string])[]): Map<string, string> =>
  new Map(entries);

const hiddenIds = (plan: ReturnType<typeof planTranscripts>): string[] => [...plan.hidden].sort();

/**
 * A gene whose variants really differ: A has three exons, B skips the
 * middle one, C keeps the intron between the first two. CDS `ca` is A's
 * alone (it uses the middle exon), `cb` is B's alone (it splices 1 to 3),
 * `cc` reads through the intron so only C can carry it, and `cs` is a
 * single-exon CDS every variant can carry.
 */
function isoformRecord(strand: 'forward' | 'reverse' = 'forward'): Feature[] {
  const g = [gene('G')];
  const o = { strand, qualifiers: g };
  return [
    f('gene', 'gene', [[0, 500]], { name: 'G', ...o }),
    f(
      'mA',
      'mRNA',
      [
        [0, 100],
        [200, 300],
        [400, 500],
      ],
      { name: 'G variant A', strand, qualifiers: [...g, q('transcript_id', 'NM_A')] },
    ),
    f(
      'mB',
      'mRNA',
      [
        [0, 100],
        [400, 500],
      ],
      { name: 'G variant B', strand, qualifiers: [...g, q('transcript_id', 'NM_B')] },
    ),
    f(
      'mC',
      'mRNA',
      [
        [0, 300],
        [400, 500],
      ],
      { name: 'G variant C', strand, qualifiers: [...g, q('transcript_id', 'NM_C')] },
    ),
    f(
      'ca',
      'CDS',
      [
        [50, 100],
        [200, 300],
        [400, 450],
      ],
      o,
    ),
    f('pa', 'mat_peptide', [[210, 290]], o),
    f(
      'cb',
      'CDS',
      [
        [50, 100],
        [400, 450],
      ],
      o,
    ),
    f('cc', 'CDS', [[50, 250]], o),
    f('cs', 'CDS', [[420, 480]], o),
    // Inside every CDS's first piece: cut from whichever is drawn.
    f('sig', 'sig_peptide', [[50, 80]], o),
    // In no CDS at all.
    f('loose', 'sig_peptide', [[0, 30]], o),
  ];
}

describe('carries', () => {
  it('needs every piece inside an exon, in order, with the junctions on exon boundaries', () => {
    const [, mA, mB, mC, ca, , cb, cc, cs] = isoformRecord();
    if (!mA || !mB || !mC || !ca || !cb || !cc || !cs) throw new Error('fixture');
    expect(carries(mA, ca, 500)).toBe(true);
    expect(carries(mB, ca, 500)).toBe(false);
    expect(carries(mC, ca, 500)).toBe(false);
    expect(carries(mA, cb, 500)).toBe(false);
    expect(carries(mB, cb, 500)).toBe(true);
    expect(carries(mC, cb, 500)).toBe(false);
    // Reading through the intron: only the variant that keeps it.
    expect(carries(mA, cc, 500)).toBe(false);
    expect(carries(mC, cc, 500)).toBe(true);
    // A single exon's worth lies in all three.
    expect(carries(mA, cs, 500)).toBe(true);
    expect(carries(mB, cs, 500)).toBe(true);
    expect(carries(mC, cs, 500)).toBe(true);
  });

  it('never crosses strands and never places a site', () => {
    const fwd = f('m', 'mRNA', [[0, 100]]);
    const rev = f('c', 'CDS', [[10, 40]], { strand: 'reverse' });
    expect(carries(fwd, rev, 100)).toBe(false);
    const site = createFeature({ id: 's', type: 'sig_peptide', segments: [siteSegment(20)] });
    expect(carries(fwd, site, 100)).toBe(false);
  });

  it('follows a feature through the origin of a circular sequence', () => {
    // An mRNA whose first exon wraps: bases 900–999 and 0–49, then 100–200.
    const m = f('m', 'mRNA', [
      [900, 1050],
      [100, 200],
    ]);
    expect(
      carries(
        m,
        f('c', 'CDS', [
          [950, 1050],
          [100, 150],
        ]),
        1000,
      ),
    ).toBe(true);
    // A single piece in the tail, in real coordinates.
    expect(carries(m, f('c2', 'CDS', [[10, 40]]), 1000)).toBe(true);
    // One that straddles the wrapped exon's splice end.
    expect(carries(m, f('c3', 'CDS', [[10, 60]]), 1000)).toBe(false);
    // Its own junction must be the exon's: 1050 and 100.
    expect(
      carries(
        m,
        f('c4', 'CDS', [
          [950, 1040],
          [100, 150],
        ]),
        1000,
      ),
    ).toBe(false);
  });
});

describe('transcriptVariants', () => {
  it('offers the genes with two or more mRNAs, each in document order, hidden types or not', () => {
    const variants = transcriptVariants(insShapedRecord(), INS_LENGTH);
    expect([...variants.keys()]).toEqual(['INS']);
    expect(variants.get('INS')?.map((m) => m.id)).toEqual(['m-3', 'm-4', 'm-2', 'm-1']);
    // The readthrough has one mRNA: nothing to pick.
    expect(variants.has('INS-IGF2')).toBe(false);
  });

  it('is empty without mRNAs or without /gene on them', () => {
    expect(transcriptVariants([f('a', 'CDS', [[0, 10]])], 100).size).toBe(0);
    const loose = [f('m1', 'mRNA', [[0, 10]]), f('m2', 'mRNA', [[0, 20]])];
    expect(transcriptVariants(loose, 100).size).toBe(0);
  });
});

describe('transcriptKey and transcriptChoice', () => {
  it('name a transcript by its accession, else by its name and location', () => {
    const named = f('m', 'mRNA', [[0, 10]], {
      name: 'x, transcript variant 1',
      qualifiers: [q('transcript_id', ' NM_1 ')],
    });
    expect(transcriptKey(named)).toBe('NM_1');
    expect(transcriptChoice(named)).toBe('NM_1');
    expect(describeTranscript(named)).toBe('NM_1 — x, transcript variant 1');
    const plain = f('m', 'mRNA', [
      [0, 10],
      [20, 30],
    ]);
    expect(transcriptKey(plain)).toBe('mRNA@0-10,20-30');
    expect(transcriptChoice(plain)).toBe('mRNA');
    expect(describeTranscript(plain)).toBe('mRNA');
  });
});

describe('planTranscripts on the INS record', () => {
  const all = insShapedRecord();

  it('does nothing without picks, or with picks naming nothing the document has', () => {
    expect(planTranscripts(all, NO_PICKS, INS_LENGTH).hidden.size).toBe(0);
    const stale = planTranscripts(
      all,
      picks(['TP53', 'NM_000546.6'], ['INS', 'NM_999999.9']),
      INS_LENGTH,
    );
    expect(stale.hidden.size).toBe(0);
    expect(stale.picked.size).toBe(0);
    // The variants are still reported, for the picker.
    expect(stale.variants.has('INS')).toBe(true);
    expect(showTranscripts(all, stale)).toEqual(all);
  });

  it('leaves out the other mRNAs and nothing the chosen transcript could carry', () => {
    const plan = planTranscripts(all, picks(['INS', 'NM_000207.3']), INS_LENGTH);
    expect(plan.picked.get('INS')?.map((m) => m.id)).toEqual(['m-1']);
    // The four CDSs differ only in /protein_id and every variant can carry
    // each of them, so none is anyone's to hide; nor are their peptides.
    expect(hiddenIds(plan)).toEqual(['m-2', 'm-3', 'm-4']);
    // The readthrough gene is not touched.
    const shown = showTranscripts(all, plan);
    expect(shown.some((x) => x.id === 'm-rt')).toBe(true);
    expect(shown.some((x) => x.id === 'c-rt')).toBe(true);
    expect(shown).toHaveLength(all.length - 3);
  });

  it('gives the lanes one plain mRNA row where the transcripts row was', () => {
    const plan = planTranscripts(all, picks(['INS', 'NM_000207.3']), INS_LENGTH);
    const drawn = groupFeatures(showTranscripts(drawableFeatures(all), plan), INS_LENGTH);
    const mRNAs = drawn.features.filter((x) => x.type === 'mRNA');
    expect(mRNAs.map((m) => m.id)).toEqual(['m-rt', 'm-1']);
    expect([...drawn.groups.values()].some((g) => g.kind === 'transcripts')).toBe(false);
    // The copies are still grouped: one CDS bar, one of each peptide.
    expect(drawn.features.filter((x) => x.type === 'CDS').map((x) => x.name)).toEqual([
      'insulin, isoform 2 precursor',
      'insulin preproprotein ×4',
    ]);
  });

  it('places a peptide by its CDS even when CDS is hidden by type (item 109)', () => {
    // The hidden types are applied by the caller; the plan sees the document.
    const plan = planTranscripts(all, picks(['INS', 'NM_000207.3']), INS_LENGTH);
    const shown = showTranscripts(drawableFeatures(all, new Set(['CDS', 'mRNA'])), plan);
    expect(shown.filter((x) => x.type === 'sig_peptide')).toHaveLength(5);
  });
});

describe('planTranscripts where the variants differ', () => {
  it('hides the CDSs and peptides the chosen transcript cannot carry', () => {
    const all = isoformRecord();
    const a = planTranscripts(all, picks(['G', 'NM_A']), 500);
    // B's CDS and C's read-through CDS go; A's own, the shared single-exon
    // CDS, the peptide in A's middle exon and the signal peptide stay.
    expect(hiddenIds(a)).toEqual(['cb', 'cc', 'mB', 'mC']);
    const b = planTranscripts(all, picks(['G', 'NM_B']), 500);
    // A's peptide lies in a hidden CDS and in no other: it goes with it.
    expect(hiddenIds(b)).toEqual(['ca', 'cc', 'mA', 'mC', 'pa']);
    const c = planTranscripts(all, picks(['G', 'NM_C']), 500);
    expect(hiddenIds(c)).toEqual(['ca', 'cb', 'mA', 'mB', 'pa']);
  });

  it('keeps a peptide that any shown CDS carries, and one that no CDS carries', () => {
    const all = isoformRecord();
    for (const key of ['NM_A', 'NM_B', 'NM_C']) {
      const plan = planTranscripts(all, picks(['G', key]), 500);
      expect(plan.hidden.has('sig')).toBe(false);
      expect(plan.hidden.has('loose')).toBe(false);
      expect(plan.hidden.has('cs')).toBe(false);
    }
  });

  it('keeps a CDS that fits none of its gene’s transcripts, and one with no /gene', () => {
    const all = [
      ...isoformRecord(),
      // Spliced where no variant is.
      f(
        'odd',
        'CDS',
        [
          [50, 90],
          [400, 450],
        ],
        { qualifiers: [gene('G')] },
      ),
      f('anon', 'CDS', [[200, 300]]),
      f('other', 'CDS', [[200, 300]], { qualifiers: [gene('H')] }),
    ];
    const plan = planTranscripts(all, picks(['G', 'NM_B']), 500);
    expect(plan.hidden.has('odd')).toBe(false);
    expect(plan.hidden.has('anon')).toBe(false);
    expect(plan.hidden.has('other')).toBe(false);
  });

  it('places a peptide only with its own gene’s CDSs when both name one', () => {
    const all = [
      ...isoformRecord(),
      // On the same bases as `ca`, but another gene's: the gene's own CDS
      // is `ca` only, and it is hidden under B.
      f('pz', 'mat_peptide', [[210, 290]], { qualifiers: [gene('Z')] }),
      f('pn', 'mat_peptide', [[210, 290]]),
    ];
    const plan = planTranscripts(all, picks(['G', 'NM_B']), 500);
    // Z's peptide: G's CDSs are not its own, so nothing carries it; it stays.
    expect(plan.hidden.has('pz')).toBe(false);
    // One with no /gene is placed by the bases alone: in `ca`, which is hidden.
    expect(plan.hidden.has('pn')).toBe(true);
  });

  it('keeps a peptide two overlapping variants both carry while either is shown', () => {
    const all = [
      ...isoformRecord(),
      // In the first exon of A and B alike (and C, by containment).
      f('shared', 'mat_peptide', [[60, 90]], { qualifiers: [gene('G')] }),
    ];
    for (const key of ['NM_A', 'NM_B', 'NM_C']) {
      expect(planTranscripts(all, picks(['G', key]), 500).hidden.has('shared')).toBe(false);
    }
  });

  it('works the same on the reverse strand, and never across strands', () => {
    const all = [
      ...isoformRecord('reverse'),
      // Forward strand, A's coordinates: no reverse transcript carries it.
      f(
        'fwd',
        'CDS',
        [
          [50, 100],
          [200, 300],
          [400, 450],
        ],
        { qualifiers: [gene('G')] },
      ),
    ];
    const plan = planTranscripts(all, picks(['G', 'NM_B']), 500);
    expect(hiddenIds(plan)).toEqual(['ca', 'cc', 'mA', 'mC', 'pa']);
    expect(plan.hidden.has('fwd')).toBe(false);
  });

  it('follows a variant through the origin of a circular sequence', () => {
    const g = [gene('W')];
    const all = [
      f(
        'wA',
        'mRNA',
        [
          [900, 1050],
          [100, 200],
        ],
        { qualifiers: [...g, q('transcript_id', 'NM_WA')] },
      ),
      f(
        'wB',
        'mRNA',
        [
          [900, 1050],
          [300, 400],
        ],
        { qualifiers: [...g, q('transcript_id', 'NM_WB')] },
      ),
      f(
        'ca',
        'CDS',
        [
          [950, 1050],
          [100, 150],
        ],
        { qualifiers: g },
      ),
      // In the wrapped exon's tail, real coordinates: both carry it.
      f('ct', 'CDS', [[10, 40]], { qualifiers: g }),
      f('pt', 'sig_peptide', [[10, 20]], { qualifiers: g }),
      f('pa', 'sig_peptide', [[960, 1000]], { qualifiers: g }),
    ];
    // B cannot carry `ca`; `pa` is cut from `ca` alone, so it goes with it.
    // `ct` and `pt`, in the wrapped exon's tail, both variants carry.
    expect(hiddenIds(planTranscripts(all, picks(['W', 'NM_WB']), 1000))).toEqual([
      'ca',
      'pa',
      'wA',
    ]);
    expect(hiddenIds(planTranscripts(all, picks(['W', 'NM_WA']), 1000))).toEqual(['wB']);
  });

  it('picks by name and location when a hand-made file has no /transcript_id', () => {
    const g = [gene('H')];
    const all = [
      f('h1', 'mRNA', [[0, 100]], { name: 'short', qualifiers: g }),
      f(
        'h2',
        'mRNA',
        [
          [0, 100],
          [200, 300],
        ],
        { name: 'long', qualifiers: g },
      ),
      f('c2', 'CDS', [[220, 280]], { qualifiers: g }),
    ];
    const variants = transcriptVariants(all, 300);
    expect(variants.get('H')?.map(transcriptKey)).toEqual(['short@0-100', 'long@0-100,200-300']);
    const plan = planTranscripts(all, picks(['H', 'short@0-100']), 300);
    expect(hiddenIds(plan)).toEqual(['c2', 'h2']);
  });
});

describe('the notes', () => {
  it('count the picks and name the genes', () => {
    expect(transcriptPicksNote(1)).toBe('1 transcript picked');
    expect(transcriptPicksNote(2)).toBe('2 transcripts picked');
    const one = planTranscripts(insShapedRecord(), picks(['INS', 'NM_000207.3']), INS_LENGTH);
    expect(transcriptPicksBanner(one)).toMatch(/^Showing one transcript of INS in the views;/);
    const two = planTranscripts(
      [...insShapedRecord(), ...isoformRecord()],
      picks(['INS', 'NM_000207.3'], ['G', 'NM_A']),
      INS_LENGTH,
    );
    expect(transcriptPicksBanner(two)).toMatch(/^Showing one transcript of INS and G in/);
  });
});

describe('transcriptOptionLabel', () => {
  it('joins the accession and the name, cuts a long name, and drops a repeat', () => {
    const named = f('m', 'mRNA', [[0, 10]], {
      name: 'x, transcript variant 1',
      qualifiers: [q('transcript_id', 'NM_1')],
    });
    expect(transcriptOptionLabel(named)).toBe('NM_1 · x, transcript variant 1');
    expect(transcriptOptionLabel(named, 8)).toBe('NM_1 · x, tran…');
    const plain = f('m', 'mRNA', [[0, 10]]);
    expect(transcriptOptionLabel(plain)).toBe('mRNA');
  });
});
