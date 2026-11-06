import { useId, useState } from 'react';

import {
  type BaseEditor,
  type CrisprGuide,
  type OligoScheme,
  type SeqDocument,
  baseEditWindow,
  formatSpan,
  guideOligos,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { savePrimers } from '../state/primerCollection';

interface Props {
  readonly doc: SeqDocument;
  readonly guide: CrisprGuide;
  readonly flags: readonly string[];
  readonly others: readonly { readonly name: string }[];
  readonly baseEditor: BaseEditor | undefined;
  readonly schemes: readonly OligoScheme[];
  readonly scheme: OligoScheme;
  readonly onScheme: (id: string) => void;
  /** **Add as feature**: the page says what it did and offers Undo. */
  readonly onAdd: () => void;
}

/**
 * The selected guide in full, beside or under the Guides table (item 133,
 * C4): what is known of it with **Add as feature**, the oligos to order, and
 * every other site it matches. What the slim tab's row and the old list's
 * open row said and did, in two columns.
 */
export function CrisprGuideDetail({
  doc,
  guide,
  flags,
  others,
  baseEditor,
  schemes,
  scheme,
  onScheme,
  onAdd,
}: Props) {
  const headId = useId();
  const [saved, setSaved] = useState<string | null>(null);
  const oligos = guideOligos(guide.spacer, scheme);
  const at = (guide.range.start + 1).toLocaleString();
  const window = baseEditor === undefined ? null : baseEditWindow(guide, baseEditor);
  const siteCount = guide.offTargets.reduce((a, b) => a + b, 0);

  return (
    <aside className="detail crispr-ws__detail" aria-labelledby={headId}>
      <div className="detail__head">
        <strong id={headId}>
          Guide at {at} ({guide.strand})
        </strong>
        <span className="dnote panel__mono">
          {guide.spacer}
          {guide.pam}
        </span>
        <span className="detail__show panel__buttons">
          <button type="button" className="button button--small" onClick={onAdd}>
            Add as feature
          </button>
        </span>
      </div>
      <div className="crispr-ws__body">
        <div className="crispr-ws__col">
          <dl className="crispr-detail">
            <dt>Protospacer</dt>
            <dd>
              {formatSpan(guide.range, doc.length)} ({guide.strand})
            </dd>
            <dt>Spacer</dt>
            <dd className="crispr-detail__mono">{guide.spacer}</dd>
            <dt>PAM</dt>
            <dd className="crispr-detail__mono">{guide.pam}</dd>
            <dt>Cut</dt>
            <dd>
              {guide.cut.forward === guide.cut.reverse
                ? `blunt, after base ${guide.cut.forward.toLocaleString()}`
                : `after base ${guide.cut.forward.toLocaleString()} on the top strand and ${guide.cut.reverse.toLocaleString()} on the bottom`}
            </dd>
            <dt>GC</dt>
            <dd>{Math.round(guide.gc * 100)}%</dd>
            {guide.specificity !== null && (
              <>
                <dt>Specificity</dt>
                <dd data-tip="MIT score (Hsu 2013) over the off-target sites counted here; 100 is no other site">
                  {guide.specificity.toFixed(0)} / 100
                </dd>
              </>
            )}
            {window !== null && (
              <>
                <dt>
                  {window.editor.from} to {window.editor.to}
                </dt>
                <dd>
                  {window.editable.length === 0
                    ? `no ${window.editor.from} in positions ${String(window.editor.window[0])}-${String(window.editor.window[1])}`
                    : `${window.editable.map((b) => `${b.base}${String(b.position)}`).join(', ')} (${formatSpan(window.range, doc.length)})`}
                </dd>
                {window.editable.length > 0 && (
                  <>
                    <dt>Edited</dt>
                    <dd className="crispr-detail__mono">{window.edited}</dd>
                  </>
                )}
              </>
            )}
            <dt>Flags</dt>
            <dd className={flags.length > 0 ? 'crispr-detail__flags' : undefined}>
              {flags.length > 0 ? flags.join('; ') : 'none'}
            </dd>
          </dl>
        </div>
        <div className="crispr-ws__col">
          <h4 className="crispr-guide__heading">Oligos to order</h4>
          <div className="panel__controls">
            <label className="panel__field panel__field--stack">
              <span>Overhangs</span>
              <select
                className="panel__select"
                value={scheme.id}
                onChange={(e) => {
                  onScheme(e.target.value);
                }}
              >
                {schemes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="panel__protein">
            <span className="crispr-oligo">{oligos.top}</span>
            <span className="crispr-oligo">{oligos.bottom}</span>
          </p>
          <div className="crispr-actions">
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                copyText(`${oligos.top}\n${oligos.bottom}`);
              }}
            >
              Copy oligos
            </button>
            <button
              type="button"
              className="button button--small"
              onClick={() => {
                analytics.track('crispr', 'oligos', scheme.id);
                const notes = `CRISPR guide oligo, ${guide.pam} PAM`;
                void savePrimers(
                  [
                    { name: `guide ${at} top`, sequence: oligos.top, notes },
                    { name: `guide ${at} bottom`, sequence: oligos.bottom, notes },
                  ],
                  'design',
                ).then((r) => {
                  setSaved(
                    r.added.length === 0
                      ? 'Already in My primers.'
                      : `Saved ${r.added.length.toLocaleString()} oligos to My primers.`,
                  );
                });
              }}
            >
              Save to My primers
            </button>
          </div>
          {saved !== null && <p className="panel__note">{saved}</p>}
        </div>
      </div>

      {guide.sites.length > 0 && (
        <>
          <h4 className="crispr-guide__heading">
            Other sites
            <span className="panel__heading-note">{siteCount.toLocaleString()}</span>
          </h4>
          <div className="crispr-ws__sites">
            <table className="dt" aria-label="Other sites">
              <thead>
                <tr>
                  <th>Mismatches</th>
                  <th>Document</th>
                  <th>Position</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {guide.sites.map((s) => {
                  const where =
                    s.doc === 0 ? doc.name : (others[s.doc - 1]?.name ?? 'another document');
                  return (
                    <tr key={`${String(s.doc)}:${s.strand}:${String(s.range.start)}`}>
                      <td className={s.mismatches === 0 ? 'dt__warn' : undefined}>
                        {s.mismatches === 0 ? 'exact' : `${String(s.mismatches)} mm`}
                      </td>
                      <td className="crispr-ws__where">{where}</td>
                      <td className="wst__n">
                        {s.strand === 'forward' ? '→' : '←'}{' '}
                        {s.doc === 0
                          ? formatSpan(s.range, doc.length)
                          : (s.range.start + 1).toLocaleString()}
                      </td>
                      <td>
                        {s.doc === 0 && (
                          <button
                            type="button"
                            className="link"
                            aria-label={`Show the site at ${formatSpan(s.range, doc.length)}`}
                            onClick={() => {
                              editorStore.setSelection(s.range);
                              editorStore.revealPosition(s.range.start);
                            }}
                          >
                            Show
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {siteCount > guide.sites.length && (
            <p className="panel__note panel__note--quiet">
              The {guide.sites.length.toLocaleString()} closest of {siteCount.toLocaleString()}{' '}
              sites.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
