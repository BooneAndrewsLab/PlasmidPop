import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

import { forgetPanels } from '@/app/state/panelMemory';

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
