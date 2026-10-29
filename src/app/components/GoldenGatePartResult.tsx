import { useMemo } from 'react';

import {
  type CloningPrimer,
  type GoldenGatePartDesign,
  goldenGatePrimerNames,
  goldenGateSeed,
} from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { FIXED_BY, cloneCheckFromParts, openCloneCheck } from '../cloneCheck';
import { openPcr, sendToPcr } from '../primerToPcr';
import { type WorkspaceLayout } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { rememberPanel } from '../state/panelMemory';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { CheckSpecificity } from './CheckSpecificity';
import { type CloningDesignRecord } from './cloningDesign';
import { MapStrip } from './MapStrip';
import { Oligo } from './Oligo';
import { pct } from './primerDesign';

/** What the annealing parts' trip to Primer-BLAST sends: the tails would not match any template. */
const BLAST_ANNEALING =
  'Opens NCBI Primer-BLAST in a new tab with the two annealing parts (not the tails, which match no template) in the address. Nothing else leaves the browser, and nothing until you click.';

function OligoRow({
  strand,
  primer,
  bodyLength,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: CloningPrimer;
  readonly bodyLength: number;
}) {
  const n = primer.segments.annealing.length;
  const lands =
    strand === 'forward'
      ? `1–${n.toLocaleString()}`
      : `${(bodyLength - n + 1).toLocaleString()}–${bodyLength.toLocaleString()}`;
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
      <td className="wst__n" data-tip="The bases of the part the annealing part covers">
        part {lands}
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

interface Props {
  readonly record: CloningDesignRecord;
  readonly design: GoldenGatePartDesign;
  readonly layout: WorkspaceLayout;
  readonly onSaid: (note: string) => void;
}

/**
 * The Results page for a Golden Gate part (#310, item 113): the two oligos
 * with their parts told apart, what the part the reaction releases is, the
 * warnings, and the same actions cloning mode's pairs have — Simulate here
 * being PCR and then the Golden Gate into the destination, which opens the
 * circle with the enzyme ticked (#309).
 */
export function GoldenGatePartResult({ record, design, layout, onSaid }: Props) {
  const { documentId } = useEditorState();
  const { forward, reverse, warnings } = design;
  const enzyme = forward.enzyme;
  const simulation = useMemo(() => design.simulate(), [design]);
  const product = simulation.product;
  const names = goldenGatePrimerNames(record.insert.name, enzyme);
  const bodyLength = design.part.length - design.left.length - design.right.length;

  const openProduct = (): void => {
    if (product === null) return;
    analytics.track('primers', 'simulate-golden-gate');
    editorStore.openDocument(product, null, [], {
      scratch: true,
      shownEnzymes: goldenGateSeed(enzyme),
    });
    editorStore.setSidebarTab('features');
  };
  /** Simulate, then the clone check on the circle, the uncut destination being the empty vector (item 120). */
  const checkProduct = (): void => {
    const amplicon = simulation.amplicon;
    if (product === null || amplicon === null) return;
    analytics.track('primers', 'simulate-golden-gate');
    openCloneCheck(
      product,
      cloneCheckFromParts(
        product,
        { document: record.vector },
        [{ document: amplicon }],
        'Golden Gate',
        { open: false, note: FIXED_BY.overhangs },
        [
          { name: names.forward, sequence: forward.sequence },
          { name: names.reverse, sequence: reverse.sequence },
        ],
      ),
      { scratch: true, shownEnzymes: goldenGateSeed(enzyme) },
      'golden-gate',
    );
  };
  const saveBoth = (): void => {
    const note = `${record.insert.name} as a ${enzyme} part ${design.left}…${design.right} for ${record.vectorName} · padding ${record.padding.toString()} nt; Tm of the annealing part`;
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
    rememberPanel('pcr.template', documentId, record.insertDocumentId);
    openPcr();
  };

  const thumb = (
    <div className={`product${layout === 'phone' ? ' product--ph' : ''}`}>
      <span className="product__t">
        Simulated product
        <span className="dnote">
          PCR → {enzyme} Golden Gate into {record.vectorName}
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
        <span className="product__l warns-danger">
          {simulation.missing ?? simulation.problem ?? 'No product.'}
        </span>
      )}
    </div>
  );

  return (
    <aside
      className={`detail detail--clone${layout === 'phone' ? '' : ' detail--split'}`}
      aria-label="Golden Gate part"
    >
      <div className="detail__main">
        <div className="detail__head">
          <strong>
            {enzyme} part {design.left}…{design.right}
          </strong>
          <span className="dnote">
            PCR {design.productLength.toLocaleString()} bp · part{' '}
            {design.part.length.toLocaleString()} bp
            {product !== null ? ` · product ${product.length.toLocaleString()} bp` : ''}
          </span>
        </div>
        {design.problem !== null ? (
          <p className="panel__error">{design.problem}</p>
        ) : (
          <>
            <table className="dt">
              <tbody>
                <OligoRow strand="forward" primer={forward} bodyLength={bodyLength} />
                <OligoRow strand="reverse" primer={reverse} bodyLength={bodyLength} />
              </tbody>
            </table>
            <p className="dnote">
              Each tail is padding, the {enzyme} site pointing into the part, the spacer base
              {design.forward.segments.spacer.length - design.left.length === 1 ? '' : 's'} and the
              overhang; the reverse primer carries the right overhang reverse-complemented. The part
              the reaction releases is{' '}
              <span className="panel__mono">
                {design.left}…{design.right}
              </span>
              , {design.part.length.toLocaleString()} bp
              {design.overlap.left > 0
                ? `, the overhang's last ${design.overlap.left.toLocaleString()} bases being the part's own (the annealing part begins after them)`
                : ''}
              {design.trimmed.stop ? ', with the stop codon left out' : ''}
              {design.trimmed.start ? ', with the start codon left out' : ''}.
              {design.frame.coding && !design.frame.stopped
                ? ` ${design.frame.length.toLocaleString()} coding bases reach the right overhang${design.frame.inFrame ? ', a whole number of codons' : ', which is not a whole number of codons'}.`
                : ''}
            </p>
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
        {simulation.missing !== null && (
          <p className="panel__note panel__note--quiet">{simulation.missing}</p>
        )}
        <div className="actions">
          <button
            type="button"
            className="button button--primary button--small"
            disabled={product === null}
            data-tip={
              product === null
                ? (simulation.missing ?? simulation.problem ?? 'Nothing to open')
                : 'Run the PCR and the Golden Gate, and open the assembled circle as a new document'
            }
            onClick={openProduct}
          >
            Simulate
          </button>
          <button
            type="button"
            className="button button--small"
            disabled={product === null}
            data-tip="Simulate, then design colony-PCR primers on the circle: a band only with the part, a size with and without it"
            onClick={checkProduct}
          >
            Check primers…
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
            data-tip="Put both primers in Cloning ▸ PCR with the part's tab as the template"
            onClick={toPcr}
          >
            Use in PCR
          </button>
          <span className="actions__gap" />
          <CheckSpecificity
            pair={{
              forward: forward.segments.annealing,
              reverse: reverse.segments.annealing,
              productLength: bodyLength,
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
