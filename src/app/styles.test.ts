import { readFileSync } from 'node:fs';

// `?raw` gives an empty string here: Vitest stubs CSS imports. Read the file.
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const at = styles.indexOf(`\n${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const open = styles.indexOf('{', at);
  const close = styles.indexOf('}', open);
  return styles.slice(open + 1, close);
}

describe('the visually-hidden utility (#100)', () => {
  // Absolute positioning would place it at its static position with the page
  // as its containing block, since nothing above it is positioned. Inside a
  // list that scrolls inside itself — the fragments of a digest — the hidden
  // live region of a row then sits far down the document instead of being
  // clipped by the list, and the window itself gets a scrollbar. A fixed box
  // is outside the page's scrollable overflow, whatever is above it.
  it('is fixed, so it cannot escape a scrolling list and lengthen the page', () => {
    const declarations = rule('.visually-hidden');
    expect(declarations).toMatch(/position:\s*fixed/);
    expect(declarations).not.toMatch(/position:\s*absolute/);
  });

  it('is still a pixel, clipped, and out of the way', () => {
    const declarations = rule('.visually-hidden');
    expect(declarations).toMatch(/width:\s*1px/);
    expect(declarations).toMatch(/height:\s*1px/);
    expect(declarations).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(declarations).toMatch(/overflow:\s*hidden/);
  });
});
