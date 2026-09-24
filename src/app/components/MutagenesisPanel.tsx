import { useMemo } from 'react';

import {
  type MutagenesisMethod,
  type MutagenesisPrimer,
  type SeqDocument,
  designMutagenesis,
  isEmptyRange,
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
  const bases = change.toUpperCase().replace(/[^ACGTRYKMSWBDHVN]/g, '');
  const insertion = selection !== null && isEmptyRange(selection);
  const current = selection === null || insertion ? '' : doc.subsequence(selection).toUpperCase();

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
    // edit: the edit marks show it and Undo takes it back.
    editorStore.openDocument(doc.rename(`${doc.name} ${design.label}`));
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
              ? 'Upper case is new; the rest anneals. Amplify the whole plasmid, then phosphorylate, ligate and digest the template (KLD).'
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
