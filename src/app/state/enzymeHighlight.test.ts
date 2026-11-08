import { describe, expect, it } from 'vitest';

import { withHighlighted } from './enzymeHighlight';

describe('withHighlighted', () => {
  it('returns the ticked set itself when nothing is highlighted', () => {
    const shown = new Set(['EcoRI']);
    expect(withHighlighted(shown, new Set())).toBe(shown);
  });

  it('adds the highlighted enzymes to the ticked ones', () => {
    const shown = new Set(['EcoRI']);
    const both = withHighlighted(shown, new Set(['BamHI', 'EcoRI']));
    expect([...both].sort()).toEqual(['BamHI', 'EcoRI']);
    expect(shown.size).toBe(1);
  });

  it('draws a highlighted enzyme when none is ticked', () => {
    expect([...withHighlighted(new Set(), new Set(['KpnI']))]).toEqual(['KpnI']);
  });
});
