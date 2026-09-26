import { useMemo, useState } from 'react';

import {
  type CodonSite,
  type MutagenesisMethod,
  type MutagenesisPrimer,
  type SeqDocument,
  AMINO_ACID_NAMES,
  CODON_USAGE_TABLES,
  DEGENERATE_CODONS,
  STOP,
  codonChoices,
  codonOnForwardStrand,
  codonSiteAt,
  codonUsageTable,
  designMutagenesis,
  isEmptyRange,
  libraryCoverage,
  recordMutagenesis,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';

const METHODS: readonly { value: MutagenesisMethod; label: string; title: string }[] = [
  {
    value: 'back-to-back',
    label: 'Back to back',
    title:
      'NEB Q5 site-directed mutagenesis: primers pointing away from each other, the change on the forward one; amplify, then KLD',
  },
  {
    value: 'overlapping',
    label: 'Overlapping',
    title: 'Agilent QuikChange: two complementary primers with the change in the middle',
  },
];

function PrimerLine({
  label,
  primer,
  method,
}: {
  readonly label: string;
  readonly primer: MutagenesisPrimer;
  readonly method: MutagenesisMethod;
}) {
  return (
    <li className="pair">
      <div className="pair__row pair__row--wide">
        <span className="pair__length">{label}</span>
        <span className="pair__meta">
          {primer.sequence.length} nt, Tm {primer.tm.toFixed(0)} °C
          {primer.q5Tm === null ? '' : ` (NEB Q5 ${primer.q5Tm.toFixed(0)} °C)`}
          {method === 'overlapping' ? ' (Agilent)' : ` over the ${primer.annealLength} that anneal`}
        </span>
      </div>
      <div className="pair__foot">
        <code className="mutagenesis__oligo">{primer.sequence}</code>
        <span className="pair__buttons">
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label={`Copy the ${label.toLowerCase()} primer`}
            onClick={() => {
              copyText(primer.sequence);
            }}
          >
            Copy
          </button>
        </span>
      </div>
    </li>
  );
}

/** The 20 amino acids and a stop, for the residue menu. */
const RESIDUES: readonly string[] = [...'ACDEFGHIKLMNPQRSTVWY'.split(''), STOP];

/**
 * Changing a residue rather than bases (#69): the codon the selection sits
 * in, the amino acid it is to become, and the codons the chosen host uses
 * for it, its commonest first. Picking one selects the codon and puts its
 * bases in the change box, so the primers are designed for it like any
 * other change. A degenerate codon makes a library instead, and says what
 * it covers.
 */
function CodonChange({
  site,
  host,
  setHost,
  onApply,
}: {
  readonly site: CodonSite;
  readonly host: string;
  readonly setHost: (id: string) => void;
  readonly onApply: (codon: string) => void;
}) {
  const [residue, setResidue] = useState('');
  const [library, setLibrary] = useState('');
  const table = codonUsageTable(host);
  const choices = useMemo(
    () => (residue === '' ? [] : codonChoices(residue, table, site.codon, site.table)),
    [residue, table, site.codon, site.table],
  );
  const coverage = useMemo(
    () => (library === '' ? null : libraryCoverage(library, site.table)),
    [library, site.table],
  );
  const name = site.feature.name === '' ? 'CDS' : site.feature.name;

  return (
    <div className="panel__section">
      <h3 className="panel__heading">
        Change a residue
        <span className="panel__heading-note">
          {name} {site.aminoAcid}
          {site.residue} ({site.codon})
        </span>
      </h3>
      <div className="panel__controls">
        <label className="panel__field panel__field--row">
          <span>To</span>
          <select
            className="panel__select"
            aria-label="New amino acid"
            value={residue}
            onChange={(e) => {
              setResidue(e.target.value);
              setLibrary('');
            }}
          >
            <option value="">choose a residue</option>
            {RESIDUES.map((aa) => (
              <option key={aa} value={aa}>
                {aa === STOP ? 'Stop (*)' : `${aa} — ${AMINO_ACID_NAMES[aa]?.name ?? aa}`}
                {aa === site.aminoAcid ? ' (as now)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="panel__field panel__field--row">
          <span>Host</span>
          <select
            className="panel__select"
            aria-label="Codon usage host"
            title="Whose codon usage orders the codons: the Codon Usage Database's counts for that organism"
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
            }}
          >
            {CODON_USAGE_TABLES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {choices.length > 0 && (
        <>
          <ul className="codon-choices" aria-label="Codons for the new residue">
            {choices.map((c, i) => (
              <li key={c.codon}>
                <button
                  type="button"
                  className="button button--small"
                  title={`${(c.fraction * 100).toFixed(0)} % of ${residue === STOP ? 'stops' : residue} in ${table.organism}; ${c.changes} ${c.changes === 1 ? 'base' : 'bases'} changed`}
                  onClick={() => {
                    onApply(c.codon);
                  }}
                >
                  <code>{c.codon}</code> {(c.fraction * 100).toFixed(0)} %{i === 0 ? ' ★' : ''}
                </button>
              </li>
            ))}
          </ul>
          <p className="panel__note panel__note--quiet">
            Shares are of {residue === STOP ? 'the stops' : `this residue's codons`} in{' '}
            {table.cds.toLocaleString()} {table.organism} genes. ★ is the one it uses most; pick
            another to change fewer bases.
          </p>
        </>
      )}
      <label className="panel__field panel__field--row">
        <span>Library</span>
        <select
          className="panel__select"
          aria-label="Degenerate codon"
          title="A saturation library at this codon, ordered as one degenerate oligo"
          value={library}
          onChange={(e) => {
            setLibrary(e.target.value);
            setResidue('');
            if (e.target.value !== '') onApply(e.target.value);
          }}
        >
          <option value="">none</option>
          {DEGENERATE_CODONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {coverage !== null && (
        <p className="panel__note panel__note--quiet">
          {library}: {coverage.codons} codons for {coverage.aminoAcids.size} amino acids
          {coverage.stops === 0
            ? ' and no stop'
            : `, ${coverage.stops === 1 ? 'one stop' : `${coverage.stops} stops`}`}
          . Screen about {coverage.screen95.toLocaleString()} colonies to be 95 % sure of any one
          codon.
        </p>
      )}
    </div>
  );
}

/**
 * Site-directed mutagenesis (#61): the selection is what changes, the box
 * says what it becomes, and the panel designs the two primers and opens the
 * plasmid they make. Like PCR it is about the document in front of you.
 */
export function MutagenesisPanel({ doc }: { readonly doc: SeqDocument }) {
  const { selection, documentId } = useEditorState();
  // Remembered per document, like PCR's primers (#32).
  const [change, setChange] = useRemembered('mutagenesis.change', documentId, '');
  const [method, setMethod] = useRemembered<MutagenesisMethod>(
    'mutagenesis.method',
    documentId,
    'back-to-back',
  );
  // The host whose codon usage orders the codons (#69), kept per document
  // like the rest: a plasmid is expressed in one host from one week to the next.
  const [host, setHost] = useRemembered(
    'mutagenesis.host',
    documentId,
    CODON_USAGE_TABLES[0]?.id ?? '',
  );
  const bases = change.toUpperCase().replace(/[^ACGTRYKMSWBDHVN]/g, '');
  const insertion = selection !== null && isEmptyRange(selection);
  const current = selection === null || insertion ? '' : doc.subsequence(selection).toUpperCase();

  // The codon the change falls in, when the selection is inside one: then
  // the residue can be named instead of the bases (#69). A selection over
  // more than the one codon is a change to the bases, not to a residue.
  const codon = useMemo(() => {
    if (selection === null) return null;
    const site = codonSiteAt(doc, selection.start);
    if (site === null || selection.end - selection.start > 3) return null;
    if (isEmptyRange(selection)) return site;
    return codonSiteAt(doc, selection.end - 1)?.index === site.index ? site : null;
  }, [doc, selection]);

  /** A codon picked for the residue: select its bases and put them in the box. */
  const applyCodon = (newCodon: string): void => {
    if (codon === null) return;
    editorStore.setSelection(codon.span);
    editorStore.revealPosition(codon.span.start);
    setChange(codonOnForwardStrand(newCodon, codon.strand));
  };

  const design = useMemo(() => {
    if (selection === null) return null;
    if (insertion && bases === '') return null;
    if (!insertion && bases === current) return null;
    return designMutagenesis(doc, selection, bases, method);
  }, [doc, selection, insertion, bases, current, method]);

  const open = (): void => {
    if (design === null) return;
    analytics.track('cloning', 'mutagenesis', method);
    // The mutant opens as the template renamed, with the change as its one
    // edit: the edit marks show it and Undo takes it back. It carries what
    // it was made from, recorded for the mutant (#67).
    editorStore.openDocument(recordMutagenesis(doc, design, `${doc.name} ${design.label}`));
    editorStore.apply(design.edit);
    editorStore.setSidebarTab('features');
  };

  return (
    <>
      {selection === null ? (
        <p className="panel__note">
          Select the bases to change in {doc.name}, or put the cursor where new bases go.
        </p>
      ) : (
        <p className="panel__note">
          {insertion
            ? `Insert after base ${selection.start.toLocaleString()}.`
            : `Change ${(selection.end - selection.start).toLocaleString()} bp at ${(selection.start + 1).toLocaleString()}${current.length <= 12 ? ` (${current})` : ''}.`}
        </p>
      )}
      {codon !== null && (
        <CodonChange site={codon} host={host} setHost={setHost} onApply={applyCodon} />
      )}
      <div className="panel__controls">
        <label className="panel__field panel__field--stack">
          <span>{insertion ? 'Bases to insert' : 'Change to'}</span>
          <input
            className="panel__search"
            type="text"
            spellCheck={false}
            placeholder={insertion ? 'e.g. a tag' : 'leave empty to delete'}
            value={change}
            onChange={(e) => {
              setChange(e.target.value);
            }}
          />
        </label>
        <div className="segmented" role="group" aria-label="Primer design">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`segmented__button${method === m.value ? ' segmented__button--active' : ''}`}
              aria-pressed={method === m.value}
              title={m.title}
              onClick={() => {
                setMethod(m.value);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {design !== null && (
        <>
          <p className="panel__note">
            <strong>{design.label}</strong>
            {design.proteinChanges.length > 0 ? ` · ${design.proteinChanges.join('; ')}` : ''}
          </p>
          <ol className="pair-list" aria-label="Mutagenesis primers">
            <PrimerLine label="Forward" primer={design.forward} method={method} />
            <PrimerLine label="Reverse" primer={design.reverse} method={method} />
          </ol>
          {design.problem !== null && (
            <p className="panel__note panel__note--warn">{design.problem}</p>
          )}
          <p className="panel__note panel__note--quiet">
            {method === 'back-to-back'
              ? `Upper case is new; the rest anneals. Amplify the whole plasmid${design.annealAt === null ? '' : `, annealing at ${design.annealAt} °C (NEB's for Q5)`}, then phosphorylate, ligate and digest the template (KLD).`
              : 'Upper case is new, in the middle of both primers. Copy the plasmid round, digest the template with DpnI, and transform.'}
          </p>
          <div className="panel__controls">
            <div className="panel__buttons">
              <button
                type="button"
                className="button button--primary button--small"
                title="Open the plasmid with the change, as an edit you can see and undo"
                onClick={open}
              >
                Open mutant
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
