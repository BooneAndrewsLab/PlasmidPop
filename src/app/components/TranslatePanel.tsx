import { type ReactNode, useMemo } from 'react';

import {
  type FrameTranslation,
  type Range,
  type SeqDocument,
  STOP,
  frameLabel,
  isEmptyRange,
  translateSixFrames,
} from '@/core';

import { copyText } from '../clipboard';
import { downloadText } from '../saveFile';
import { rangeBounds, sixFrameFasta, sixFrameFileName } from '../sixFrameExport';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

/** The protein with stop codons marked so they stand out in a wall of letters. */
function highlightStops(protein: string): ReactNode[] {
  const out: ReactNode[] = [];
  let run = '';
  let key = 0;
  for (const aa of protein) {
    if (aa === STOP) {
      if (run !== '') out.push(run);
      out.push(
        <span key={key++} className="frame__stop" aria-label="stop">
          {STOP}
        </span>,
      );
      run = '';
    } else {
      run += aa;
    }
  }
  if (run !== '') out.push(run);
  return out;
}

function FrameRow({ frame }: { readonly frame: FrameTranslation }) {
  const label = frameLabel(frame.frame);
  const stops = frame.stops === 1 ? '1 stop' : `${frame.stops.toLocaleString()} stops`;
  return (
    <section className="frame" aria-label={`Frame ${label}`}>
      <h3 className="panel__heading frame__heading">
        <span
          className={`frame__label${frame.strand === 'reverse' ? ' frame__label--reverse' : ''}`}
        >
          {label}
        </span>
        <span className="panel__heading-note">
          {frame.protein.length.toLocaleString()} aa · {stops}
        </span>
        <button
          type="button"
          className="button button--small frame__copy"
          disabled={frame.protein === ''}
          onClick={() => {
            copyText(frame.protein);
          }}
        >
          Copy
        </button>
      </h3>
      {frame.protein === '' ? (
        <p className="panel__note">Fewer than three bases in this frame.</p>
      ) : (
        <p className="panel__protein frame__protein">{highlightStops(frame.protein)}</p>
      )}
    </section>
  );
}

/**
 * Six-frame translation of the selection, or of the whole sequence when
 * nothing is selected. Frames +1..+3 read the forward strand, −1..−3 the
 * reverse complement starting from the 3′ end of the selection.
 */
export function TranslatePanel({ doc }: Props) {
  const { selection } = useEditorState();
  const hasSelection = selection !== null && !isEmptyRange(selection);
  const start = hasSelection ? selection.start : 0;
  const end = hasSelection ? selection.end : doc.length;
  const range = useMemo((): Range => ({ start, end }), [start, end]);
  const dna = useMemo(() => doc.subsequence(range), [doc, range]);
  const frames = useMemo(() => translateSixFrames(dna), [dna]);
  const { from, to } = rangeBounds(range, doc.length);

  if (dna.length < 3) {
    return (
      <div className="panel">
        <p className="panel__note">
          {hasSelection
            ? 'Select at least three bases to translate them.'
            : 'Open or type a sequence of at least three bases to translate it.'}
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__controls">
        <span className="frame__range">
          {hasSelection ? 'Selection' : 'Whole sequence'}{' '}
          <span className="panel__heading-note">
            {from.toLocaleString()}–{to.toLocaleString()} · {dna.length.toLocaleString()} bp
          </span>
        </span>
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              downloadText(sixFrameFileName(doc, range), sixFrameFasta(doc, range, frames));
            }}
          >
            Export FASTA
          </button>
        </div>
      </div>
      {!hasSelection && (
        <p className="panel__note">
          Nothing is selected, so the whole sequence is translated. Select a range in the sequence
          view to translate just that part.
        </p>
      )}
      {frames.map((f) => (
        <FrameRow key={f.frame} frame={f} />
      ))}
    </div>
  );
}
