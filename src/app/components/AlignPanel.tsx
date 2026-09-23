import { analytics } from '../analytics';
import { useState } from 'react';

import {
  type Alignment,
  type AlignmentMode,
  type SeqDocument,
  isEmptyRange,
  normalizeSequenceInput,
} from '@/core';
import { parseSequenceFile } from '@/io';
import { analysisClient } from '@/workers/analysisClient';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

const BLOCK = 60;

/** Sequence text out of whatever the user pasted: raw bases, FASTA or GenBank. */
function extractSequence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('>') || trimmed.startsWith('LOCUS')) {
    const doc = parseSequenceFile(trimmed).documents[0];
    return doc === undefined ? '' : doc.sequence.toString();
  }
  return normalizeSequenceInput(trimmed);
}

function AlignmentBlocks({
  alignment,
  offsetA,
  offsetB,
}: {
  alignment: Alignment;
  offsetA: number;
  offsetB: number;
}) {
  const blocks: { a: string; m: string; b: string; posA: number; posB: number }[] = [];
  let posA = alignment.startA + offsetA;
  let posB = alignment.startB + offsetB;
  for (let i = 0; i < alignment.columns; i += BLOCK) {
    const a = alignment.alignedA.slice(i, i + BLOCK);
    const b = alignment.alignedB.slice(i, i + BLOCK);
    blocks.push({ a, m: alignment.matchLine.slice(i, i + BLOCK), b, posA, posB });
    posA += a.replace(/-/g, '').length;
    posB += b.replace(/-/g, '').length;
  }
  return (
    <pre className="alignment">
      {blocks.map((blk) => (
        <div key={`${blk.posA}-${blk.posB}`} className="alignment__block">
          {`${String(blk.posA + 1).padStart(7)} ${blk.a}\n${' '.repeat(8)}${blk.m}\n${String(blk.posB + 1).padStart(7)} ${blk.b}\n`}
        </div>
      ))}
    </pre>
  );
}

export function AlignPanel({ doc }: Props) {
  const { selection } = useEditorState();
  const [other, setOther] = useState('');
  const [mode, setMode] = useState<AlignmentMode>('global');
  const [useSelection, setUseSelection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    alignment: Alignment;
    strand: 'forward' | 'reverse';
    offset: number;
    lengthB: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasSelection = selection !== null && !isEmptyRange(selection);

  const run = (): void => {
    let b: string;
    try {
      b = extractSequence(other);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (b === '') {
      setError('Paste the sequence to align against this document.');
      return;
    }
    const target =
      useSelection && selection !== null && hasSelection
        ? selection
        : { start: 0, end: doc.length };
    const a = doc.subsequence(target);
    analytics.track('align', 'run', mode);
    setBusy(true);
    setError(null);
    analysisClient
      .alignEitherStrand(a, b, { mode })
      .then((best) => {
        setResult({ ...best, offset: target.start, lengthB: b.length });
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="panel">
      <p className="panel__note">
        Align another sequence to {useSelection && hasSelection ? 'the selection' : doc.name}. Both
        orientations are tried and the better one is shown.
      </p>
      <textarea
        className="panel__textarea"
        rows={5}
        spellCheck={false}
        placeholder="Paste bases, FASTA or GenBank"
        aria-label="Sequence to align"
        value={other}
        onChange={(e) => {
          setOther(e.target.value);
        }}
      />
      <div className="panel__controls">
        <label className="panel__field">
          <select
            className="panel__select"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as AlignmentMode);
            }}
          >
            <option value="global">Global (end to end)</option>
            <option value="local">Local (best region)</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={useSelection && hasSelection}
            disabled={!hasSelection}
            onChange={(e) => {
              setUseSelection(e.target.checked);
            }}
          />
          Against selection only
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={busy || other.trim() === ''}
          onClick={run}
        >
          {busy ? 'Aligning…' : 'Align'}
        </button>
      </div>
      {error !== null && <p className="panel__error">{error}</p>}
      {result !== null && (
        <div className="panel__section">
          <h3 className="panel__heading">
            {result.alignment.mode === 'global' ? 'Global alignment' : 'Local alignment'}
            <span className="panel__heading-note">
              score {result.alignment.score}, identity {Math.round(result.alignment.identity * 100)}
              % over {result.alignment.columns.toLocaleString()} columns, {result.alignment.gaps}{' '}
              gap {result.alignment.gaps === 1 ? 'column' : 'columns'}
              {result.strand === 'reverse' ? ', reverse complement of the pasted sequence' : ''}
            </span>
          </h3>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => {
              const start = result.offset + result.alignment.startA;
              const end = result.offset + result.alignment.endA;
              if (end > start) {
                editorStore.setSelection({ start, end });
                editorStore.revealPosition(start);
              }
            }}
          >
            Select aligned region in this document
          </button>
          <AlignmentBlocks alignment={result.alignment} offsetA={result.offset} offsetB={0} />
        </div>
      )}
    </div>
  );
}
