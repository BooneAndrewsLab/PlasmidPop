import { useMemo, useState } from 'react';

import { type Assembly } from '@/core';

import { analytics } from '../analytics';
import { consensusDocument } from '../consensusDocument';
import { editorStore } from '../state/editorStore';

/** Disagreements listed before the rest are summarised. */
const LISTED = 50;
const LAYOUT_WIDTH = 1000;
const ROW_HEIGHT = 6;

/**
 * Reads assembled into contigs (#208): for the contig picked, the reads laid
 * along the consensus (a bar each, turned-over reads paler) with the
 * disagreements marked above them, the disagreements listed, and the
 * consensus saved as a document of its own.
 */
export function AssemblyResult({
  assembly,
  readNames,
}: {
  assembly: Assembly;
  /** The names of the reads as given, by index. */
  readNames: readonly string[];
}) {
  const [picked, setPicked] = useState(0);
  const contig = assembly.contigs[Math.min(picked, assembly.contigs.length - 1)];
  const total = assembly.contigs.reduce((n, c) => n + c.reads.length, 0);
  const name = (i: number): string => readNames[i] ?? `read ${i + 1}`;
  const stats = useMemo(() => {
    if (contig === undefined) return null;
    const mean = contig.depth.reduce((a, b) => a + b, 0) / Math.max(1, contig.depth.length);
    return { mean: Math.round(mean * 10) / 10, single: contig.depth.filter((d) => d < 2).length };
  }, [contig]);
  if (contig === undefined || stats === null) {
    return (
      <p className="panel__note">
        {assembly.skipped.length > 0
          ? 'No read had anything left to assemble after trimming.'
          : 'Nothing to assemble.'}
      </p>
    );
  }
  const length = Math.max(1, contig.consensus.length);
  const x = (p: number): number => (p / length) * LAYOUT_WIDTH;
  const height = contig.reads.length * ROW_HEIGHT + 12;
  const fileName = `${name(contig.reads[0]?.index ?? 0)} consensus`;
  return (
    <div className="panel__section assembly">
      <h3 className="panel__heading">
        {total} {total === 1 ? 'read' : 'reads'} in {assembly.contigs.length}{' '}
        {assembly.contigs.length === 1 ? 'contig' : 'contigs'}
        {assembly.skipped.length > 0 && (
          <span className="panel__heading-note">{assembly.skipped.length} left out</span>
        )}
      </h3>
      {assembly.contigs.length > 1 && (
        <label className="panel__field panel__field--row">
          <select
            className="panel__select"
            aria-label="Contig"
            value={picked}
            onChange={(e) => {
              setPicked(Number(e.target.value));
            }}
          >
            {assembly.contigs.map((c, i) => (
              <option key={i} value={i}>
                Contig {i + 1}: {c.consensus.length.toLocaleString()} bp, {c.reads.length}{' '}
                {c.reads.length === 1 ? 'read' : 'reads'}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="panel__note">
        {`${contig.consensus.length.toLocaleString()} bp from ${contig.reads.length} ${contig.reads.length === 1 ? 'read' : 'reads'}, ${stats.mean}× deep on average`}
        {stats.single > 0 ? `; ${stats.single.toLocaleString()} bp covered by one read only` : ''}
        {assembly.hasQualities
          ? ''
          : '. The reads had no qualities, so each base counts as Q20 and the call qualities are only a model.'}
      </p>
      <svg
        className="assembly__layout"
        viewBox={`0 0 ${LAYOUT_WIDTH} ${height}`}
        role="img"
        aria-label={`Layout of ${contig.reads.length} reads along the consensus, with ${contig.disagreements.length} disagreements marked`}
        preserveAspectRatio="none"
        style={{ height: Math.min(height, 160) }}
      >
        {contig.reads.map((r, i) => (
          <rect
            key={r.index}
            className={`assembly__read${r.strand === 'reverse' ? ' assembly__read--reverse' : ''}`}
            x={x(r.start)}
            y={12 + i * ROW_HEIGHT}
            width={Math.max(1, x(r.end) - x(r.start))}
            height={ROW_HEIGHT - 2}
          >
            <title>{`${r.name}${r.strand === 'reverse' ? ', reversed' : ''}: ${r.start + 1}–${r.end}`}</title>
          </rect>
        ))}
        {contig.disagreements.map((d) => (
          <rect
            key={d.position}
            className="assembly__flag"
            x={x(d.position)}
            y={0}
            width={Math.max(2, LAYOUT_WIDTH / length)}
            height={height}
          />
        ))}
      </svg>
      <p className="panel__note panel__note--quiet">
        Bars are the reads along the consensus; paler ones were turned over. Red marks are
        disagreements.
      </p>
      {contig.disagreements.length === 0 ? (
        <p className="panel__note">The reads agree wherever they overlap.</p>
      ) : (
        <>
          <p className="panel__note">
            {`${contig.disagreements.length} ${contig.disagreements.length === 1 ? 'disagreement' : 'disagreements'}: an ambiguity code where equally confident reads differ, or a base a confident read calls differently (Q20+).`}
          </p>
          <ul className="assembly__list">
            {contig.disagreements.slice(0, LISTED).map((d) => (
              <li key={d.position}>
                <strong>
                  {(d.position + 1).toLocaleString()}: {d.call}
                </strong>{' '}
                Q{d.quality}
                {d.ambiguous ? ' (ambiguous)' : ''}
                <span className="read-batch__sub">
                  {d.votes
                    .map(
                      (v) =>
                        `${name(v.read)} ${v.base === '-' ? 'gap' : v.base} Q${Math.round(v.quality)}`,
                    )
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
          {contig.disagreements.length > LISTED && (
            <p className="panel__note panel__note--quiet">{`The first ${LISTED} are listed.`}</p>
          )}
        </>
      )}
      <button
        type="button"
        className="button button--primary button--small"
        title="Open the consensus as a new document; IUPAC codes stay where reads disagreed"
        onClick={() => {
          analytics.track('align', 'assemble-save');
          editorStore.openConsensus(consensusDocument(contig, fileName, assembly.hasQualities));
        }}
      >
        Save consensus as document
      </button>
    </div>
  );
}
