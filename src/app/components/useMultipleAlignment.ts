import { useEffect, useRef, useState } from 'react';

import type { Alphabet, MultipleAlignment } from '@/core';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';

/** A multiple alignment made, with the names its rows go by. */
export interface ShownMsa {
  readonly names: readonly string[];
  readonly alignment: MultipleAlignment;
}

export interface MultipleAlignmentRun {
  readonly busy: boolean;
  /** Fraction done, 0 to 1. */
  readonly progress: number;
  readonly error: string | null;
  /** The alignment to show in its window; `null` once dismissed. */
  readonly shown: ShownMsa | null;
  readonly run: (
    names: readonly string[],
    sequences: readonly string[],
    alphabet: Alphabet,
  ) => void;
  readonly cancel: () => void;
  readonly dismiss: () => void;
}

/**
 * One multiple alignment at a time in the worker (#207): the Align tab's
 * group and the window with no document (#369) share the run, the progress,
 * the cancel and the result the `MsaDialog` shows. Going away stops a run
 * nobody would see the end of.
 */
export function useMultipleAlignment(): MultipleAlignmentRun {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<ShownMsa | null>(null);
  const running = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      running.current?.abort();
    },
    [],
  );

  const run = (
    names: readonly string[],
    sequences: readonly string[],
    alphabet: Alphabet,
  ): void => {
    if (running.current !== null) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(0);
    setError(null);
    analytics.track('align', 'msa', alphabet);
    analysisClient
      .alignMultiple(
        sequences,
        { alphabet },
        { onProgress: setProgress, signal: controller.signal },
      )
      .then((alignment) => {
        setShown({ names, alignment });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
        setBusy(false);
      });
  };

  return {
    busy,
    progress,
    error,
    shown,
    run,
    cancel: () => {
      running.current?.abort();
    },
    dismiss: () => {
      setShown(null);
    },
  };
}
