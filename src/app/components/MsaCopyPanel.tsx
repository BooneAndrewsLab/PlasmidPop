import { useMemo, useState } from 'react';

import { copiedSummaryNote } from '../alignmentCopy';
import { analytics } from '../analytics';
import { copyText } from '../clipboard';
import {
  effectiveMsaOptions,
  loadMsaCopyOptions,
  msaCopyOutput,
  msaGapsKept,
  saveMsaCopyOptions,
  type MsaCopyContext,
  type MsaCopyOptions,
} from '../msaCopy';
import { MSA_CONSENSUS_ROW, msaSelectionColumns } from '../msaSelection';
import { CopyExtras, CopyPanelFrame } from './CopyPanelFrame';
import { SegmentedChoices } from './SegmentedChoices';

interface Props {
  readonly context: MsaCopyContext;
  /** Where the panel hangs from, in the window area's coordinates. */
  readonly left: number;
  readonly top: number;
  /** A copy was made: the line to show beside the window's tools. */
  readonly onCopied: (note: string) => void;
  readonly onClose: () => void;
}

/**
 * The multiple alignment's Advanced copy panel (#368), opened from the bar
 * beside a selection: rows, columns, gaps, format and extras composed from
 * options, with a preview of what the clipboard gets. The same frame as the
 * large view's panel; the choices are fewer, since every row here is an
 * equal sequence (no reference, no amino-acid strips). Remembered per browser.
 */
export function MsaCopyPanel({ context, left, top, onCopied, onClose }: Props) {
  const [options, setOptions] = useState<MsaCopyOptions>(() => loadMsaCopyOptions());
  const set = (patch: Partial<MsaCopyOptions>): void => {
    setOptions((o) => {
      const next = { ...o, ...patch };
      saveMsaCopyOptions(next);
      return next;
    });
  };
  const effective = effectiveMsaOptions(options);
  const output = useMemo(() => msaCopyOutput(options, context), [options, context]);
  const selected = msaSelectionColumns(context.columns, context.selection);
  const selectedColumns = selected === null ? 0 : selected.end - selected.start;
  const onConsensus = context.selection.row === MSA_CONSENSUS_ROW;

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
            label: onConsensus ? 'Consensus' : 'This row',
            title: 'The row the selection is on',
          },
          {
            value: 'sequences',
            label: `All ${context.rows.length.toLocaleString()}`,
            title: 'Every sequence, in register',
          },
          {
            value: 'with-consensus',
            label: 'With consensus',
            title: 'The consensus row, then every sequence, in register',
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
            label: `All ${context.columns.toLocaleString()}`,
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
        disabled={msaGapsKept(options)}
        disabledTitle="Several rows stay in register, so their gaps are kept"
        choices={[
          { value: 'kept', label: 'Kept as -', title: 'The row as drawn, gaps as -' },
          { value: 'dropped', label: 'Dropped', title: "The row's own letters only, as Ctrl+C" },
        ]}
        onChange={(gaps) => {
          set({ gaps });
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
        fasta={effective.format === 'fasta'}
        names={effective.names}
        coordinates={effective.coordinates}
        coordinatesTip="Which columns these are, and each row's own residue numbers"
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
