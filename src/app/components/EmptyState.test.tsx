// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';

import { EmptyState } from './EmptyState';

describe('EmptyState licence line', () => {
  it('names the MIT licence and links to LICENSE and the source', () => {
    render(<EmptyState />);
    const licence = screen.getByRole('link', { name: 'MIT licence' });
    expect(licence.getAttribute('href')).toBe(
      'https://github.com/BooneAndrewsLab/PlasmidPop/blob/main/LICENSE',
    );
    const source = screen.getByRole('link', { name: 'source is on GitHub' });
    expect(source.getAttribute('href')).toBe('https://github.com/BooneAndrewsLab/PlasmidPop');
    expect(licence.closest('p')?.textContent).toContain(
      'Free and open source under the MIT licence',
    );
  });
});
