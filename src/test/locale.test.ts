// The suite expects English number formatting ('4,991–10'), while the app
// formats with the reader's own locale on purpose. `npm test` pins the
// locale in scripts/with-tmp.mjs; a bare `npx vitest` does not, and the
// locale cannot be changed once Node has started. One clear failure here
// beats dozens of separator mismatches elsewhere (#435).
describe('test run locale', () => {
  it('is English, as `npm test` pins it', () => {
    const resolved = Intl.NumberFormat().resolvedOptions().locale;
    const grouped = (5000).toLocaleString();
    const hint =
      `The test run resolved the locale "${resolved}" and formats 5000 as "${grouped}". ` +
      'The tests expect English separators. Run the suite with `npm test` ' +
      '(scripts/with-tmp.mjs pins LC_ALL=en_US.UTF-8), or set LC_ALL=en_US.UTF-8 ' +
      'in the shell before a bare vitest. See issue #435.';
    expect(resolved.startsWith('en'), hint).toBe(true);
    expect(grouped, hint).toBe('5,000');
  });
});
