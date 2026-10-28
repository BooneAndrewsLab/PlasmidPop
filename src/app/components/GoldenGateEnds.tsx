import { useMemo } from 'react';

import {
  designGoldenGatePart,
  insertSequence,
  standardOverhangChoices,
  typeIISLayout,
  getEnzyme,
} from '@/core';

import {
  CUSTOM_OVERHANGS,
  FROM_DESTINATION,
  type CloningDesignState,
  type GoldenGateMemory,
  goldenGateEnzymeNames,
  overhangWidth,
  overhangsReady,
} from './cloningDesign';

/**
 * Step 3 in the Golden Gate option of cloning mode (#310, item 113): the
 * Type IIS enzyme, the two overhangs — a standard's pair, the pair the
 * destination asks for, or four bases typed — and whether the region's own
 * start and stop codons are part of the part. Everything else (the insert,
 * the padding, the annealing criteria, Design) is cloning mode's own.
 *
 * The note under the fields is a live design: it is a few milliseconds on a
 * gene-sized insert, and it is what says that `AATG` already spells the
 * start codon, whether the part would be read in frame, and whether the
 * enzyme cuts the part itself — before the primers are made.
 */
export function GoldenGateEnds({ cloning }: { readonly cloning: CloningDesignState }) {
  const { insert, goldenGate, setGoldenGate, destinationOverhangs, tube, vector } = cloning;
  const enzymes = useMemo(() => goldenGateEnzymeNames(), []);
  const standards = useMemo(() => standardOverhangChoices(goldenGate.enzyme), [goldenGate.enzyme]);
  const width = overhangWidth(goldenGate.enzyme);
  const layout = useMemo(() => {
    const e = getEnzyme(goldenGate.enzyme);
    return e === undefined ? null : typeIISLayout(e);
  }, [goldenGate.enzyme]);

  const set = (next: Partial<GoldenGateMemory>): void => {
    setGoldenGate({ ...goldenGate, ...next });
  };
  const onChoice = (value: string): void => {
    if (value === CUSTOM_OVERHANGS) {
      set({ choice: value });
      return;
    }
    if (value === FROM_DESTINATION) {
      if (destinationOverhangs === null) return;
      set({
        choice: value,
        left: destinationOverhangs.left,
        right: destinationOverhangs.right,
      });
      return;
    }
    const found = standards.find((c) => c.id === value);
    if (found === undefined) return;
    set({ choice: value, left: found.left, right: found.right, enzyme: found.enzyme });
  };

  // A design made as the fields change, for the note only: nothing is kept
  // until Design primers is pressed.
  const preview = useMemo(() => {
    if (insert === null || !overhangsReady(goldenGate)) return null;
    return designGoldenGatePart(
      { insert, destination: vector, otherParts: tube },
      {
        enzyme: goldenGate.enzyme,
        secondEnzyme: goldenGate.second,
        left: goldenGate.left.trim().toUpperCase(),
        right: goldenGate.right.trim().toUpperCase(),
        includeStart: goldenGate.includeStart,
        includeStop: goldenGate.includeStop,
      },
    );
  }, [insert, vector, tube, goldenGate]);
  const bases = insert === null ? '' : insertSequence(insert).toUpperCase();

  const overhangField = (which: 'left' | 'right') => (
    <label className="panel__field panel__field--row">
      <span>{which === 'left' ? 'Left' : 'Right'}</span>
      <input
        className="panel__input panel__mono gg__oh"
        type="text"
        spellCheck={false}
        maxLength={8}
        aria-label={`${which === 'left' ? 'Left' : 'Right'} overhang, ${width.toString()} bases`}
        value={goldenGate[which]}
        onChange={(e) => {
          set({
            [which]: e.target.value.toUpperCase().replace(/[^ACGTacgt]/g, ''),
            choice: CUSTOM_OVERHANGS,
          });
        }}
      />
    </label>
  );

  return (
    <div className="gg">
      <div className="gg__row">
        <label className="panel__field panel__field--row">
          <span>Enzyme</span>
          <select
            className="panel__select"
            value={goldenGate.enzyme}
            onChange={(e) => {
              set({ enzyme: e.target.value });
            }}
          >
            {enzymes.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="panel__field panel__field--row">
          <span>and</span>
          <select
            className="panel__select"
            aria-label="Second enzyme in the tube"
            value={goldenGate.second}
            onChange={(e) => {
              set({ second: e.target.value });
            }}
          >
            <option value="">no other</option>
            {enzymes
              .filter((name) => name !== goldenGate.enzyme)
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </select>
        </label>
        {layout !== null && (
          <span className="dnote">
            <span className="panel__mono">{layout.site}</span> then {layout.spacer.toLocaleString()}{' '}
            base{layout.spacer === 1 ? '' : 's'} and a {layout.overhang.toLocaleString()}-base 5′
            overhang, from the enzyme table
          </span>
        )}
      </div>
      <div className="gg__row">
        <label className="panel__field panel__field--row">
          <span>Overhangs</span>
          <select
            className="panel__select"
            value={goldenGate.choice}
            onChange={(e) => {
              onChoice(e.target.value);
            }}
          >
            <option value="">Choose a pair…</option>
            <option value={FROM_DESTINATION} disabled={destinationOverhangs === null}>
              {destinationOverhangs === null
                ? `${goldenGate.enzyme} opens nothing in ${vector.name}`
                : `From ${vector.name}: ${destinationOverhangs.left}…${destinationOverhangs.right}`}
            </option>
            <optgroup label="Standard parts">
              {standards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
            <option value={CUSTOM_OVERHANGS}>Type my own…</option>
          </select>
        </label>
        {overhangField('left')}
        {overhangField('right')}
        <span className="dnote">
          {width.toLocaleString()} bases each, top strand; the right one as it reads on the top
          strand, not on the primer
        </span>
      </div>
      <div className="gg__row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={goldenGate.includeStart}
            onChange={(e) => {
              set({ includeStart: e.target.checked });
            }}
          />
          <span>Include the start codon</span>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={goldenGate.includeStop}
            onChange={(e) => {
              set({ includeStop: e.target.checked });
            }}
          />
          <span>Include the stop codon</span>
        </label>
        <span className="dnote">
          {bases.startsWith('ATG')
            ? 'The region begins with ATG'
            : 'The region does not begin with ATG'}
          {' · '}
          {/^(TAA|TAG|TGA)$/.test(bases.slice(-3))
            ? 'and ends with a stop codon'
            : 'and does not end with a stop codon'}
          . Leave the stop out so that a tag follows in frame.
        </span>
      </div>
      {preview !== null && (
        <p className="dnote gg__note" role="status">
          {preview.problem !== null ? (
            <span className="warns-danger">{preview.problem}</span>
          ) : (
            <>
              The part is {preview.part.length.toLocaleString()} bp:{' '}
              <span className="panel__mono">{preview.left}</span>
              {preview.overlap.left > 0
                ? ` (its last ${preview.overlap.left.toLocaleString()} bases are the part's own ${preview.overlap.left === 3 && goldenGate.includeStart ? 'start codon, so the primer anneals from the base after it' : 'first bases'})`
                : ''}{' '}
              … <span className="panel__mono">{preview.right}</span>
              {preview.trimmed.stop ? ', stop codon left out' : ''}
              {preview.trimmed.start ? ', start codon left out' : ''}.{' '}
              {preview.frame.coding && !preview.frame.stopped
                ? preview.frame.inFrame
                  ? `${preview.frame.length.toLocaleString()} coding bases to the right overhang: a whole number of codons, so what follows reads on in frame.`
                  : `${preview.frame.length.toLocaleString()} coding bases to the right overhang, which is not a whole number of codons.`
                : ''}{' '}
              PCR product {preview.productLength.toLocaleString()} bp.
            </>
          )}
          {preview.warnings
            .filter((w) => w.severity === 'danger')
            .map((w, i) => (
              <span key={`${w.kind}-${i.toString()}`} className="warns-danger gg__warn">
                {w.text}
              </span>
            ))}
        </p>
      )}
      <p className="dnote">
        {tube.length === 0
          ? `Simulate runs the PCR and the assembly into ${vector.name}; no other open tab holds a ${goldenGate.enzyme} part, so a set that needs more parts will say so.`
          : `In the tube with ${vector.name}: ${tube.map((d) => d.name).join(', ')}.`}
      </p>
    </div>
  );
}
