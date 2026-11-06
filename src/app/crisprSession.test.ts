// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';

import {
  INITIAL_CRISPR_SESSION,
  forgetCrisprSessions,
  readCrisprSession,
  updateCrisprSession,
  useCrisprSession,
} from './crisprSession';

describe('crisprSession', () => {
  afterEach(() => {
    forgetCrisprSessions();
  });

  it('starts every document from the initial session', () => {
    expect(readCrisprSession('a')).toBe(INITIAL_CRISPR_SESSION);
    expect(readCrisprSession(null)).toBe(INITIAL_CRISPR_SESSION);
  });

  it('keeps one session per document', () => {
    updateCrisprSession('a', { pam: 'NNGRRT', showFlagged: true });
    updateCrisprSession('b', { maxMismatches: 1 });
    expect(readCrisprSession('a')).toMatchObject({
      pam: 'NNGRRT',
      showFlagged: true,
      maxMismatches: 3,
    });
    expect(readCrisprSession('b')).toMatchObject({ pam: 'NGG', maxMismatches: 1 });
  });

  it('patches from the current session, one field leaving the rest', () => {
    updateCrisprSession('a', { pegEdit: { ...INITIAL_CRISPR_SESSION.pegEdit, position: '5' } });
    updateCrisprSession('a', (s) => ({ pegEdit: { ...s.pegEdit, insert: 'ACGT' } }));
    expect(readCrisprSession('a').pegEdit).toMatchObject({
      position: '5',
      insert: 'ACGT',
      replace: '1',
    });
  });

  it('lets a hook follow its document and forgets on request', () => {
    const { result } = renderHook(() => useCrisprSession('a'));
    expect(result.current.sortBy).toBe('position');
    act(() => {
      updateCrisprSession('a', { sortBy: 'gc' });
    });
    expect(result.current.sortBy).toBe('gc');
    act(() => {
      forgetCrisprSessions();
    });
    expect(result.current).toBe(INITIAL_CRISPR_SESSION);
  });
});
