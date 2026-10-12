// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';

import { StoragePanel } from './StoragePanel';

const DAY = 24 * 60 * 60 * 1000;
const summary = (updatedAt: number) => ({
  id: 'a',
  name: 'a',
  fileName: null,
  length: 4,
  topology: 'linear' as const,
  alphabet: 'nucleotide' as const,
  featureCount: 0,
  updatedAt,
});

describe('StoragePanel (#203)', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it('says there is no backup yet and offers both actions', () => {
    render(<StoragePanel documents={[summary(Date.now())]} onChanged={() => undefined} />);
    expect(screen.getByText(/1 document is stored/)).toBeInTheDocument();
    expect(screen.getByText(/Never backed up/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back up all documents…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore from backup…' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns about changes no backup holds once they are a week old', () => {
    render(
      <StoragePanel documents={[summary(Date.now() - 8 * DAY)]} onChanged={() => undefined} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/not in any backup/);
  });
});
