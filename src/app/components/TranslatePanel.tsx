import { type ReactNode, useMemo } from 'react';

import {
  type FrameTranslation,
  type Range,
  type SeqDocument,
  STOP,
  frameLabel,
  cdsName,
  featureExtent,
  formatLocation,
  isCodingFeature,
  isEmptyRange,
  proteinFromCds,
  proteinFromTranslation,
  rangesOverlap,
  translateSixFrames,
} from '@/core';

import { copyText } from '../clipboard';
import { downloadText } from '../saveFile';
import { rangeBounds, sixFrameFasta, sixFrameFileName } from '../sixFrameExport';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { GeneticCodeSelect } from './GeneticCodeSelect';

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

interface FrameRowProps {
  readonly frame: FrameTranslation;
  /** Opens the frame's protein in a tab of its own (#66). */
  readonly onOpen: () => void;
}

function FrameRow({ frame, onOpen }: FrameRowProps) {
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
        <span className="frame__actions">
          <button
            type="button"
            className="button button--small"
            disabled={frame.protein === ''}
            title={`Open frame ${label} as a protein document of its own, stops and all`}
            onClick={onOpen}
          >
            Open as protein
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={frame.protein === ''}
            onClick={() => {
              copyText(frame.protein);
            }}
          >
            Copy
          </button>
        </span>
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
  const { selection, geneticCode: table } = useEditorState();
  const hasSelection = selection !== null && !isEmptyRange(selection);
  const start = hasSelection ? selection.start : 0;
  const end = hasSelection ? selection.end : doc.length;
  const range = useMemo((): Range => ({ start, end }), [start, end]);
  const dna = useMemo(() => doc.subsequence(range), [doc, range]);
  const frames = useMemo(() => translateSixFrames(dna, { table }), [dna, table]);
  const { from, to } = rangeBounds(range, doc.length);
  // The CDS features the selection reaches, or all of them: each can be
  // opened as the protein it codes for (#66).
  const coding = useMemo(
    () =>
      doc.features.all().filter((f) => {
        if (!isCodingFeature(f)) return false;
        const extent = featureExtent(f);
        return !hasSelection || (extent !== null && rangesOverlap(extent, range, doc.length));
      }),
    [doc, hasSelection, range],
  );

  const codingList = coding.length > 0 && (
    <section aria-label="Coding features">
      <h3 className="panel__heading">
        CDS features
        <span className="panel__heading-note">
          {hasSelection ? 'in the selection' : 'in the sequence'}
        </span>
      </h3>
      <ul className="coding-list">
        {coding.map((f) => {
          const name = cdsName(doc, f);
          return (
            <li key={f.id}>
              <span className="coding-list__name" title={name}>
                {name}
              </span>
              <span className="panel__heading-note">
                {formatLocation(f, doc.length, doc.topology)}
              </span>
              <button
                type="button"
                className="button button--small"
                title={`Translate ${name} with its own genetic code and open the protein in a tab of its own`}
                onClick={() => {
                  editorStore.openProtein(proteinFromCds(doc, f), 'cds');
                }}
              >
                Open as protein
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  if (dna.length < 3) {
    return (
      <div className="panel">
        {codingList}
        <p className="panel__note">
          {hasSelection
            ? 'Select at least three bases to translate them.'
            : 'Open or type a sequence of at least three bases to translate it.'}
        </p>
      </div>
    );
  }

  const openFrame = (f: FrameTranslation): void => {
    const label = frameLabel(f.frame);
    const ascii = f.frame > 0 ? `+${f.frame}` : `-${-f.frame}`;
    const where = `${from.toLocaleString()}–${to.toLocaleString()}`;
    editorStore.openProtein(
      proteinFromTranslation(
        doc,
        f.protein,
        `${doc.name}_${from}-${to}_${ascii}`,
        `frame ${label} of ${where}`,
        table,
      ),
      'frame',
    );
  };

  return (
    <div className="panel">
      <div className="panel__controls">
        <span className="frame__range">
          {hasSelection ? 'Selection' : 'Whole sequence'}{' '}
          <span className="panel__heading-note">
            {from.toLocaleString()}–{to.toLocaleString()} · {dna.length.toLocaleString()} bp
          </span>
        </span>
        <GeneticCodeSelect title="The genetic code these six frames are read with. A CDS feature is read with its own /transl_table instead." />
        <div className="panel__buttons">
          <button
            type="button"
            className="button button--small"
            onClick={() => {
              downloadText(sixFrameFileName(doc, range), sixFrameFasta(doc, range, frames, table));
            }}
          >
            Export FASTA
          </button>
        </div>
      </div>
      {codingList}
      {!hasSelection && (
        <p className="panel__note">
          Nothing is selected, so the whole sequence is translated. Select a range in the sequence
          view to translate just that part.
        </p>
      )}
      {frames.map((f) => (
        <FrameRow
          key={f.frame}
          frame={f}
          onOpen={() => {
            openFrame(f);
          }}
        />
      ))}
    </div>
  );
}
