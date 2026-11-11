import { useState } from 'react';

/**
 * The state of importing one file the user picked or dropped: whether it is
 * being read, what came of it, or why it failed. `read` does the work (the
 * imports go through `persistence`); `take` is what a file drop calls, and
 * ignores a missing file. A new file clears the last summary and error. `fail` is
 * for a caller's other actions that report into the same line.
 */
export function useFileImport<T>(read: (file: File) => Promise<T>): {
  readonly busy: boolean;
  readonly summary: T | null;
  readonly error: string | null;
  readonly take: (file: File | undefined) => void;
  readonly fail: (message: string) => void;
} {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const take = (file: File | undefined): void => {
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    read(file)
      .then((s) => {
        setSummary(s);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return { busy, summary, error, take, fail: setError };
}
