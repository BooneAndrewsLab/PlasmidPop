import { KIT_NAMES } from '@/core';

import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import { openPcr, sendToPcr } from '../primerToPcr';
import { type WorkspaceLayout } from '../workspaceController';
import { editorStore } from '../state/editorStore';
import { rememberPanel } from '../state/panelMemory';
import { savePrimers } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { type CloningDesignRecord } from './cloningDesign';
import { MapStrip } from './MapStrip';

/** What the primers are called in My primers: `<insert>-IF-F`, `-NEB-R`, `-YA-F`. */
const KIT_TAGS = { 'in-fusion': 'IF', nebuilder: 'NEB', yeast: 'YA' } as const;

interface Props {
  readonly record: CloningDesignRecord;
  readonly layout: WorkspaceLayout;
  readonly onSaid: (note: string) => void;
}

/**
 * The Results page for homology ends (#403, items 63, 133 R4): the two
 * tailed primers the Bench's insert-primer designer makes, now for the vector
 * in front, with the circle they would assemble into and the actions the
 * other cloning results have. The upper-case head of each oligo is the
 * vector's end, the lower-case part anneals to the insert.
 */
export function HomologyEndsResult({ record, layout, onSaid }: Props) {
  const { documentId } = useEditorState();
  const made = record.homology;
  const primers = made?.design.inserts[0];
  if (made === null || primers === undefined) return null;
  const { design, kit } = made;
  const { forward, reverse } = primers;
  const product = design.product;
  const tag = KIT_TAGS[kit];
  const names = {
    forward: `${record.insert.name}-${tag}-F`,
    reverse: `${record.insert.name}-${tag}-R`,
  };

  const save = (): void => {
    const note = `${record.insert.name} into ${record.vectorName}, ${KIT_NAMES[kit]} tails of ${design.overlap.toString()} bases; Tm of the annealing part`;
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

  return (
    <aside
      className={`detail detail--clone${layout === 'phone' ? '' : ' detail--split'}`}
      aria-label="Homology ends"
    >
      <div className="detail__main">
        <div className="detail__head">
          <strong>{KIT_NAMES[kit]} ends</strong>
          <span className="dnote">
            {design.overlap.toLocaleString()} bases of {record.vectorName}&rsquo;s ends on each
            primer
            {product !== null ? ` · product ${product.length.toLocaleString()} bp` : ''}
          </span>
        </div>
        <table className="dt">
          <tbody>
            {(
              [
                ['→ Forward', forward],
                ['← Reverse', reverse],
              ] as const
            ).map(([label, p]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="dt__seq">
                  <code className="panel__mono">{p.sequence}</code>
                </td>
                <td className="wst__n">{p.sequence.length.toLocaleString()} nt</td>
                <td className="wst__n" data-tip="Melting temperature of the annealing part">
                  Tm {p.tm.toFixed(1)}
                </td>
                <td className="wst__n" data-tip="Bases of the vector's end the tail carries">
                  tail {p.tail.length.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="dnote">
          Upper case is the vector&rsquo;s end, lower case anneals to {record.insert.name}. The
          forward primer carries the last bases of {record.vectorName}, the reverse primer the
          reverse complement of its first.
        </p>
        {design.warnings.length === 0 ? (
          <p className="warns warns--ok">No warnings</p>
        ) : (
          <ul className="warns" aria-label="Warnings">
            {design.warnings.map((w, i) => (
              <li key={i} className="warns__warning">
                {w}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button
            type="button"
            className="button button--primary button--small"
            disabled={product === null}
            data-tip="Open the circle the amplicon and the vector would make as a new document"
            onClick={() => {
              if (product === null) return;
              analytics.track('primers', 'simulate-homology');
              editorStore.openDocument(product, null, [], { scratch: true });
              editorStore.setSidebarTab('features');
            }}
          >
            Simulate
          </button>
          <button
            type="button"
            className="button button--small"
            data-tip={`Keep both primers in My primers as ${names.forward} and ${names.reverse}`}
            onClick={save}
          >
            Save both
          </button>
          <button
            type="button"
            className="button button--small"
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
            data-tip="Put both primers in Cloning ▸ PCR with the insert's tab as the template"
            onClick={() => {
              analytics.track('primers', 'to-pcr');
              sendToPcr(documentId, 'forward', { name: names.forward, sequence: forward.sequence });
              sendToPcr(documentId, 'reverse', { name: names.reverse, sequence: reverse.sequence });
              rememberPanel('pcr.template', documentId, record.insertDocumentId);
              openPcr();
            }}
          >
            Use in PCR
          </button>
        </div>
      </div>
      <div className={`product${layout === 'phone' ? ' product--ph' : ''}`}>
        <span className="product__t">
          Simulated product
          <span className="dnote">
            PCR → {KIT_NAMES[kit]} into {record.vectorName}
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
          <span className="product__l warns-danger">No product.</span>
        )}
      </div>
    </aside>
  );
}
