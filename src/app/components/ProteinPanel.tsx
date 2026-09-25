import { useMemo } from 'react';

import { type SeqDocument, isEmptyRange, proteinProperties } from '@/core';

import { useEditorState } from '../state/useEditorStore';

interface Props {
  readonly doc: SeqDocument;
}

/** The twenty in the order ProtParam lists them, then the rarer codes when present. */
const COMPOSITION_ORDER: readonly string[] = Array.from('ARNDCQEGHILKMFPSTWYVUOBZJX');

function fixed(n: number, digits: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * The Protein tab (#66): length, molecular weight, pI and extinction
 * coefficient of the protein, or of the residues selected in it, computed
 * as ExPASy ProtParam computes them (`core/analysis/proteinProperties.ts`).
 */
export function ProteinPanel({ doc }: Props) {
  const { selection } = useEditorState();
  const hasSelection = selection !== null && !isEmptyRange(selection);
  const residues = useMemo(
    () => (hasSelection ? doc.subsequence(selection) : doc.sequence.toString()),
    [doc, hasSelection, selection],
  );
  const p = useMemo(() => proteinProperties(residues), [residues]);

  if (p.length === 0) {
    return (
      <div className="panel">
        <p className="panel__note">
          {hasSelection
            ? 'The selection holds no residues.'
            : 'Type or paste a protein sequence to see its properties.'}
        </p>
      </div>
    );
  }

  const estimate = p.ambiguous > 0 ? ' (estimate)' : '';
  const facts: readonly [string, string][] = [
    ['Length', `${p.length.toLocaleString()} aa`],
    [
      `Molecular weight${estimate}`,
      `${fixed(p.molecularWeight, 2)} Da (${fixed(p.molecularWeight / 1000, 1)} kDa)`,
    ],
    [`Theoretical pI${estimate}`, p.isoelectricPoint === null ? '—' : fixed(p.isoelectricPoint, 2)],
    ['Charge at pH 7', fixed(p.chargeAtPH7, 1)],
    ['ε₂₈₀, cystines', `${p.extinctionCystines.toLocaleString()} M⁻¹ cm⁻¹`],
    ['ε₂₈₀, reduced', `${p.extinctionReduced.toLocaleString()} M⁻¹ cm⁻¹`],
    ['Abs 0.1%, cystines', p.absorbanceCystines === null ? '—' : fixed(p.absorbanceCystines, 3)],
    ['Abs 0.1%, reduced', p.absorbanceReduced === null ? '—' : fixed(p.absorbanceReduced, 3)],
  ];
  const composition = COMPOSITION_ORDER.map((code) => [code, p.counts.get(code) ?? 0] as const)
    // The twenty always, the rest only when the chain has them.
    .filter(([, n], i) => i < 20 || n > 0);

  return (
    <div className="panel protein-panel">
      <p className="panel__note panel__note--quiet">
        {hasSelection
          ? `Of the ${p.length.toLocaleString()} residues selected, ${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()}.`
          : 'Of the whole protein. Select residues for the properties of just those.'}
      </p>
      <dl className="protein-facts" aria-label="Protein properties">
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {p.ambiguous > 0 && (
        <p className="panel__note panel__note--warn">
          {p.ambiguous.toLocaleString()} {p.ambiguous === 1 ? 'residue is' : 'residues are'}{' '}
          ambiguous (B, Z or X): the weight takes an average mass for{' '}
          {p.ambiguous === 1 ? 'it' : 'them'} and the pI no charge.
        </p>
      )}
      {p.stops > 0 && (
        <p className="panel__note">
          {p.stops === 1 ? 'A stop (*) is' : `${p.stops.toLocaleString()} stops (*) are`} left out:
          a stop is not a residue.
        </p>
      )}
      {p.extinctionCystines === 0 && (
        <p className="panel__note">
          No Trp, Tyr or Cys: this protein barely absorbs at 280 nm, so its concentration is better
          measured another way.
        </p>
      )}
      <h3 className="panel__heading">Composition</h3>
      <table className="protein-composition">
        <tbody>
          {composition.map(([code, n]) => (
            <tr key={code}>
              <th scope="row">{code}</th>
              <td>{n.toLocaleString()}</td>
              <td>{fixed((100 * n) / p.length, 1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="panel__note panel__note--quiet">
        Average residue masses; pI from the pK values of Bjellqvist et al.; ε₂₈₀ in water by Pace et
        al. (1995), as ExPASy ProtParam computes them.
      </p>
    </div>
  );
}
