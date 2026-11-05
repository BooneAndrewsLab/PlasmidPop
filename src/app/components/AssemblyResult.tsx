import { useMemo, useState } from 'react';

import { type Assembly, type ContigWarning, type PairReport } from '@/core';

import { analytics } from '../analytics';
import { consensusDocument } from '../consensusDocument';
import { editorStore } from '../state/editorStore';

/** Whether a warning is about the read pairs rather than a repeat (#347). */
const isPairWarning = (w: ContigWarning): boolean =>
  w.kind === 'pair-distance' || w.kind === 'pair-orientation';

/** "976 bp", or "976 to 988 bp" for a spread. */
function span(values: readonly number[]): string {
  const lo = values[0];
  const hi = values[values.length - 1];
  if (lo === undefined || hi === undefined) return '';
  return lo === hi
    ? `${lo.toLocaleString()} bp`
    : `${lo.toLocaleString()} to ${hi.toLocaleString()} bp`;
}

/** What the pairs did, in a line: how many fit, link contigs, or do not. */
function pairLine(p: PairReport): string {
  const count = (state: (c: PairReport['checks'][number]) => boolean): number =>
    p.checks.filter(state).length;
  const fit = count((c) => c.state === 'consistent' || c.state === 'spans-ends');
  const linked = count((c) => c.state === 'linked');
  const unplaced = count((c) => c.state === 'unplaced');
  const bad = p.checks.length - fit - linked - unplaced;
  const parts = [
    fit > 0
      ? `${fit} face each other in a contig${p.insert === null ? '' : ' at the insert size'}`
      : '',
    linked > 0 ? `${linked} join two contigs` : '',
    unplaced > 0 ? `${unplaced} ${unplaced === 1 ? 'has' : 'have'} a mate left out` : '',
    bad > 0 ? `${bad} ${bad === 1 ? 'does' : 'do'} not fit` : '',
  ].filter((x) => x !== '');
  return `${p.checks.length} read ${p.checks.length === 1 ? 'pair' : 'pairs'}: ${parts.join(', ')}.`;
}

/** The gap of a link as words: the bases between the contigs, or how far they overlap. */
function gapText(gap: number | null): string {
  if (gap === null) return '';
  if (gap >= 0) return `, about ${gap.toLocaleString()} bp between them`;
  return `, overlapping by about ${(-gap).toLocaleString()} bp`;
}

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
  reference = null,
}: {
  assembly: Assembly;
  /** The names of the reads as given, by index. */
  readNames: readonly string[];
  /**
   * What the repeat warning offers as the way out (#347): the reads aligned
   * to the open document, which is the reference. `null` when none is open,
   * and the warning then says to open one.
   */
  reference?: {
    readonly name: string;
    readonly busy: boolean;
    readonly onAlign: () => void;
  } | null;
}) {
  const [picked, setPicked] = useState(0);
  const { pairing } = assembly;
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
                {c.warnings.some((w) => !isPairWarning(w)) ? ', repeat warning' : ''}
                {c.warnings.some(isPairWarning) ? ', read pair warning' : ''}
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
      {contig.warnings.length > 0 && (
        <>
          {contig.warnings.some((w) => !isPairWarning(w)) && (
            <p className="panel__note panel__note--warn">
              A repeat may have fooled the assembly: reads cannot say which copy of a repeat they
              came from, so the layout here may be wrong.
            </p>
          )}
          {contig.warnings.some(isPairWarning) && (
            <p className="panel__note panel__note--warn">
              Read pairs do not fit this layout: two mates lie where one template cannot have both
              ends, so a stretch may be missing or doubled, or a read may be on the wrong copy of a
              repeat.
            </p>
          )}
          <ul className="panel__warnings" aria-label="Contig warnings">
            {contig.warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          {reference === null ? (
            <p className="panel__note">
              To place the reads that reach out of the repeat, open the plasmid or reference they
              came from and align them to it.
            </p>
          ) : (
            <p className="panel__controls">
              <button
                type="button"
                className="button button--small"
                disabled={reference.busy}
                data-tip="Align every read to the open document instead: reads that reach out of a repeat are placed by their flank; reads wholly inside it stay ambiguous"
                onClick={() => {
                  analytics.track('align', 'assemble-to-reference');
                  reference.onAlign();
                }}
              >
                {`Align these reads to ${reference.name}`}
              </button>
            </p>
          )}
        </>
      )}
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
        {contig.warnings.map((w, i) => (
          <rect
            key={`w${i}`}
            className="assembly__warned"
            x={x(w.start)}
            y={0}
            width={Math.max(2, x(w.end) - x(w.start))}
            height={height}
          >
            <title>{w.message}</title>
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
        disagreements
        {contig.warnings.length > 0
          ? contig.warnings.some(isPairWarning)
            ? '; the shaded stretches are warnings'
            : '; the shaded stretches are repeat warnings'
          : ''}
        .
      </p>
      {pairing !== undefined && (
        <div className="assembly__pairs">
          <p className="panel__note">{pairLine(pairing)}</p>
          {pairing.insert === null && pairing.templates.length > 0 && (
            <p className="panel__note panel__note--quiet">
              {`Mates that face each other in a contig are ${span(pairing.templates)} apart; enter the insert size to have them checked.`}
            </p>
          )}
          {pairing.links.length > 0 && (
            <ul className="panel__warnings" aria-label="Contigs the pairs link">
              {pairing.links.map((l, i) => (
                <li key={i}>
                  {`Contig ${l.from.contig + 1}${l.from.reversed ? ' (turned over)' : ''} then contig ${l.to.contig + 1}${l.to.reversed ? ' (turned over)' : ''}: ${l.pairs} ${l.pairs === 1 ? 'pair' : 'pairs'}${gapText(l.gap)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
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
        data-tip="Open the consensus as a new document; IUPAC codes stay where reads disagreed"
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
