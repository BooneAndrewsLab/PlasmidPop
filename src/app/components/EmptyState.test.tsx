// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';

import { persistence } from '../state/persistence';
import { EmptyState } from './EmptyState';

describe('EmptyState licence line', () => {
  it('names the MIT licence and links to LICENSE and the source', async () => {
    // Settle the recent-files listing inside the test: left to resolve on its
    // own, a loaded machine lands its setState after jsdom is torn down.
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    render(<EmptyState />);
    await act(() => listed);
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
