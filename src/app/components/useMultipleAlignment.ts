import { useEffect, useRef, useState } from 'react';

import type { Alphabet, MultipleAlignment } from '@/core';
import {
  AnalysisCancelledError,
  AnalysisWorkerError,
  analysisClient,
} from '@/workers/analysisClient';

import { analytics } from '../analytics';

/** How long a run goes on before it says it is taking a while, and offers Cancel (#373). */
export const SLOW_RUN_MS = 15_000;

/** A run the worker's failure ended: what the event said, and whether Try again is still offered. */
export interface StoppedRun {
  readonly detail: string;
  readonly canRetry: boolean;
}

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
  /** The worker failed outright on the run (#373); `null` otherwise. */
  readonly stopped: StoppedRun | null;
  /** The run has gone on longer than `SLOW_RUN_MS`. */
  readonly slow: boolean;
  /** The alignment to show in its window; `null` once dismissed. */
  readonly shown: ShownMsa | null;
  readonly run: (
    names: readonly string[],
    sequences: readonly string[],
    alphabet: Alphabet,
  ) => void;
  /** Sends the stopped run again, once. */
  readonly retry: () => void;
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
  const [stopped, setStopped] = useState<StoppedRun | null>(null);
  const [slow, setSlow] = useState(false);
  const [shown, setShown] = useState<ShownMsa | null>(null);
  const running = useRef<AbortController | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What was last asked, for Try again. */
  const last = useRef<{
    names: readonly string[];
    sequences: readonly string[];
    alphabet: Alphabet;
  } | null>(null);

  useEffect(
    () => () => {
      running.current?.abort();
      if (slowTimer.current !== null) clearTimeout(slowTimer.current);
    },
    [],
  );

  const start = (
    names: readonly string[],
    sequences: readonly string[],
    alphabet: Alphabet,
    retried: boolean,
  ): void => {
    if (running.current !== null) return;
    const controller = new AbortController();
    running.current = controller;
    last.current = { names, sequences, alphabet };
    setBusy(true);
    setProgress(0);
    setError(null);
    setStopped(null);
    setSlow(false);
    slowTimer.current = setTimeout(() => {
      setSlow(true);
    }, SLOW_RUN_MS);
    if (!retried) analytics.track('align', 'msa', alphabet);
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
        // The worker's own failure is told apart: the text is short and the
        // cause behind a details line; Try again once, never in a loop (#373).
        if (e instanceof AnalysisWorkerError) setStopped({ detail: e.message, canRetry: !retried });
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (running.current === controller) running.current = null;
        if (slowTimer.current !== null) clearTimeout(slowTimer.current);
        slowTimer.current = null;
        setSlow(false);
        setBusy(false);
      });
  };

  const run = (
    names: readonly string[],
    sequences: readonly string[],
    alphabet: Alphabet,
  ): void => {
    start(names, sequences, alphabet, false);
  };

  return {
    busy,
    progress,
    error,
    stopped,
    slow,
    shown,
    run,
    retry: () => {
      if (last.current !== null && stopped?.canRetry === true) {
        start(last.current.names, last.current.sequences, last.current.alphabet, true);
      }
    },
    cancel: () => {
      running.current?.abort();
    },
    dismiss: () => {
      setShown(null);
    },
  };
}
