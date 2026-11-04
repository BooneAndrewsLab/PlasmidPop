import { useMemo, useState } from 'react';

import {
  copiedSummaryNote,
  copyLimits,
  copyOutput,
  effectiveOptions,
  loadCopyOptions,
  optionsForSelection,
  saveCopyOptions,
  type CopyContext,
  type CopyOptions,
} from '../alignmentCopy';
import { analytics } from '../analytics';
import type { ResidueFrame } from '../alignmentResidues';
import { REFERENCE_ROW, selectionColumns, type AlignmentSelection } from '../alignmentSelection';
import type { Stack } from '../alignmentStack';
import { copyText } from '../clipboard';
import { CopyExtras, CopyPanelFrame } from './CopyPanelFrame';
import { SegmentedChoices } from './SegmentedChoices';

interface Props {
  readonly stack: Stack;
  readonly frames: readonly ResidueFrame[] | null;
  readonly referenceName: string;
  readonly selection: AlignmentSelection;
  /** Where the panel hangs from, in the `.astack`'s coordinates. */
  readonly left: number;
  readonly top: number;
  /** A copy was made: the line to show under the alignment. */
  readonly onCopied: (note: string) => void;
  readonly onClose: () => void;
}

/**
 * The Advanced copy panel (#366), opened from the bar beside a selection:
 * rows, columns, gaps, tracks, format and extras composed from options,
 * with a preview of what the clipboard gets. A choice the others rule out
 * is greyed with the reason, and the copy is what the preview shows. The
 * options are remembered per browser; the track opens on the strip the
 * selection is on. One of the `astack-pop` family, hung from the bar.
 */
export function AlignmentCopyPanel({
  stack,
  frames,
  referenceName,
  selection,
  left,
  top,
  onCopied,
  onClose,
}: Props) {
  const [options, setOptions] = useState<CopyOptions>(() =>
    optionsForSelection(loadCopyOptions(), selection),
  );
  const set = (patch: Partial<CopyOptions>): void => {
    setOptions((o) => {
      const next = { ...o, ...patch };
      saveCopyOptions(next);
      return next;
    });
  };
  const ctx = useMemo<CopyContext>(
    () => ({ stack, frames, referenceName, selection }),
    [stack, frames, referenceName, selection],
  );
  const limits = copyLimits(options, ctx);
  const effective = effectiveOptions(options, ctx);
  const output = useMemo(() => copyOutput(options, ctx), [options, ctx]);
  const selected = selectionColumns(stack, selection);
  const selectedColumns = selected === null ? 0 : selected.end - selected.start;
  const onReference = selection.row === REFERENCE_ROW;
  const fasta = effective.format === 'fasta';

  const copy = (): void => {
    if (output.text === '') return;
    copyText(output.text);
    analytics.track('alignment-selection', 'copy', effective.format);
    onCopied(copiedSummaryNote(output, effective.format));
    onClose();
  };

  return (
    <CopyPanelFrame
      left={left}
      top={top}
      output={output}
      emptyReason="the row has no residues in these columns"
      onCopy={copy}
      onClose={onClose}
    >
      <span>Rows</span>
      <SegmentedChoices
        small
        label="Rows"
        value={effective.rows}
        choices={[
          {
            value: 'selected',
            label: onReference ? 'Reference' : 'This row',
            title: 'The row the selection is on',
          },
          {
            value: 'with-reference',
            label: 'With reference',
            title: 'The reference above the row, the two in register',
            disabled: limits.onReference,
            disabledTitle: 'The selection is on the reference',
          },
          {
            value: 'all',
            label: `All ${(stack.rows.length + 1).toLocaleString()}`,
            title: 'The reference and every sample shown, in register',
          },
        ]}
        onChange={(rows) => {
          set({ rows });
        }}
      />
      <span>Columns</span>
      <SegmentedChoices
        small
        label="Columns"
        value={effective.columns}
        choices={[
          {
            value: 'selection',
            label: `Selection (${selectedColumns.toLocaleString()})`,
            title: 'The selected columns',
          },
          {
            value: 'all',
            label: `All ${stack.columns.toLocaleString()}`,
            title: 'Every column of the alignment',
          },
        ]}
        onChange={(columns) => {
          set({ columns });
        }}
      />
      <span>Gaps</span>
      <SegmentedChoices
        small
        label="Gaps"
        value={effective.gaps}
        disabled={limits.gapsKept}
        disabledTitle="Several rows stay in register, so their gaps are kept"
        choices={[
          {
            value: 'kept',
            label: 'Kept as -',
            title: 'The row as drawn: gaps, and columns the sample does not reach, as -',
          },
          {
            value: 'dropped',
            label: 'Dropped',
            title: "The row's own residues only, as Ctrl+C",
          },
        ]}
        onChange={(gaps) => {
          set({ gaps });
        }}
      />
      <span>Tracks</span>
      <SegmentedChoices
        small
        label="Tracks"
        value={effective.tracks}
        disabled={limits.basesOnly}
        disabledTitle="Turn on Amino acids ▸ Residues to copy amino acids"
        choices={[
          { value: 'bases', label: 'Bases' },
          {
            value: 'aa',
            label: 'Amino acids',
            title: 'The amino acids of the codons the columns touch, one line per CDS',
          },
          { value: 'both', label: 'Both', title: 'Each row’s bases, then its amino acids' },
        ]}
        onChange={(tracks) => {
          set({ tracks });
        }}
      />
      <span>Format</span>
      <SegmentedChoices
        small
        label="Format"
        value={effective.format}
        choices={[
          { value: 'text', label: 'Text', title: 'One sequence per line' },
          { value: 'fasta', label: 'FASTA', title: 'A named record per sequence, 60 per line' },
        ]}
        onChange={(format) => {
          set({ format });
        }}
      />
      <span>Extras</span>
      <CopyExtras
        fasta={fasta}
        names={effective.names}
        coordinates={effective.coordinates}
        coordinatesTip="Which columns these are, and the reference positions they span"
        onNames={(names) => {
          set({ names });
        }}
        onCoordinates={(coordinates) => {
          set({ coordinates });
        }}
      />
    </CopyPanelFrame>
  );
}
