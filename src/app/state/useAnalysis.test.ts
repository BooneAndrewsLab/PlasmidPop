// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';

import { SeqDocument } from '@/core';
import { type analysisClient } from '@/workers/analysisClient';

import { editorStore } from './editorStore';
import { RETRY_DELAYS_MS, useAnalysis } from './useAnalysis';

const { cutSites, orfs } = vi.hoisted(() => ({
  cutSites: vi.fn<typeof analysisClient.cutSites>(),
  orfs: vi.fn<typeof analysisClient.orfs>(),
}));
vi.mock('@/workers/analysisClient', () => ({ analysisClient: { cutSites, orfs } }));
const doc = SeqDocument.create({ name: 'pX', sequence: 'ACGTACGTAC' });

/** Lets the debounce or a retry fire, and the promises it starts settle. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAnalysis (#138)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cutSites.mockReset();
    orfs.mockReset().mockResolvedValue([]);
    act(() => {
      editorStore.dismissError();
      editorStore.openDocument(doc);
    });
  });

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.dismissError();
    });
    vi.useRealTimers();
  });

  it('tries a failed scan again and keeps the result it then gets', async () => {
    cutSites.mockRejectedValueOnce(new Error('worker crashed')).mockResolvedValue([]);
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    expect(cutSites).toHaveBeenCalledTimes(1);
    expect(editorStore.getState().analysis).toBeNull();
    await wait(RETRY_DELAYS_MS[0] ?? 0);
    expect(cutSites).toHaveBeenCalledTimes(2);
    expect(editorStore.getState().analysis).toMatchObject({ doc, provisional: false });
    expect(editorStore.getState().error).toBeNull();
  });

  it('says so when every try fails, rather than staying quiet', async () => {
    cutSites.mockRejectedValue(new Error('worker crashed'));
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    for (const ms of RETRY_DELAYS_MS) await wait(ms);
    expect(cutSites).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
    expect(editorStore.getState().error).toMatch(/Could not scan pX .*worker crashed/);
    // And asks no more until something changes.
    await wait(10_000);
    expect(cutSites).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });
});
