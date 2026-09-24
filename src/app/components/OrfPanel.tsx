import { useEffect, useMemo, useRef, useState } from 'react';

import {
  type Orf,
  type SeqDocument,
  DEFAULT_TABLE,
  createFeature,
  isEmptyRange,
  rangeSegment,
  reverseComplement,
  translate,
} from '@/core';

import { type OverlaySpan } from '@/view/overlay';

import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { GeneticCodeSelect } from './GeneticCodeSelect';

interface Props {
  readonly doc: SeqDocument;
}

function orfLabel(orf: Orf, seqLength: number): string {
  const from = orf.range.start + 1;
  const to = ((orf.range.end - 1) % Math.max(1, seqLength)) + 1;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

/** An ORF's id on the views, which a click on it is reported by. */
function orfId(orf: Orf): string {
  return `${orf.strand}:${String(orf.range.start)}-${String(orf.range.end)}`;
}

/**
 * Past this many ORFs the views are shown none of them, as Find does: the
 * list is the useful answer, and the arrows would only be a texture.
 */
const MAX_PREVIEWED_ORFS = 200;

/** The same empty list each render while the scan runs, so the preview is not rebuilt for it. */
const NO_ORFS: readonly Orf[] = [];

function orfSequence(doc: SeqDocument, orf: Orf): string {
  const text = doc.subsequence(orf.range);
  return orf.strand === 'reverse' ? reverseComplement(text) : text;
}

export function OrfPanel({ doc }: Props) {
  const {
    analysis,
    orfMinCodons,
    selection,
    geneticCode: table,
    previewActivated: activated,
  } = useEditorState();
  const [pending, setPending] = useState(String(orfMinCodons));
  const ready = analysis !== null && analysis.doc === doc;
  const orfs = ready ? analysis.orfs : NO_ORFS;

  // Every ORF listed is drawn on both views while the tab is open (#32), an
  // arrow on its own strand, and a click on one selects it as its row does.
  const previewed = useMemo<OverlaySpan[]>(
    () =>
      orfs.length > MAX_PREVIEWED_ORFS
        ? []
        : orfs.map((orf) => ({
            id: orfId(orf),
            label: `${orf.codons.toLocaleString()} aa`,
            range: orf.range,
            strand: orf.strand,
            shape: 'arrow',
            clickable: true,
          })),
    [orfs],
  );
  useEffect(() => {
    editorStore.setPreview('orfs', previewed);
  }, [previewed]);
  useEffect(
    () => () => {
      editorStore.clearPreview('orfs');
    },
    [],
  );
  // Seeded with the click standing at mount, as the digest's is, so one
  // answered before the tab was last left is not answered again.
  const handledClick = useRef(activated?.nonce ?? 0);
  useEffect(() => {
    if (activated?.owner !== 'orfs' || activated.nonce === handledClick.current) return;
    handledClick.current = activated.nonce;
    const orf = orfs.find((o) => orfId(o) === activated.id);
    if (orf === undefined) return;
    editorStore.setSelection(orf.range);
    editorStore.revealPosition(orf.range.start);
  }, [activated, orfs]);

  const selectedOrf = orfs.find(
    (o) => selection !== null && o.range.start === selection.start && o.range.end === selection.end,
  );
  const selectionText =
    selection !== null && !isEmptyRange(selection) && selectedOrf === undefined
      ? doc.subsequence(selection)
      : null;
  const protein =
    selectedOrf !== undefined
      ? translate(orfSequence(doc, selectedOrf), { firstCodonAsMet: true, table })
      : selectionText !== null && selectionText.length >= 3
        ? translate(selectionText, { table })
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
        <GeneticCodeSelect title="The genetic code the scan reads with: it decides where an ORF ends as well as where it may begin." />
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
                      // Only when it is not the standard code: a CDS with no
                      // /transl_table means table 1, and writing it out on
                      // every feature would be noise in the file.
                      ...(table === DEFAULT_TABLE
                        ? []
                        : [{ name: 'transl_table', value: String(table) }]),
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
