import { RAIL_TAB_CHROME, railLabelsFit } from './railFit';

describe('railLabelsFit (#292)', () => {
  const labels = [50, 60, 40];
  const needed = 150 + 3 * RAIL_TAB_CHROME;

  it('fits when the rail is as tall as the tabs at full length', () => {
    expect(railLabelsFit(needed, labels)).toBe(true);
    expect(railLabelsFit(needed + 100, labels)).toBe(true);
  });
  it('does not fit one pixel short', () => {
    expect(railLabelsFit(needed - 1, labels)).toBe(false);
  });
  it('follows the number of tabs', () => {
    expect(railLabelsFit(needed, [...labels, 30])).toBe(false);
    expect(railLabelsFit(needed, labels.slice(0, 2))).toBe(true);
  });
  it('says nothing where nothing is laid out', () => {
    expect(railLabelsFit(0, labels)).toBe(true);
  });
});
