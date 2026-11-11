import { useId, useMemo, useState } from 'react';

import {
  type PegRna,
  type SeqDocument,
  MAX_PBS,
  MAX_NICK_DISTANCE,
  MIN_PBS,
  formatSpan,
  isEmptyRange,
} from '@/core';

import { type OverlaySpan } from '@/view/overlay';

import { analytics } from '../analytics';
import { type PegEdit, updateCrisprSession, useCrisprSession } from '../crisprSession';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { type usePegRnas, pegId } from './crisprEditing';
import { guideId, useCrisprPreview } from './crisprScan';
import { useRowPicker } from './useRowPicker';
import { TableSpacer } from './TableSpacer';

/** Height assumed for a row not yet measured, in pixels: one line of text. */
const ROW_ESTIMATE = 28;

/** How much of a typed insert the edit's tick on the views spells out. */
const TICK_LABEL_BASES = 6;

interface DetailProps {
  readonly peg: PegRna;
  readonly doc: SeqDocument;
}

/**
 * The open pegRNA in full under the table: the guide and the nick, the PBS,
 * the RT template and the 3′ extension (template then PBS) as they are
 * ordered, each with **Copy**, and **Copy spacer and extension**, the pair of
 * lines the pegRNA is made from.
 */
function PegDetail({ peg: p, doc }: DetailProps) {
  const headId = useId();
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (what: string, text: string): void => {
    analytics.track('crispr', 'pegrna');
    copyText(text);
    setCopied(what);
  };
  const parts: readonly (readonly [string, string])[] = [
    ['PBS', p.pbs],
    ['RT template', p.rtt],
    ['3′ extension', p.extension],
  ];
  return (
    <aside className="detail" aria-labelledby={headId}>
      <div className="detail__head">
        <strong id={headId}>
          pegRNA for the guide at {(p.guide.range.start + 1).toLocaleString()} ({p.guide.strand})
        </strong>
        <span className="dnote panel__mono">
          {p.guide.spacer}
          {p.guide.pam}
        </span>
      </div>
      <dl className="crispr-detail">
        <dt>Protospacer</dt>
        <dd>{formatSpan(p.guide.range, doc.length)}</dd>
        <dt>Nick</dt>
        <dd>
          after base {p.nick.toLocaleString()}, {p.distance.toLocaleString()} before the edit
        </dd>
        <dt>PAM</dt>
        <dd>{p.disruptsPam ? 'changed by the edit' : 'unchanged'}</dd>
        {p.flags.length > 0 && (
          <>
            <dt>Flags</dt>
            <dd className="crispr-detail__flags">{p.flags.join('; ')}</dd>
          </>
        )}
      </dl>
      {parts.map(([label, seq]) => (
        <div key={label} className="crispr-peg__part">
          <span className="crispr-peg__label">{label}</span>
          <span className="crispr-peg__seq">{seq}</span>
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label={`Copy the ${label}`}
            onClick={() => {
              copy(label, seq);
            }}
          >
            Copy
          </button>
        </div>
      ))}
      <div className="crispr-actions">
        <button
          type="button"
          className="button button--small"
          data-tip="The spacer and the 3′ extension, one to a line, to order as a pegRNA's two parts"
          onClick={() => {
            copy('spacer and extension', `${p.guide.spacer}\n${p.extension}`);
          }}
        >
          Copy spacer and extension
        </button>
      </div>
      {copied !== null && <p className="panel__note">Copied the {copied}.</p>}
    </aside>
  );
}

interface Props {
  readonly doc: SeqDocument;
  /** What `usePegRnas` made of the scan and the form, which the rail's badge counts too. */
  readonly design: ReturnType<typeof usePegRnas>;
}

/**
 * The Prime page (items 81 and 133, C5): where the edit is, how many bases
 * it replaces and with what, across the top; under it the pegRNAs on the
 * guides found whose nick is close enough, nearest first, as a table. The
 * open row's parts are under the table, and the views carry the guides and a
 * tick where the edit goes.
 */
export function PrimeEditing({ doc, design }: Props) {
  const { selection, documentId } = useEditorState();
  const { pegs, pegEdit, asked, problem, edit } = design;
  const { position, replace, insert, pbs } = pegEdit;
  const { pegPicked } = useCrisprSession(documentId);
  const setEdit = (patch: Partial<PegEdit>): void => {
    updateCrisprSession(documentId, (s) => ({ pegEdit: { ...s.pegEdit, ...patch } }));
  };

  const keys = useMemo(() => pegs.map(pegId), [pegs]);
  const openIndex = pegPicked === null ? -1 : keys.indexOf(pegPicked);
  const open = openIndex >= 0 ? (pegs[openIndex] ?? null) : null;
  const choose = (index: number): void => {
    const p = pegs[index];
    if (p === undefined) return;
    updateCrisprSession(documentId, { pegPicked: pegId(p) });
    editorStore.setSelection(p.guide.range);
    editorStore.revealPosition(p.guide.range.start);
  };
  const clear = (): void => {
    updateCrisprSession(documentId, { pegPicked: null });
    editorStore.setSelection(null);
  };
  const { first, end, padTop, padBottom, attachScroller, attachRow, body, stop, onKeyDown } =
    useRowPicker(keys, open === null ? null : pegId(open), ROW_ESTIMATE, choose, clear);

  // The guides that could carry the edit, and a tick where it goes: the bases
  // it replaces, or the one after an insertion. A click on a guide opens its row.
  const previewed = useMemo<OverlaySpan[]>(() => {
    if (edit === null) return [];
    const at = Math.min(edit.start, doc.length - 1);
    const tick: OverlaySpan = {
      id: 'edit',
      label: edit.insert === '' ? 'edit' : edit.insert.slice(0, TICK_LABEL_BASES),
      range: { start: at, end: at + Math.max(1, edit.deleteLength) },
      strand: 'none',
      shape: 'arrow',
    };
    return [
      tick,
      ...pegs.map<OverlaySpan>((p) => ({
        id: guideId(p.guide),
        label: p.guide.pam,
        range: p.guide.range,
        strand: p.guide.strand,
        shape: 'arrow',
        clickable: true,
      })),
    ];
  }, [edit, pegs, doc.length]);
  useCrisprPreview(previewed, doc, (id) => {
    const at = pegs.findIndex((p) => guideId(p.guide) === id);
    if (at >= 0) choose(at);
  });

  return (
    <>
      <div className="panel__controls crispr-ws__settings" role="group" aria-label="Edit">
        <label className="panel__field panel__field--row">
          <span>Edit at</span>
          <input
            className="panel__number"
            type="number"
            min={1}
            max={doc.length}
            value={position}
            onChange={(e) => {
              setEdit({ position: e.target.value });
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
              setEdit({ replace: e.target.value });
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
              setEdit({ insert: e.target.value });
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
              setEdit({ pbs: e.target.value });
            }}
          />
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={selection === null}
          data-tip="Take the position and length from the selection"
          onClick={() => {
            if (selection === null) return;
            setEdit({
              position: String(selection.start + 1),
              replace: String(
                isEmptyRange(selection)
                  ? 0
                  : (selection.end - selection.start + doc.length) % doc.length || doc.length,
              ),
            });
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
        <p className="panel__note" role="status">
          None of the guides found nicks within {MAX_NICK_DISTANCE} bases upstream of the edit.
        </p>
      )}
      {pegs.length > 0 && (
        <>
          <div className="tablewrap crispr-ws__scroll" ref={attachScroller}>
            <table className="wst dt" role="grid" aria-label="pegRNAs">
              <thead>
                <tr>
                  <th
                    className="wst__th wst__n"
                    data-tip="Place in this list, the nearest nick first"
                  >
                    #
                  </th>
                  <th
                    className="wst__th"
                    data-tip="The guide: its direction, its spacer 5′→3′ and its PAM"
                  >
                    Guide
                  </th>
                  <th className="wst__th wst__n" data-tip="The nick falls after this base">
                    Nick
                  </th>
                  <th
                    className="wst__th wst__n"
                    data-tip="Bases from the nick to the first changed base, along the PAM strand"
                  >
                    Distance
                  </th>
                  <th className="wst__th" data-tip="The primer binding site, 5′→3′">
                    PBS
                  </th>
                  <th
                    className="wst__th"
                    data-tip="Whether the edit also changes the PAM, which stops the edited site being nicked again"
                  >
                    PAM changed
                  </th>
                  <th className="wst__th" aria-label="Flags" />
                </tr>
              </thead>
              <tbody ref={body} onKeyDown={onKeyDown}>
                {padTop > 0 && <TableSpacer height={padTop} columns={7} />}
                {pegs.slice(first, end).map((p, k) => {
                  const key = pegId(p);
                  const on = open !== null && key === pegId(open);
                  return (
                    <tr
                      key={key}
                      ref={attachRow(key)}
                      className={`cand${on ? ' is-selected' : ''}`}
                      data-row={key}
                      tabIndex={key === stop ? 0 : -1}
                      aria-selected={on}
                      onClick={() => {
                        if (on) clear();
                        else choose(first + k);
                      }}
                    >
                      <td className="wst__n">{(first + k + 1).toLocaleString()}</td>
                      <td data-tip={`Protospacer ${formatSpan(p.guide.range, doc.length)}`}>
                        <span aria-label={`${p.guide.strand} strand`}>
                          {p.guide.strand === 'forward' ? '→' : '←'}
                        </span>{' '}
                        <span className="panel__mono wst__seq">
                          {p.guide.spacer} {p.guide.pam}
                        </span>
                      </td>
                      <td className="wst__n">{p.nick.toLocaleString()}</td>
                      <td className="wst__n">{p.distance.toLocaleString()}</td>
                      <td className="panel__mono wst__seq">{p.pbs}</td>
                      <td>{p.disruptsPam ? 'yes' : ''}</td>
                      <td
                        className="crispr-ws__flag"
                        data-tip={p.flags.length > 0 ? p.flags.join('; ') : undefined}
                      >
                        {p.flags.length > 0 ? '!' : ''}
                      </td>
                    </tr>
                  );
                })}
                {padBottom > 0 && <TableSpacer height={padBottom} columns={7} />}
              </tbody>
            </table>
          </div>
          <p className="panel__note" role="status">
            {pegs.length.toLocaleString()} {pegs.length === 1 ? 'pegRNA' : 'pegRNAs'} for this edit,
            the nearest nick first.
            {open === null ? ' Select one for its parts to copy.' : ''}
          </p>
        </>
      )}
      {open !== null && <PegDetail key={pegId(open)} peg={open} doc={doc} />}
    </>
  );
}
