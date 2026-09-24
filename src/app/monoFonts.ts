/**
 * Monospace fonts a scientist's computer is likely to have, by the name CSS
 * knows them by. The Format menu offers the ones found installed (#29):
 * nobody knows a font's name off the top of their head, and a proportional
 * one would leave the columns of bases ragged, so the list is both the help
 * and the guard.
 */
export const MONO_FONT_CANDIDATES: readonly string[] = [
  'Andale Mono',
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Courier New',
  'DejaVu Sans Mono',
  'Droid Sans Mono',
  'Fira Code',
  'Fira Mono',
  'Hack',
  'IBM Plex Mono',
  'Inconsolata',
  'JetBrains Mono',
  'Liberation Mono',
  'Lucida Console',
  'Menlo',
  'Monaco',
  'Noto Sans Mono',
  'Roboto Mono',
  'SF Mono',
  'Source Code Pro',
  'Ubuntu Mono',
];

const PROBE = 72;
const FALLBACKS = ['monospace', 'serif', 'sans-serif'] as const;

let found: readonly string[] | null = null;

/**
 * Which of the candidates are installed and monospaced, measured once per
 * page load. A font is installed when a line drawn in it, with a generic
 * family behind it, is not as wide as the generic alone for every one of
 * them (the browser fell back when it is); it is monospace when a run of
 * `i` and a run of `M` come out the same width. Nothing is asked of the
 * user and nothing leaves the page: the Local Font Access API would list
 * everything, behind a permission prompt this is not worth.
 */
export function installedMonoFonts(): readonly string[] {
  if (found !== null) return found;
  const ctx =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (ctx === null) return (found = []);
  const width = (font: string, text: string): number => {
    ctx.font = `${PROBE}px ${font}`;
    return ctx.measureText(text).width;
  };
  const sample = 'mmmmmmmmmmlli0OWQ';
  found = MONO_FONT_CANDIDATES.filter((name) => {
    const installed = FALLBACKS.some(
      (base) => width(`"${name}", ${base}`, sample) !== width(base, sample),
    );
    if (!installed) return false;
    const family = `"${name}", monospace`;
    return Math.abs(width(family, 'iiiiiiiiii') - width(family, 'MMMMMMMMMM')) < 0.5;
  });
  return found;
}

/** Forgets what was measured, for tests. */
export function forgetMonoFonts(): void {
  found = null;
}
