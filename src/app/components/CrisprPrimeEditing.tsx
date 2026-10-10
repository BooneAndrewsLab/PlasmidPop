import { useState } from 'react';

import {
  type CrisprGuide,
  type Nuclease,
  type PegRna,
  type SeqDocument,
  DEFAULT_PBS,
  MAX_PBS,
  MAX_NICK_DISTANCE,
  MIN_PBS,
  designPegRnas,
  formatSpan,
  isEmptyRange,
  primeEditProblem,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
  readonly guides: readonly CrisprGuide[];
  readonly nuclease: Nuclease;
}

/** How many pegRNAs are listed; the nearest nicks are the useful ones. */
const MAX_LISTED = 20;

/**
 * pegRNA design for one edit (item 81): where, how many bases it replaces
 * and with what, then the pegRNAs on the guides found above whose nick is
 * close enough, nearest first.
 */
export function PrimeEditing({ doc, guides, nuclease }: Props) {
  const { selection } = useEditorState();
  const [position, setPosition] = useState('');
  const [replace, setReplace] = useState('1');
  const [insert, setInsert] = useState('');
  const [pbs, setPbs] = useState(String(DEFAULT_PBS));
  const [copied, setCopied] = useState<string | null>(null);

  const start = Number.parseInt(position, 10) - 1;
  const deleteLength = Number.parseInt(replace, 10);
  const text = insert.trim().toUpperCase();
  const pbsLength = Number.parseInt(pbs, 10);
  const asked = position.trim() !== '';
  const problem = !asked
    ? null
    : Number.isNaN(start) || Number.isNaN(deleteLength)
      ? 'Enter a position and how many bases to replace.'
      : primeEditProblem({ start, deleteLength, insert: text }, doc.length, doc.topology);
  const pegs: readonly PegRna[] =
    !asked || problem !== null
      ? []
      : designPegRnas(
          doc.sequence.toString(),
          doc.topology,
          guides,
          nuclease,
          { start, deleteLength, insert: text },
          Number.isNaN(pbsLength) ? {} : { pbsLength },
        );

  return (
    <fieldset className="panel__group">
      <legend>Prime editing</legend>
      <div className="panel__controls">
        <label className="panel__field panel__field--row">
          <span>Edit at</span>
          <input
            className="panel__number"
            type="number"
            min={1}
            max={doc.length}
            value={position}
            onChange={(e) => {
              setPosition(e.target.value);
            }}
          />
        </label>
        <label className="panel__field panel__field--row">
          <span>Replace (bases)</span>
          <input
            className="panel__number"
            type="number"
            min={0}
            value={replace}
            onChange={(e) => {
              setReplace(e.target.value);
            }}
          />
        </label>
        <label className="panel__field panel__field--row">
          <span>With</span>
          <input
            className="panel__mono-input"
            value={insert}
            spellCheck={false}
            placeholder="ACGT, or nothing to delete"
            aria-label="New bases"
            onChange={(e) => {
              setInsert(e.target.value);
            }}
          />
        </label>
        <label className="panel__field panel__field--row">
          <span>PBS (nt)</span>
          <input
            className="panel__number"
            type="number"
            min={MIN_PBS}
            max={MAX_PBS}
            value={pbs}
            onChange={(e) => {
              setPbs(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={selection === null}
          title="Take the position and length from the selection"
          onClick={() => {
            if (selection === null) return;
            setPosition(String(selection.start + 1));
            setReplace(
              String(
                isEmptyRange(selection)
                  ? 0
                  : (selection.end - selection.start + doc.length) % doc.length || doc.length,
              ),
            );
          }}
        >
          Use the selection
        </button>
      </div>
      {!asked && (
        <p className="panel__note">
          Give the position of the edit, how many bases it replaces and what goes in. pegRNAs are
          listed for guides whose nick is up to {MAX_NICK_DISTANCE} bases before it.
        </p>
      )}
      {problem !== null && <p className="panel__note panel__note--warn">{problem}</p>}
      {asked && problem === null && pegs.length === 0 && (
        <p className="panel__note">
          No guide above nicks within {MAX_NICK_DISTANCE} bases upstream of the edit.
        </p>
      )}
      {pegs.slice(0, MAX_LISTED).map((p) => {
        const id = `${p.guide.strand}:${String(p.guide.range.start)}`;
        return (
          <div key={id} className="crispr-peg">
            <dl className="crispr-detail">
              <dt>Guide</dt>
              <dd className="crispr-detail__mono">
                {p.guide.spacer} {p.guide.pam} ({p.guide.strand})
              </dd>
              <dt>Nick</dt>
              <dd>
                after base {p.nick.toLocaleString()}, {p.distance.toLocaleString()} before the edit
              </dd>
              <dt>PBS</dt>
              <dd className="crispr-peg__seq">{p.pbs}</dd>
              <dt>RT template</dt>
              <dd className="crispr-peg__seq">{p.rtt}</dd>
              <dt>3′ extension</dt>
              <dd className="crispr-peg__seq">{p.extension}</dd>
              <dt>PAM</dt>
              <dd>{p.disruptsPam ? 'changed by the edit' : 'unchanged'}</dd>
              {p.flags.length > 0 && (
                <>
                  <dt>Flags</dt>
                  <dd className="crispr-detail__flags">{p.flags.join('; ')}</dd>
                </>
              )}
            </dl>
            <div className="crispr-actions">
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  analytics.track('crispr', 'pegrna');
                  copyText(`${p.guide.spacer}\n${p.extension}`);
                  setCopied(id);
                }}
              >
                Copy spacer and extension
              </button>
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => {
                  editorStore.setSelection(p.guide.range);
                  editorStore.revealPosition(p.guide.range.start);
                }}
              >
                Show {formatSpan(p.guide.range, doc.length)}
              </button>
            </div>
            {copied === id && <p className="panel__note">Copied.</p>}
          </div>
        );
      })}
      {pegs.length > MAX_LISTED && (
        <p className="panel__note">
          Showing the nearest {MAX_LISTED} of {pegs.length.toLocaleString()}.
        </p>
      )}
    </fieldset>
  );
}
