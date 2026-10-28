// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';

import { persistenceSentence } from '@/storage';

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
  kind: 'file' as const,
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

describe('StoragePanel iOS warning (#297)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says the installed app starts empty and to back up first', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );
    render(<StoragePanel documents={[summary(Date.now())]} onChanged={() => undefined} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/installed app has its own, empty storage/);
    expect(alert).toHaveTextContent(/Back up all documents here first/);
    expect(alert).toHaveTextContent(/Restore from backup in the installed app/);
  });
});

describe('persistenceSentence (#292)', () => {
  it('states the promise only where the seven-day cap does not apply', () => {
    expect(persistenceSentence(true, false)).toBe('The browser has agreed to keep them.');
    expect(persistenceSentence(true, true)).toBe('');
  });
  it('keeps the low-disk warning and says nothing when unknown', () => {
    expect(persistenceSentence(false, true)).toMatch(/may clear them/);
    expect(persistenceSentence(false, false)).toMatch(/may clear them/);
    expect(persistenceSentence(null, false)).toBe('');
  });
});
