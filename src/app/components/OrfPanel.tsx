import { useState } from 'react';

import {
  type Orf,
  type SeqDocument,
  createFeature,
  isEmptyRange,
  rangeSegment,
  reverseComplement,
  translate,
} from '@/core';

import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

function orfLabel(orf: Orf, seqLength: number): string {
  const from = orf.range.start + 1;
  const to = ((orf.range.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

function orfSequence(doc: SeqDocument, orf: Orf): string {
  const text = doc.subsequence(orf.range);
  return orf.strand === 'reverse' ? reverseComplement(text) : text;
}

export function OrfPanel({ doc }: Props) {
  const { analysis, orfMinCodons, selection } = useEditorState();
  const [pending, setPending] = useState(String(orfMinCodons));
  const ready = analysis !== null && analysis.doc === doc;
  const orfs = ready ? analysis.orfs : [];

  const selectedOrf = orfs.find(
    (o) => selection !== null && o.range.start === selection.start && o.range.end === selection.end,
  );
  const selectionText =
    selection !== null && !isEmptyRange(selection) && selectedOrf === undefined
      ? doc.subsequence(selection)
      : null;
  const protein =
    selectedOrf !== undefined
      ? translate(orfSequence(doc, selectedOrf), { firstCodonAsMet: true })
      : selectionText !== null && selectionText.length >= 3
        ? translate(selectionText)
        : null;

  const commitMin = (): void => {
    const n = Number.parseInt(pending, 10);
    if (Number.isFinite(n) && n > 0) editorStore.setOrfMinCodons(n);
    else setPending(String(orfMinCodons));
  };

  return (
    <div className="panel">
      <div className="panel__controls">
        <label className="panel__field">
          Minimum length
          <input
            className="panel__number"
            type="number"
            min={1}
            value={pending}
            onChange={(e) => {
              setPending(e.target.value);
            }}
            onBlur={commitMin}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMin();
            }}
          />
          codons
        </label>
      </div>
      {!ready ? (
        <p className="panel__note">Looking for open reading frames…</p>
      ) : orfs.length === 0 ? (
        <p className="panel__note">
          No ORFs of at least {orfMinCodons} codons. Lower the minimum to see shorter ones.
        </p>
      ) : (
        <ul className="orf-list">
          {orfs.map((orf) => {
            const active = orf === selectedOrf;
            return (
              <li key={`${orf.strand}-${orf.range.start}-${orf.range.end}`}>
                <button
                  type="button"
                  className={`orf-row${active ? ' orf-row--selected' : ''}`}
                  onClick={() => {
                    editorStore.setSelection(orf.range);
                    editorStore.revealPosition(orf.range.start);
                  }}
                >
                  <span
                    className="orf-row__strand"
                    aria-label={orf.strand === 'forward' ? 'forward strand' : 'reverse strand'}
                  >
                    {orf.strand === 'forward' ? '→' : '←'}
                  </span>
                  <span className="orf-row__range">{orfLabel(orf, doc.length)}</span>
                  <span className="orf-row__length">{orf.codons.toLocaleString()} aa</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {protein !== null && (
        <div className="panel__section">
          <h3 className="panel__heading">
            {selectedOrf !== undefined ? 'ORF translation' : 'Translation of selection'}
            <span className="panel__heading-note">{protein.replace(/\*$/, '').length} aa</span>
          </h3>
          <p className="panel__protein">{protein}</p>
          <div className="panel__buttons">
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                copyText(protein);
              }}
            >
              Copy protein
            </button>
            {selectedOrf !== undefined && (
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  const feature = createFeature({
                    type: 'CDS',
                    name: 'ORF',
                    strand: selectedOrf.strand,
                    segments: [rangeSegment(selectedOrf.range.start, selectedOrf.range.end)],
                    qualifiers: [
                      { name: 'codon_start', value: '1' },
                      { name: 'translation', value: protein.replace(/\*$/, '') },
                    ],
                  });
                  editorStore.apply({ type: 'addFeature', feature }, selectedOrf.range);
                  editorStore.requestRename(feature.id);
                  editorStore.setSidebarTab('features');
                }}
              >
                Add as CDS feature
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
