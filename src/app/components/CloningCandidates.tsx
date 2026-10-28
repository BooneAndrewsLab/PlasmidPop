import { type KeyboardEvent, useMemo, useRef, useState } from 'react';

import {
  type CloningDesign,
  type CloningPrimer,
  type CloningWarning,
  type EnzymeEnd,
  type SeqDocument,
  cloningPrimerNames,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { openPcr, sendToPcr } from '../primerToPcr';
import { type WorkspaceLayout } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { rememberPanel } from '../state/panelMemory';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import {
  type CloningDesignRecord,
  type CloningDesignState,
  cutAt,
  designRows,
  endText,
  pairLabel,
  siteWithCut,
} from './cloningDesign';
import { CheckSpecificity } from './CheckSpecificity';
import { MapStrip } from './MapStrip';
import { pct } from './primerDesign';
import { nextRowIndex } from './tableKeys';

/** What the annealing parts' trip to Primer-BLAST sends: the tails would not match any template. */
const BLAST_ANNEALING =
  'Opens NCBI Primer-BLAST in a new tab with the two annealing parts (not the tails, which match no template) in the address. Nothing else leaves the browser, and nothing until you click.';

/** A warning's tag in the table; the sentence is its tooltip. */
function tagText(w: CloningWarning): string {
  switch (w.kind) {
    case 'cutsInsert':
      return `${w.enzyme ?? ''} cuts insert`.trim();
    case 'vectorCuts':
      return `${w.enzyme ?? ''} vector cuts`.trim();
    case 'outsideRegion':
      return `${w.enzyme ?? ''} outside region`.trim();
    case 'methylation':
      return `${w.enzyme ?? ''} methylation`.trim();
    case 'blunt':
      return 'blunt';
    case 'typeIIS':
      return `${w.enzyme ?? ''} Type IIS`.trim();
    case 'sameEnzyme':
      return 'same enzyme';
    case 'compatibleEnds':
      return 'not directional';
    case 'tooClose':
      return 'cuts too close';
    case 'unknownEnzyme':
      return 'unknown enzyme';
    case 'paddingRaised':
      return `padding raised${w.enzyme === undefined ? '' : ` (${w.enzyme})`}`;
    case 'junctionSite':
      return 'junction site';
    case 'extraSite':
      return `${w.enzyme ?? ''} extra site`.trim();
    case 'annealing':
      return 'annealing part';
    case 'notSpecific':
      return 'binds elsewhere';
    case 'dimer':
      return 'dimer';
    case 'vectorPieces':
      return 'vector in pieces';
  }
}

/**
 * One oligo 5′→3′ with its parts told apart: padding in the muted ink and
 * lower case, the site in the cut colour, underlined and lower case, the
 * annealing part in upper case. The case carries the distinction on its
 * own; the site has a label for a reader that sees no colour.
 */
export function Oligo({ primer }: { readonly primer: CloningPrimer }) {
  const { padding, site, spacer, annealing } = primer.segments;
  return (
    <span className="oligo panel__mono">
      {padding !== '' && <span className="oligo__pad">{padding.toLowerCase()}</span>}
      <span className="oligo__site" aria-label={`${primer.enzyme} site ${site.toLowerCase()}`}>
        {site.toLowerCase()}
      </span>
      {spacer !== '' && <span className="oligo__pad">{spacer.toLowerCase()}</span>}
      <span className="oligo__ann">{annealing.toUpperCase()}</span>
    </span>
  );
}

function WarningTags({ warnings }: { readonly warnings: readonly CloningWarning[] }) {
  if (warnings.length === 0) return <span className="dnote">—</span>;
  const danger = warnings.filter((w) => w.severity === 'danger');
  const shown = [...danger, ...warnings.filter((w) => w.severity === 'caution')].slice(0, 2);
  const more = warnings.length - shown.length;
  return (
    <span className="wtags">
      {shown.map((w, i) => (
        <span
          key={`${w.kind}-${i.toString()}`}
          className={`wtag wtag--${w.severity}`}
          data-tip={w.text}
        >
          {tagText(w)}
        </span>
      ))}
      {more > 0 && <span className="dnote">+{more.toString()}</span>}
    </span>
  );
}

function OligoRow({
  strand,
  primer,
  insertLength,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: CloningPrimer;
  readonly insertLength: number;
}) {
  const n = primer.segments.annealing.length;
  const lands =
    strand === 'forward'
      ? `1–${n.toLocaleString()}`
      : `${(insertLength - n + 1).toLocaleString()}–${insertLength.toLocaleString()}`;
  return (
    <tr>
      <th scope="row">{strand === 'forward' ? '→ Forward' : '← Reverse'}</th>
      <td className="dt__seq">
        <Oligo primer={primer} />
      </td>
      <td className="wst__n">{primer.sequence.length.toLocaleString()} nt</td>
      <td className="wst__n" data-tip="Melting temperature of the annealing part">
        Tm {primer.tm.toFixed(1)}
      </td>
      <td className="wst__n" data-tip="GC content of the annealing part">
        GC {pct(primer.annealing.gc)}
      </td>
      <td className="wst__n" data-tip="The insert's bases the annealing part covers">
        insert {lands}
      </td>
      <td
        className={primer.annealing.gcClamp ? 'dt__ok' : 'dt__warn'}
        data-tip="Whether the 3′ end is G or C"
      >
        {primer.annealing.gcClamp ? 'clamp' : 'no clamp'}
      </td>
    </tr>
  );
}

function EndRow({
  which,
  end,
  primer,
  vector,
}: {
  readonly which: '5′ end' | '3′ end';
  readonly end: EnzymeEnd;
  readonly primer: CloningPrimer;
  readonly vector: SeqDocument;
}) {
  const at = cutAt(end.site, vector);
  const vectorCut =
    end.vectorCuts === 0
      ? 'does not cut the vector ✗'
      : end.vectorCuts === 1
        ? at === null
          ? 'vector cut once, outside the region ✗'
          : `vector cut once, at ${at.toLocaleString()} ✓`
        : `vector cut ${end.vectorCuts.toLocaleString()} times ✗`;
  const padding = primer.segments.padding;
  return (
    <tr>
      <th scope="row">{which}</th>
      <td>
        <b>{end.enzyme}</b> <span className="panel__mono">{siteWithCut(end.enzyme)}</span>
      </td>
      <td>
        padding <span className="panel__mono oligo__pad">{padding.toLowerCase()}</span> (
        {padding.length.toLocaleString()} nt
        {primer.paddingRaised !== null ? ', raised' : ''})
      </td>
      <td>
        overhang <span className="panel__mono">{endText(end.end)}</span>
      </td>
      <td>{vectorCut}</td>
    </tr>
  );
}

interface DetailProps {
  readonly record: CloningDesignRecord;
  readonly design: CloningDesign;
  readonly rank: number;
  readonly layout: WorkspaceLayout;
  readonly onSaid: (note: string) => void;
}

/**
 * The detail pane: both primers with their parts, the two ends (enzyme,
 * site with its cut, padding, overhang, how the vector is cut), the
 * warnings, the actions and the simulated product drawn small — the same
 * product Simulate opens as a tab.
 */
function CloningDetail({ record, design, rank, layout, onSaid }: DetailProps) {
  const { documentId } = useEditorState();
  const { forward, reverse, pair, warnings } = design;
  const insertLength = design.amplicon.length - forward.sequence.length - reverse.sequence.length;
  const simulation = useMemo(() => design.simulate(), [design]);
  const product = simulation.product;
  const names = cloningPrimerNames(record.insert.name, forward.enzyme, reverse.enzyme);
  const openProduct = (): void => {
    if (product === null) return;
    analytics.track('primers', 'simulate-cloning');
    editorStore.openDocument(product);
    editorStore.setSidebarTab('features');
  };
  const saveBoth = (): void => {
    const note = `${record.insert.name} into ${record.vectorName} · padding ${record.padding.toString()} nt; Tm of the annealing part`;
    void savePrimers(
      [
        {
          name: names.forward,
          sequence: forward.sequence,
          notes: `${note} ${forward.tm.toFixed(1)} °C`,
        },
        {
          name: names.reverse,
          sequence: reverse.sequence,
          notes: `${note} ${reverse.tm.toFixed(1)} °C`,
        },
      ],
      'design',
    ).then((r) => {
      onSaid(
        r.added.length === 0
          ? 'Already in My primers.'
          : `Saved ${r.added.map((q) => q.name).join(' and ')} to My primers.`,
      );
    });
  };
  const toPcr = (): void => {
    analytics.track('primers', 'to-pcr');
    sendToPcr(documentId, 'forward', { name: names.forward, sequence: forward.sequence });
    sendToPcr(documentId, 'reverse', { name: names.reverse, sequence: reverse.sequence });
    // The template is the insert's tab, where the primers anneal.
    rememberPanel('pcr.template', documentId, record.insertDocumentId);
    openPcr();
  };
  const thumb = (
    <div className={`product${layout === 'phone' ? ' product--ph' : ''}`}>
      <span className="product__t">
        Simulated product
        <span className="dnote">
          PCR → {forward.enzyme} + {reverse.enzyme} digest → ligation into the backbone
        </span>
      </span>
      {product !== null ? (
        <>
          <MapStrip doc={product} height={layout === 'phone' ? 56 : 72} fixed />
          <span className="product__l">
            {product.name} · {product.length.toLocaleString()} bp · {product.topology}
          </span>
        </>
      ) : (
        <span className="product__l warns-danger">{simulation.problem ?? 'No product.'}</span>
      )}
    </div>
  );
  return (
    <aside
      className={`detail detail--clone${layout === 'phone' ? '' : ' detail--split'}`}
      aria-label={`Pair ${rank.toString()}`}
    >
      <div className="detail__main">
        <div className="detail__head">
          <strong>{pairLabel({ forward: forward.enzyme, reverse: reverse.enzyme })}</strong>
          <span className="dnote">
            PCR {design.productLength.toLocaleString()} bp
            {product !== null ? ` · product ${product.length.toLocaleString()} bp` : ''}
            {rank === 1 ? ' · picked' : ' · suggested'}
          </span>
        </div>
        {design.problem !== null ? (
          <p className="panel__error">{design.problem}</p>
        ) : (
          <>
            <table className="dt">
              <tbody>
                <OligoRow strand="forward" primer={forward} insertLength={insertLength} />
                <OligoRow strand="reverse" primer={reverse} insertLength={insertLength} />
              </tbody>
            </table>
            <table className="dt dt--ends">
              <tbody>
                <EndRow which="5′ end" end={pair.forward} primer={forward} vector={record.vector} />
                <EndRow which="3′ end" end={pair.reverse} primer={reverse} vector={record.vector} />
              </tbody>
            </table>
          </>
        )}
        {warnings.length === 0 ? (
          <p className="warns warns--ok">No warnings</p>
        ) : (
          <ul className="warns" aria-label="Warnings">
            {warnings.map((w, i) => (
              <li key={`${w.kind}-${i.toString()}`} className={`warns__${w.severity}`}>
                {w.text}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button
            type="button"
            className="button button--primary button--small"
            disabled={product === null}
            data-tip={
              product === null
                ? (simulation.problem ?? 'Nothing to open')
                : 'Run PCR, the digest and the ligation, and open the product as a new document'
            }
            onClick={openProduct}
          >
            Simulate
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={design.problem !== null}
            data-tip={`Keep both primers in My primers as ${names.forward} and ${names.reverse}`}
            onClick={saveBoth}
          >
            Save both
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={design.problem !== null}
            data-tip="Copy both oligos, 5′ to 3′, name and bases a line each"
            onClick={() => {
              copyText(
                `${names.forward}\t${forward.sequence}\n${names.reverse}\t${reverse.sequence}\n`,
              );
              onSaid('Copied both primers.');
            }}
          >
            Copy
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={design.problem !== null}
            data-tip="Put both primers in Cloning ▸ PCR with the insert's tab as the template"
            onClick={toPcr}
          >
            Use in PCR
          </button>
          <span className="actions__gap" />
          <CheckSpecificity
            pair={{
              forward: forward.segments.annealing,
              reverse: reverse.segments.annealing,
              productLength: insertLength,
            }}
            doc={record.insert.document}
            sites={[record.insert.range]}
            forwardOnBottom={record.insert.strand === 'reverse'}
            tip={BLAST_ANNEALING}
          />
        </div>
      </div>
      {thumb}
    </aside>
  );
}

interface Props {
  readonly cloning: CloningDesignState;
  readonly layout: WorkspaceLayout;
}

/**
 * The Results page in cloning mode (#303): one row per designed pair, the
 * picked pair first and the other suggested pairs designed with the same
 * settings under it, each oligo written as ordered with its parts told
 * apart; the selected row's detail and simulated product under the table.
 */
export function CloningCandidates({ cloning, layout }: Props) {
  const { record, selected, select } = cloning;
  const [said, setSaid] = useState<string | null>(null);
  const rowsEl = useRef<HTMLElement | null>(null);
  const holdRows = (el: HTMLElement | null): void => {
    rowsEl.current = el;
  };
  const rows = useMemo(() => (record === null ? [] : designRows(record.results)), [record]);

  if (record === null) {
    return <p className="panel__note">No design yet. Design cloning primers first.</p>;
  }
  const stop = selected !== null && selected < rows.length ? selected : 0;
  const onRowsKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const to = nextRowIndex(e.key, selected, rows.length);
    if (to === null) return;
    e.preventDefault();
    select(to);
    rowsEl.current?.querySelector<HTMLElement>(`[data-row="${to.toString()}"]`)?.focus();
  };
  const selectedDesign = selected === null ? undefined : rows[selected];
  const detail =
    selectedDesign === undefined ? null : (
      <CloningDetail
        record={record}
        design={selectedDesign}
        rank={(selected ?? 0) + 1}
        layout={layout}
        onSaid={setSaid}
      />
    );

  return (
    <div className="results results--clone">
      {layout === 'phone' ? (
        <ul className="plist" aria-label="Cloning pairs" ref={holdRows} onKeyDown={onRowsKeyDown}>
          {rows.map((d, index) => {
            const on = index === selected;
            return (
              <li
                key={index}
                className={`prow${on ? ' is-selected' : ''}`}
                aria-current={on ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="prow__h"
                  data-row={index}
                  tabIndex={index === stop ? 0 : -1}
                  aria-expanded={on}
                  onClick={() => {
                    select(on ? null : index);
                  }}
                >
                  <b>#{(index + 1).toString()}</b>
                  <span>{pairLabel({ forward: d.forward.enzyme, reverse: d.reverse.enzyme })}</span>
                  {d.problem === null ? (
                    <>
                      <span>
                        Tm {d.forward.tm.toFixed(1)} / {d.reverse.tm.toFixed(1)}
                      </span>
                      <span>{d.productLength.toLocaleString()} bp</span>
                    </>
                  ) : (
                    <span className="dnote">no primers</span>
                  )}
                  {d.warnings.length > 0 && (
                    <span
                      className={`wtag wtag--${d.warnings.some((w) => w.severity === 'danger') ? 'danger' : 'caution'}`}
                    >
                      !
                    </span>
                  )}
                </button>
                {on && <div className="prow__d">{detail}</div>}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <div className="tablewrap">
            <table className="wst cands" role="grid" aria-label="Cloning pairs">
              <thead>
                <tr>
                  <th
                    className="wst__th wst__n"
                    data-tip="The picked pair first, then the suggestions in rank"
                  >
                    #
                  </th>
                  <th className="wst__th">Enzymes</th>
                  <th className="wst__th">Forward 5′→3′</th>
                  <th className="wst__th wst__n" data-tip="Oligo length">
                    nt
                  </th>
                  <th className="wst__th wst__n" data-tip="Tm of the annealing part, °C">
                    Tm
                  </th>
                  <th className="wst__th">Reverse 5′→3′</th>
                  <th className="wst__th wst__n" data-tip="Oligo length">
                    nt
                  </th>
                  <th className="wst__th wst__n" data-tip="Tm of the annealing part, °C">
                    Tm
                  </th>
                  <th className="wst__th wst__n" data-tip="PCR product with the tails, bp">
                    PCR
                  </th>
                  <th className="wst__th">Warnings</th>
                </tr>
              </thead>
              <tbody ref={holdRows} onKeyDown={onRowsKeyDown}>
                {rows.map((d, index) => {
                  const on = index === selected;
                  return (
                    <tr
                      key={index}
                      className={`cand${on ? ' is-selected' : ''}`}
                      data-row={index}
                      tabIndex={index === stop ? 0 : -1}
                      aria-selected={on}
                      onClick={() => {
                        select(index);
                      }}
                    >
                      <td className="wst__n">{(index + 1).toString()}</td>
                      <td>{pairLabel({ forward: d.forward.enzyme, reverse: d.reverse.enzyme })}</td>
                      {d.problem !== null ? (
                        <td colSpan={7} className="dnote">
                          {d.problem}
                        </td>
                      ) : (
                        <>
                          <td className="wst__seq">
                            <Oligo primer={d.forward} />
                          </td>
                          <td className="wst__n">{d.forward.sequence.length.toString()}</td>
                          <td className="wst__n">{d.forward.tm.toFixed(1)}</td>
                          <td className="wst__seq">
                            <Oligo primer={d.reverse} />
                          </td>
                          <td className="wst__n">{d.reverse.sequence.length.toString()}</td>
                          <td className="wst__n">{d.reverse.tm.toFixed(1)}</td>
                          <td className="wst__n">{d.productLength.toLocaleString()}</td>
                        </>
                      )}
                      <td>
                        <WarningTags warnings={d.warnings} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="legend dnote">
            <span className="oligo panel__mono">
              <span className="oligo__pad">padding</span> <span className="oligo__site">site</span>{' '}
              <span className="oligo__ann">ANNEALING PART</span>
            </span>{' '}
            · tail in lower case · Tm is the annealing part&rsquo;s · select a row for the detail
            and the simulated product
          </p>
          {detail ?? (
            <p className="panel__note panel__note--quiet results__hint">
              Select a pair to see it in full with its simulated product.
            </p>
          )}
        </>
      )}
      {said !== null && (
        <p className="panel__note panel__note--quiet" role="status">
          {said}
        </p>
      )}
    </div>
  );
}
