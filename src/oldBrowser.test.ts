// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A browser older than the build target gets a message instead of a blank
// page (#291): the inline script in index.html, run here the way a browser
// would, against user agents and a RegExp that cannot parse lookbehind.
const html = readFileSync('index.html', 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

const SAFARI15_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15';
const IPHONE15 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const CHROME90 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36';
const EDGE90 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36 Edg/90.0.818.66';
const FIREFOX100 = 'Mozilla/5.0 (X11; Linux x86_64; rv:100.0) Gecko/20100101 Firefox/100.0';

/** The page's markup, then the inline script, with the browser's lookbehind support and agent as given. */
function load(ua: string, lookbehind: boolean): void {
  document.documentElement.innerHTML = `<body><div id="root"></div>${/<div id="old-browser"[\s\S]*?<\/section>\s*<\/div>/.exec(html)?.[0] ?? ''}</body>`;
  document.body.className = '';
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  const Real = RegExp;
  if (!lookbehind) {
    vi.stubGlobal(
      'RegExp',
      new Proxy(Real, {
        construct(target, args: [string | RegExp, string?]) {
          if (typeof args[0] === 'string' && args[0].includes('(?<')) {
            throw new SyntaxError('Invalid regular expression: invalid group specifier name');
          }
          return new target(...args);
        },
      }),
    );
  }
  // jsdom has no module scripts; every browser this is for besides the oldest has.
  vi.stubGlobal('HTMLScriptElement', { prototype: { noModule: false } });
  // The classic inline script, run the way a browser runs it.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call
  new Function(script)();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const box = (): HTMLElement => {
  const el = document.getElementById('old-browser');
  if (el === null) throw new Error('no message in the page');
  return el;
};
const shown = (): string[] =>
  [...box().querySelectorAll('section')]
    .filter((s) => !s.hidden)
    .map((s) => s.getAttribute('data-for') ?? '');

describe('the too-old-browser message (#291)', () => {
  it('has a script to test', () => {
    expect(script).toContain('old-browser');
    // Old syntax only: no arrow functions, let/const or template literals.
    expect(script).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });

  it('shows nothing in a browser that parses lookbehind', () => {
    load(CHROME90, true);
    expect(box().hidden).toBe(true);
    expect(document.getElementById('root')?.hidden).toBe(false);
  });

  it.each([
    [SAFARI15_MAC, 'safari-mac', 'Safari 15.0'],
    [IPHONE15, 'ios', 'Safari on iOS 15'],
    [CHROME90, 'chrome', 'Chrome 90'],
    [EDGE90, 'edge', 'Edge 90'],
    [FIREFOX100, 'firefox', 'Firefox 100'],
  ])('names the browser and says how to update it (%#)', (ua, kind, name) => {
    load(ua, false);
    expect(box().hidden).toBe(false);
    expect(document.getElementById('old-browser-name')?.textContent).toBe(name);
    expect(shown()).toEqual([kind]);
    expect(document.getElementById('root')?.hidden).toBe(true);
  });

  it('gives only the Safari steps, with the warning not to upgrade macOS', () => {
    load(SAFARI15_MAC, false);
    expect(box().textContent).toContain('Do not click Upgrade Now');
    const steps = [...box().querySelectorAll('section')]
      .filter((x) => !x.hidden)
      .map((x) => x.textContent)
      .join(' ');
    expect(steps).toContain('Software Update');
    expect(steps).not.toContain('chrome://settings');
  });

  it('falls back to the supported list for an unknown browser', () => {
    load('SomeBrowser/1.0', false);
    expect(box().hidden).toBe(false);
    expect(shown()).toEqual([]);
    expect(box().textContent).toContain('Safari 16.4');
  });

  it('shows it when the bundle fails to parse, and only before anything is drawn', () => {
    load(CHROME90, true);
    const fail = (): void => {
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'Uncaught SyntaxError: bad', error: new SyntaxError() }),
      );
    };
    document.getElementById('root')?.append(document.createElement('div'));
    fail();
    expect(box().hidden).toBe(true);
    document.getElementById('root')?.replaceChildren();
    fail();
    expect(box().hidden).toBe(false);
  });
});
