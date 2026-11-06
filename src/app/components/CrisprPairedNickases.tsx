import { useMemo } from 'react';

import { type CrisprGuide, type NickPair, type SeqDocument, formatSpan } from '@/core';

import { type OverlaySpan } from '@/view/overlay';

import { analytics } from '../analytics';
import { updateCrisprSession, useCrisprSession } from '../crisprSession';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { type useNickPairs, pairId, pairSpan } from './crisprEditing';
import { guideId, useCrisprPreview } from './crisprScan';
import { useRowPicker } from './useRowPicker';

/** Height assumed for a row not yet measured, in pixels: one line of text. */
const ROW_ESTIMATE = 28;

/** The overhang as the table says it. */
const overhangLabel = (p: NickPair): string =>
  p.overhang === 'blunt'
    ? 'blunt'
    : `${String(p.overhangLength)} nt ${p.overhang === '5prime' ? '5′' : '3′'} overhang`;

/** One guide of a pair: which way it points, where, and its spacer. */
function GuideCell({ guide, doc }: { readonly guide: CrisprGuide; readonly doc: SeqDocument }) {
  return (
    <td
      data-tip={`Guide at ${formatSpan(guide.range, doc.length)}, ${guide.strand} strand, PAM ${guide.pam}`}
    >
      <span aria-label={`${guide.strand} strand`}>{guide.strand === 'forward' ? '→' : '←'}</span>{' '}
      {formatSpan(guide.range, doc.length)}{' '}
      <span className="panel__mono wst__seq">{guide.spacer}</span>
    </td>
  );
}

interface Props {
  readonly doc: SeqDocument;
  /** What `useNickPairs` made of the scan, which the rail's badge counts too. */
  readonly nick: ReturnType<typeof useNickPairs>;
  /** Whether any guide was found at all, which the empty list says. */
  readonly guideCount: number;
}

/**
 * The Pairs page (items 82 and 133, C5): guides on opposite strands whose
 * nicks make a staggered double-strand break, one row for each pair, with the
 * distance between the nicks and the overhang they leave, nearest first. All
 * of them, windowed; a row selects the two guides together and draws them on
 * the views, and nothing else is drawn while this page is in front.
 */
export function PairedNickases({ doc, nick, guideCount }: Props) {
  const { documentId } = useEditorState();
  const { pairs, nickStrand, maxText, maxOffset } = nick;
  const { pairPicked } = useCrisprSession(documentId);

  const keys = useMemo(() => pairs.map(pairId), [pairs]);
  const openIndex = pairPicked === null ? -1 : keys.indexOf(pairPicked);
  const open = openIndex >= 0 ? (pairs[openIndex] ?? null) : null;

  const choose = (index: number): void => {
    const p = pairs[index];
    if (p === undefined) return;
    updateCrisprSession(documentId, { pairPicked: pairId(p) });
    const span = pairSpan(p, doc.length, doc.topology);
    editorStore.setSelection(span);
    editorStore.revealPosition(span.start);
  };
  const clear = (): void => {
    updateCrisprSession(documentId, { pairPicked: null });
    editorStore.setSelection(null);
  };
  const { first, end, padTop, padBottom, attachScroller, attachRow, body, stop, onKeyDown } =
    useRowPicker(keys, open === null ? null : pairId(open), ROW_ESTIMATE, choose, clear);

  // The two guides of the open pair; a click on one selects that guide.
  const previewed = useMemo<OverlaySpan[]>(
    () =>
      open === null
        ? []
        : [open.forwardNick, open.reverseNick].map((g) => ({
            id: guideId(g),
            label: g.pam,
            range: g.range,
            strand: g.strand,
            shape: 'arrow',
            clickable: true,
          })),
    [open],
  );
  useCrisprPreview(previewed, doc, (id) => {
    const g = [open?.forwardNick, open?.reverseNick].find(
      (x) => x !== undefined && guideId(x) === id,
    );
    if (g === undefined) return;
    editorStore.setSelection(g.range);
    editorStore.revealPosition(g.range.start);
  });

  return (
    <>
      <div className="panel__controls crispr-ws__settings" role="group" aria-label="Settings">
        <label className="panel__field">
          <span>Nickase</span>
          <select
            value={nickStrand}
            onChange={(e) => {
              analytics.track('crispr', 'nickPairs');
              updateCrisprSession(documentId, {
                nickStrand: e.target.value === 'pam' ? 'pam' : 'target',
              });
            }}
          >
            <option value="target">D10A (nicks the strand the guide pairs with)</option>
            <option value="pam">H840A (nicks the PAM strand)</option>
          </select>
        </label>
        <label className="panel__field panel__field--row">
          <span>Nicks at most (bp) apart</span>
          <input
            className="panel__number"
            type="number"
            min={0}
            value={maxText}
            onChange={(e) => {
              updateCrisprSession(documentId, { maxOffset: e.target.value });
            }}
          />
        </label>
      </div>
      {pairs.length === 0 ? (
        <p className="panel__note" role="status">
          {guideCount === 0
            ? 'No guides were found, so there is no pair of them.'
            : 'No pair of the guides found nicks within that distance.'}
        </p>
      ) : (
        <>
          <div className="tablewrap crispr-ws__scroll" ref={attachScroller}>
            <table className="wst dt" role="grid" aria-label="Paired nickases">
              <thead>
                <tr>
                  <th
                    className="wst__th wst__n"
                    data-tip="Place in this list, the closest nicks first"
                  >
                    #
                  </th>
                  <th
                    className="wst__th"
                    data-tip="The guide whose nick is on the forward strand: its direction, where it is, its spacer"
                  >
                    Forward nick
                  </th>
                  <th
                    className="wst__th"
                    data-tip="The guide whose nick is on the reverse strand: its direction, where it is, its spacer"
                  >
                    Reverse nick
                  </th>
                  <th
                    className="wst__th wst__n"
                    data-tip="Bases between the two nicks, the short way round"
                  >
                    Apart (bp)
                  </th>
                  <th
                    className="wst__th"
                    data-tip="What the two nicks leave: a 5′ overhang when the reverse nick is further along, a 3′ one when it is behind"
                  >
                    Overhang
                  </th>
                </tr>
              </thead>
              <tbody ref={body} onKeyDown={onKeyDown}>
                {padTop > 0 && <Spacer height={padTop} />}
                {pairs.slice(first, end).map((p, k) => {
                  const key = pairId(p);
                  const on = key === (open === null ? null : pairId(open));
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
                      <GuideCell guide={p.forwardNick} doc={doc} />
                      <GuideCell guide={p.reverseNick} doc={doc} />
                      <td
                        className="wst__n"
                        data-tip={
                          p.overhang === 'blunt'
                            ? 'Both strands are cut at the same place'
                            : `The single-stranded bases are ${formatSpan(p.gap, doc.length)}`
                        }
                      >
                        {p.overhangLength.toLocaleString()}
                      </td>
                      <td>{overhangLabel(p)}</td>
                    </tr>
                  );
                })}
                {padBottom > 0 && <Spacer height={padBottom} />}
              </tbody>
            </table>
          </div>
          <p className="panel__note" role="status">
            {pairs.length.toLocaleString()} {pairs.length === 1 ? 'pair' : 'pairs'} of guides nick
            within {maxOffset.toLocaleString()} bp of each other, the closest first.
            {open === null ? ' Select one to draw its two guides.' : ''}
          </p>
        </>
      )}
    </>
  );
}

/** Rows not drawn, as the height they would take. */
function Spacer({ height }: { readonly height: number }) {
  return (
    <tr className="wst__spacer" aria-hidden="true" style={{ height }}>
      <td colSpan={5} />
    </tr>
  );
}
