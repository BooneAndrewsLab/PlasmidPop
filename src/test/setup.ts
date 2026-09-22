import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

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
});
