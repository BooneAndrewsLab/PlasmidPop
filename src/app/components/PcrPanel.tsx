import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ANNEAL_DEFAULTS,
  cleanPrimer,
  type PcrPrimer,
  type PcrProduct,
  type PcrSite,
  type Range,
  type SeqDocument,
  digest,
  type Polymerase,
  POLYMERASE_REACH,
  gelProfile,
  meltingTemperature,
  pcr,
  primerDimers,
  rangeWraps,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useGelOptions } from '../state/useGel';
import { useEditorState } from '../state/useEditorStore';
import { Gel } from './Gel';

/**
 * PCR: the reaction that makes a part rather than joining parts.
 *
 * It sits in the Cloning tab with the other three because what comes out of
 * it is a molecule, and because that molecule is what the other three then
 * take: a Gibson's homology arms are tails on these primers, and a
 * restriction-ligation's sites are too. It is unlike them in one way — it
 * has one template rather than a tube of parts. That is the document in
 * front of you unless another open tab is picked (#13), and only the one in
 * front can have its products drawn on the views.
 *
 * The panel asks for two oligos and nothing else. Everything a designer
 * chose is already in them: the tail carries the site or the arm, the
 * mismatches carry the mutation, and where they anneal decides the product.
 * So there is no form here for any of that, only a report of what those two
 * sequences would do.
 */

const FORWARD = 'Forward';
const REVERSE = 'Reverse';
/** Stable empty list, so a render with no primers is not a new preview. */
const NO_PRODUCTS: readonly PcrProduct[] = [];

/** The bases of an oligo as the search reads it, junk and case aside. */
function cleaned(sequence: string): string {
  return cleanPrimer(sequence);
}

/** Where a site is, said the way the rest of the app says a position. */
function describeSite(site: PcrSite, seqLength: number): string {
  const from = site.range.start + 1;
  const to = ((site.range.end - 1) % Math.max(1, seqLength)) + 1;
  const arrow = site.strand === 'forward' ? '→' : '←';
  return `${arrow} ${from.toLocaleString()}–${to.toLocaleString()}`;
}

/** A stretch of template, 1-based and inclusive as the rest of the app writes one. */
function describeSpan(r: Range, seqLength: number): string {
  const from = r.start + 1;
  const to = ((r.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}\u2013${to.toLocaleString()}`;
}

/** What one oligo is doing: its length, its tail, and where it lands. */
function PrimerReport({
  sites,
  sequence,
  seqLength,
}: {
  readonly sites: readonly PcrSite[];
  readonly sequence: string;
  readonly seqLength: number;
}) {
  const bases = cleaned(sequence);
  if (bases === '') return null;
  const first = sites[0];
  if (first === undefined) {
    return (
      <p className="panel__note panel__note--quiet">
        {bases.length < ANNEAL_DEFAULTS.minAnneal
          ? `${bases.length} nt \u2014 shorter than the ${ANNEAL_DEFAULTS.minAnneal} bases a site needs.`
          : `${bases.length} nt \u2014 no 3\u2032 end long enough to prime. The last ${ANNEAL_DEFAULTS.exactThreePrime} bases have to match exactly.`}
      </p>
    );
  }
  const tail = first.tail.length;
  // Two numbers where the first cycles and the rest differ (#14): until the
  // product exists, only the 3′ stretch up to a mismatch surely pairs and a
  // tail pairs with nothing; from then on the whole oligo matches.
  const later = tail > 0 ? meltingTemperature(first.primer) : first.tm;
  const differs = first.mismatches > 0 || tail > 0;
  const where =
    sites.length === 1
      ? describeSite(first, seqLength)
      : `${sites.length} sites: ${sites
          .slice(0, 3)
          .map((s) => describeSite(s, seqLength))
          .join(', ')}${sites.length > 3 ? '…' : ''}`;
  return (
    <p className="panel__note panel__note--quiet">
      {first.primer.length} nt
      {tail > 0 ? `, ${tail} of them a 5′ tail` : ''},{' '}
      {differs
        ? `Tm ${first.templateTm.toFixed(0)} °C on the template${first.mismatches > 0 ? ' (up to the first mismatch)' : ''}, ${later.toFixed(0)} °C once the product carries it`
        : `Tm ${first.tm.toFixed(0)} °C`}{' '}
      · {where}
      {first.mismatches > 0
        ? ` · ${first.mismatches} mismatch${first.mismatches === 1 ? '' : 'es'}, which the product keeps`
        : ''}
    </p>
  );
}

/**
 * What the reaction would put in the views. With nothing picked, every
 * product at once and every site an arrow — which is how an off-target band
 * is seen for what it is, beside the one that was wanted. Picking one shows
 * that one alone.
 */
function preview(
  products: readonly PcrProduct[],
  sites: readonly PcrSite[],
  picked: number | null,
): OverlaySpan[] {
  const chosen = picked === null ? undefined : products[picked];
  if (chosen !== undefined) {
    return [
      {
        id: `product-${picked ?? 0}`,
        label: `Product ${chosen.length.toLocaleString()} bp`,
        range: chosen.templateRange,
        strand: 'none',
        shape: 'span',
        clickable: true,
      },
      { id: 'fwd', label: FORWARD, range: chosen.forward.range, strand: 'forward', shape: 'arrow' },
      { id: 'rev', label: REVERSE, range: chosen.reverse.range, strand: 'reverse', shape: 'arrow' },
    ];
  }
  return [
    ...products.map((p, i) => ({
      id: `product-${i}`,
      label: `${p.length.toLocaleString()} bp`,
      range: p.templateRange,
      strand: 'none' as const,
      shape: 'span' as const,
      clickable: true,
    })),
    ...sites.map((s, i) => ({
      id: `site-${i}`,
      label: s.name,
      range: s.range,
      strand: s.strand,
      shape: 'arrow' as const,
    })),
  ];
}

/**
 * A product as a shelf fragment: the whole linear molecule, which is what a
 * digest with no cuts gives, so its ends are the product's own (blunt, as
 * the polymerase leaves them) and its features come along.
 */
function shelve(product: PcrProduct, phosphorylated: boolean): void {
  const [whole] = digest(product.document, []);
  // An oligo is made without a 5′ phosphate unless ordered with one, and a
  // PCR product's 5′ ends are its primers' (#14), so it cannot be ligated
  // into a dephosphorylated vector unless they were.
  if (whole !== undefined) {
    editorStore.addToShelf(phosphorylated ? whole : { ...whole, dephosphorylated: true });
  }
}

/**
 * The option is a name, short enough for a 300 px sidebar; what the choice
 * does to the product is said under it, where there is room.
 */
const POLYMERASES: readonly { value: Polymerase; label: string; ends: string }[] = [
  { value: 'proofreading', label: 'Proofreading', ends: 'Q5, Phusion, Pfu: blunt ends' },
  { value: 'taq', label: 'Taq', ends: 'One 3′ A on each end, for TA cloning' },
];

export function PcrPanel({ doc }: { readonly doc: SeqDocument }) {
  const { previewActivated: activated, documents, documentId } = useEditorState();
  // The template: another open tab when one is picked, the document in front
  // of you otherwise, and again when the picked tab is closed.
  const [templateId, setTemplateId] = useState<string | null>(null);
  const picked = documents.find((d) => d.documentId === templateId && templateId !== documentId);
  const template = picked?.history.present ?? doc;
  // The views draw the document in front of you, so only its products and
  // sites can be previewed; another tab's would land on the wrong molecule.
  const drawn = picked === undefined;
  const [forward, setForward] = useState('');
  const [polymerase, setPolymerase] = useState<Polymerase>('proofreading');
  const [phosphorylated, setPhosphorylated] = useState(false);
  const [reverse, setReverse] = useState('');
  /** The product held on screen, and the one under the pointer. */
  const [shown, setShown] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const primers = useMemo<PcrPrimer[]>(() => {
    const out: PcrPrimer[] = [];
    if (forward.trim() !== '') out.push({ name: FORWARD, sequence: forward });
    if (reverse.trim() !== '') out.push({ name: REVERSE, sequence: reverse });
    return out;
  }, [forward, reverse]);

  // Two walks over the template per primer, so it costs less than the digest
  // above it and runs here rather than in the worker (docs/perf-notes.md).
  const result = useMemo(
    () => (primers.length === 0 ? null : pcr(template, primers, { polymerase })),
    [template, primers, polymerase],
  );
  const dimers = useMemo(() => primerDimers(primers), [primers]);
  const products = result?.products ?? NO_PRODUCTS;
  const gel = useGelOptions();
  const lane = useMemo(
    () =>
      gelProfile(
        products.map((p) => p.length),
        gel,
      ),
    [products, gel],
  );

  const pointed = shown ?? hovered;
  const spans = useMemo(
    () => (drawn ? preview(products, result?.sites ?? [], pointed) : []),
    [drawn, products, result, pointed],
  );
  useEffect(() => {
    editorStore.setPreview('pcr', spans);
  }, [spans]);
  useEffect(
    () => () => {
      editorStore.clearPreview('pcr');
    },
    [],
  );

  const open = (product: PcrProduct): void => {
    analytics.track('cloning', 'pcr');
    editorStore.openDocument(product.document);
    editorStore.setSidebarTab('features');
  };

  // A click on a previewed product in either view opens it, as clicking a
  // digest fragment shelves it. Seeded at mount so coming back to the tab
  // does not answer the last click again.
  const handled = useRef(activated?.nonce ?? 0);
  useEffect(() => {
    if (activated?.owner !== 'pcr') return;
    if (activated.nonce === handled.current) return;
    handled.current = activated.nonce;
    const index = Number(activated.id.replace('product-', ''));
    const product = products[index];
    if (product !== undefined) open(product);
  }, [activated, products]);

  const show = (index: number): void => {
    if (!drawn) return;
    setShown((s) => (s === index ? null : index));
    // Holding a product on the views is worth nothing if the sequence view is
    // a thousand bases away from it. Nothing is selected, though: the preview
    // is what is being pointed at, and a selection the user made is theirs.
    const product = products[index];
    if (product !== undefined && shown !== index) {
      editorStore.revealPosition(product.templateRange.start);
    }
  };

  return (
    <>
      <div className="panel__controls">
        {documents.length > 1 && (
          <label className="panel__field panel__field--row">
            <span>Template</span>
            <select
              className="panel__select"
              value={picked?.documentId ?? ''}
              onChange={(e) => {
                setTemplateId(e.target.value === '' ? null : e.target.value);
                setShown(null);
                setHovered(null);
              }}
            >
              <option value="">{doc.name} (this tab)</option>
              {documents
                .filter((d) => d.documentId !== documentId)
                .map((d) => (
                  <option key={d.documentId} value={d.documentId}>
                    {d.history.present.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="panel__field panel__field--stack">
          <span>Forward primer</span>
          <input
            className="panel__search"
            type="text"
            spellCheck={false}
            placeholder="5′ tail and all"
            value={forward}
            onChange={(e) => {
              setForward(e.target.value);
              setShown(null);
            }}
          />
        </label>
        <PrimerReport
          sites={result?.sites.filter((s) => s.name === FORWARD) ?? []}
          sequence={forward}
          seqLength={template.length}
        />
        <label className="panel__field panel__field--stack">
          <span>Reverse primer</span>
          <input
            className="panel__search"
            type="text"
            spellCheck={false}
            placeholder="written 5′ to 3′, as you would order it"
            value={reverse}
            onChange={(e) => {
              setReverse(e.target.value);
              setShown(null);
            }}
          />
        </label>
        <PrimerReport
          sites={result?.sites.filter((s) => s.name === REVERSE) ?? []}
          sequence={reverse}
          seqLength={template.length}
        />
        <label className="panel__field panel__field--row">
          <span>Polymerase</span>
          <select
            className="panel__select"
            value={polymerase}
            onChange={(e) => {
              setPolymerase(e.target.value === 'taq' ? 'taq' : 'proofreading');
              setShown(null);
            }}
          >
            {POLYMERASES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="panel__note panel__note--quiet">
          {POLYMERASES.find((p) => p.value === polymerase)?.ends}, products up to{' '}
          {(POLYMERASE_REACH[polymerase] / 1000).toString()} kb.
        </p>
        <label
          className="toggle"
          title="Oligos are made without a 5′ phosphate unless ordered with one; without it the product will not ligate into a dephosphorylated vector"
        >
          <input
            type="checkbox"
            checked={phosphorylated}
            onChange={(e) => {
              setPhosphorylated(e.target.checked);
            }}
          />
          5′-phosphorylated primers
        </label>
      </div>
      {dimers.length > 0 && (
        <ul className="panel__warnings" aria-label="Primer dimers">
          {dimers.map((d) => (
            <li key={`${d.primer}-${d.partner}`}>
              The last {d.bases} bases of the {d.primer.toLowerCase()} primer pair with{' '}
              {d.partner === d.primer
                ? 'a second copy of itself'
                : `the ${d.partner.toLowerCase()} primer`}
              , so they can prime each other into a primer dimer.
            </li>
          ))}
        </ul>
      )}

      {result === null ? (
        <p className="panel__note">
          Paste the two oligos to amplify {template.name} with. Only their 3′ ends have to match it:
          a 5′ tail — a restriction site, a Gibson homology arm, a tag — is copied into the product,
          which is how a part is made that is in no file yet.
        </p>
      ) : products.length === 0 ? (
        <p className="panel__error">{result.problem}</p>
      ) : (
        <>
          <p className="panel__note">
            {products.length === 1
              ? 'One product:'
              : `${products.length} products, the cleanest and shortest first — a real tube gives them all:`}
          </p>
          {!drawn && (
            <p className="panel__note panel__note--quiet">
              The views show {doc.name}, so products of {template.name} are listed here but not
              drawn.
            </p>
          )}
          <ol className="pair-list" aria-label="PCR products">
            {products.map((p, i) => (
              <li
                key={i}
                className={`pair${shown === i ? ' pair--shown' : ''}`}
                onMouseEnter={() => {
                  setHovered(i);
                }}
                onMouseLeave={() => {
                  setHovered((h) => (h === i ? null : h));
                }}
              >
                <div className="pair__row pair__row--wide">
                  <span className="pair__length">{p.length.toLocaleString()} bp</span>
                  <span className="pair__meta">
                    {describeSpan(p.templateRange, template.length)}
                    {rangeWraps(p.templateRange, template.length) ? ', over the origin' : ''}
                  </span>
                </div>
                <div className="pair__foot">
                  <span>
                    {p.mismatches === 0
                      ? 'exact match'
                      : `${p.mismatches} primer mismatch${p.mismatches === 1 ? '' : 'es'} carried in`}
                    {p.forward.tail.length + p.reverse.tail.length > 0
                      ? `, ${(p.forward.tail.length + p.reverse.tail.length).toLocaleString()} bp of tail`
                      : ''}
                  </span>
                  <span className="pair__buttons">
                    {drawn && (
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        aria-pressed={shown === i}
                        title="Draw this product and its primers on both views"
                        onClick={() => {
                          show(i);
                        }}
                      >
                        {shown === i ? 'Hide' : 'Show'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      title="Put the product on the shelf, for a ligation, Golden Gate or Gibson"
                      onClick={() => {
                        analytics.track('cloning', 'pcr');
                        shelve(p, phosphorylated);
                      }}
                    >
                      Shelve
                    </button>
                    <button
                      type="button"
                      className="button button--quiet button--small"
                      title="Open the product as a document of its own"
                      onClick={() => {
                        open(p);
                      }}
                    >
                      Open
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
          {result.tooLong > 0 && (
            <p className="panel__note panel__note--quiet">
              {result.tooLong === 1 ? 'One more pairing' : `${result.tooLong} more pairings`} would
              amplify, but longer than a polymerase manages.
            </p>
          )}
          {/* What would come off the machine: one band, or the two you would
              have to tell apart. Clicking one picks that product. */}
          <Gel
            lanes={[
              drawn
                ? {
                    profile: lane,
                    label: 'PCR',
                    onPick: (band) => {
                      const index = products.findIndex((p) => p.length === band.length);
                      if (index >= 0) show(index);
                    },
                    pickTitle: (band) =>
                      `Show the ${band.length.toLocaleString()} bp product on the views`,
                  }
                : { profile: lane, label: 'PCR' },
            ]}
          />
        </>
      )}
    </>
  );
}
