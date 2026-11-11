import { type CloningPrimer } from '../../core/cloning';

import { Oligo } from './Oligo';
import { pct } from './primerDesign';

/** What the annealing parts' trip to Primer-BLAST sends: the tails would not match any template. */
export const BLAST_ANNEALING =
  'Opens NCBI Primer-BLAST in a new tab with the two annealing parts (not the tails, which match no template) in the address. Nothing else leaves the browser, and nothing until you click.';

/**
 * One oligo of a cloning or Golden Gate design in its table: the primer with
 * its parts told apart, and which bases of `coveredLength` (the insert, or
 * the part's body) its annealing part covers, labelled `covers`.
 */
export function CloningOligoRow({
  strand,
  primer,
  coveredLength,
  covers,
}: {
  readonly strand: 'forward' | 'reverse';
  readonly primer: CloningPrimer;
  readonly coveredLength: number;
  readonly covers: { readonly label: string; readonly tip: string };
}) {
  const n = primer.segments.annealing.length;
  const lands =
    strand === 'forward'
      ? `1–${n.toLocaleString()}`
      : `${(coveredLength - n + 1).toLocaleString()}–${coveredLength.toLocaleString()}`;
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
      <td className="wst__n" data-tip={covers.tip}>
        {covers.label} {lands}
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
