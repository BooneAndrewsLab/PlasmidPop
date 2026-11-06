import { RunNotices } from './RunNotices';
import type { MultipleAlignmentRun } from './useMultipleAlignment';

/**
 * What a multiple alignment run says besides its progress (#373): the shared
 * `RunNotices` with the alignment's advice (its Cancel button is the run's
 * own).
 */
export function MsaRunNotices({ msa }: { readonly msa: MultipleAlignmentRun }) {
  const { error, stopped, slow, busy, retry } = msa;
  return (
    <RunNotices
      error={error}
      stopped={stopped}
      slow={slow}
      busy={busy}
      retry={retry}
      advice="align fewer or shorter sequences"
    />
  );
}
