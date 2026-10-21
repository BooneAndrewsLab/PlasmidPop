import { AlignmentPopover } from './AlignmentPopover';

interface Props {
  readonly residues: boolean;
  readonly onResidues: (on: boolean) => void;
  /** The binding that toggles the residues, as "Alt+T"; null when it is unbound. */
  readonly residuesKey: string | null;
  readonly numbers: boolean;
  readonly onNumbers: (on: boolean) => void;
  readonly changes: boolean;
  readonly onChanges: (on: boolean) => void;
  /** How many shown samples have a named change, and how many changes are named in all. */
  readonly changing: number;
  readonly named: number;
  readonly samples: number;
  readonly onClose: () => void;
}

/** "2 of 3 samples change the protein; 3 changes named", whatever the counts. */
function changesText(changing: number, named: number, samples: number): string {
  if (named === 0) return samples === 1 ? 'The sample names no change' : 'No sample names a change';
  const who = `${changing.toLocaleString()} of ${samples.toLocaleString()} ${samples === 1 ? 'sample changes' : 'samples change'}`;
  return `${who} the protein; ${named.toLocaleString()} ${named === 1 ? 'change' : 'changes'} named`;
}

/**
 * The Amino acids popover (#261): the CDS residues under each row, the
 * numbers on the reference's protein ruler, and the tags naming what a sample
 * changes. The numbers and the tags need the residues, so they are greyed
 * while those are off. The hover over a residue names its change either way.
 */
export function AlignmentAminoAcids({
  residues,
  onResidues,
  residuesKey,
  numbers,
  onNumbers,
  changes,
  onChanges,
  changing,
  named,
  samples,
  onClose,
}: Props) {
  return (
    <AlignmentPopover
      title="Amino acids"
      closeLabel="Close amino acids"
      onClose={onClose}
      className="astack-pop--aa astack-pop--end"
    >
      <div className="astack-pop__checks">
        <label className="astack-pop__check">
          <input
            type="checkbox"
            checked={residues}
            onChange={(e) => {
              onResidues(e.target.checked);
            }}
          />
          Residues
          {residuesKey !== null && <span className="astack-pop__key">{residuesKey}</span>}
        </label>
        <label className="astack-pop__check astack-pop__check--sub">
          <input
            type="checkbox"
            checked={numbers}
            disabled={!residues}
            onChange={(e) => {
              onNumbers(e.target.checked);
            }}
          />
          Residue numbers
        </label>
        <label className="astack-pop__check astack-pop__check--sub">
          <input
            type="checkbox"
            checked={changes}
            disabled={!residues}
            onChange={(e) => {
              onChanges(e.target.checked);
            }}
          />
          Changes
        </label>
      </div>
      <div className="astack-pop__foot">
        <span className="astack-pop__status" aria-live="polite">
          {changesText(changing, named, samples)}
        </span>
      </div>
    </AlignmentPopover>
  );
}
