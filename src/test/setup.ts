import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { relative } from 'node:path';

import { act, cleanup } from '@testing-library/react';

import { forgetPanels } from '@/app/state/panelMemory';

import { actWarningBudget } from './actWarningBudget';

// In a mutation run's `shared` project the files share their globals and
// modules (item 50), and Stryker's runner gives each file's results the
// coverage record it finds on its global, the whole run's so far: every
// file then carried all the files before it, and the dry run ran out of
// memory. Each file starts with the record emptied: the same object, since
// an instrumented module keeps the record it first wrote to, with new maps
// in it. The file before has been sent by then; the runner sums the files.
const coverage = (
  globalThis as {
    __stryker__?: { mutantCoverage?: { static: object; perTest: object } };
  }
).__stryker__?.mutantCoverage;
if (process.env['PLASMIDPOP_MUTATION'] === '1' && coverage !== undefined) {
  coverage.static = {};
  coverage.perTest = {};
}

// jsdom has no canvas: `getContext` returns null, which every view already
// handles (the drawing is tested through `SvgContext` instead), but it also
// prints "Not implemented … without installing the canvas npm package" for
// every call — some 400 lines per run. Returning null without the message
// keeps the behaviour and the log clean. Installing `canvas` instead would
// pull a native build into CI to draw pixels no test looks at.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

afterEach(() => {
  cleanup();
  // What the sidebar panels remember lasts a page load; a test is one.
  forgetPanels();
});

// Results arrive after the test body that asked for them (the analysis
// scans, the custom enzyme and codon tables read from storage), and the
// store then re-renders every component that reads it outside `act`: React
// warned some 3,500 times a run (#324), burying real failures in the CI
// log. They arrive the same way in the app, where there is no `act`; in a
// DOM test they are delivered inside one. (Wrapping every store commit
// instead breaks tests that commit during a render.)
if (typeof window !== 'undefined') {
  const { EditorStore } = await import('@/app/state/editorStore');
  const methods = EditorStore.prototype as unknown as Record<
    string,
    ((this: unknown, ...args: unknown[]) => void) | undefined
  >;
  for (const method of [
    'setAnalysis',
    'setCutSites',
    'setOrfs',
    'setCustomCodonTables',
    'setCustomStandards',
    'setEnzymeSetInfo',
  ]) {
    const original = methods[method];
    if (original === undefined) continue;
    methods[method] = function inAct(this: unknown, ...args: unknown[]): void {
      act(() => {
        original.apply(this, args);
      });
    };
  }
}

// A DOM test file may print no more act warnings than its budget says,
// which is zero unless `actWarningBudget` names it, so a new one fails the
// file instead of joining the noise (#324).
if (typeof window !== 'undefined') {
  let warnings = 0;
  const forward = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) warnings++;
    forward(...args);
  };
  afterAll(() => {
    const path = relative(process.cwd(), expect.getState().testPath ?? '').replaceAll('\\', '/');
    const allowed = actWarningBudget[path] ?? 0;
    if (warnings > allowed) {
      throw new Error(
        `${path} printed ${warnings} "not wrapped in act(...)" warnings, over its budget of ${allowed}: ` +
          `wrap what updates state in act (or await it) rather than raising the budget (#324)`,
      );
    }
  });
}
