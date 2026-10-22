// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';

import { SeqDocument } from '@/core';
import { type analysisClient } from '@/workers/analysisClient';

import { editorStore } from './editorStore';
import { RETRY_DELAYS_MS, useAnalysis } from './useAnalysis';

const { cutSites, orfs } = vi.hoisted(() => ({
  cutSites: vi.fn<typeof analysisClient.cutSitesWithDigest>(),
  orfs: vi.fn<typeof analysisClient.orfs>(),
}));
vi.mock('@/workers/analysisClient', () => ({
  analysisClient: { cutSitesWithDigest: cutSites, orfs },
}));
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
    const digest = { host: new Uint8Array(0), lengths: new Map(), counts: new Map() };
    cutSites
      .mockRejectedValueOnce(new Error('worker crashed'))
      .mockResolvedValue({ sites: [], digest });
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    expect(cutSites).toHaveBeenCalledTimes(1);
    // The ORFs, asked separately, are stored though the sites failed (#274).
    expect(editorStore.getState().analysis).toMatchObject({ cutSites: null, orfs: [] });
    await wait(RETRY_DELAYS_MS[0] ?? 0);
    expect(cutSites).toHaveBeenCalledTimes(2);
    expect(orfs).toHaveBeenCalledTimes(1);
    // The worker's digest is kept with the sites (item 98).
    expect(editorStore.getState().analysis).toMatchObject({ doc, digest, provisional: false });
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
    expect(editorStore.getState().error).toMatch(
      /Could not scan pX for restriction sites \(worker crashed\)/,
    );
    // And asks no more until something changes.
    await wait(10_000);
    expect(cutSites).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1);
  });

  it('stores the sites without waiting for the ORFs, and asks for each once (#274)', async () => {
    const digest = { host: new Uint8Array(0), lengths: new Map(), counts: new Map() };
    cutSites.mockResolvedValue({ sites: [], digest });
    let answer: (found: Awaited<ReturnType<typeof analysisClient.orfs>>) => void = () => undefined;
    orfs.mockReset().mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    expect(editorStore.getState().analysis).toMatchObject({ doc, digest, orfs: null });
    // The sites landing does not drop the ORF request in flight.
    await wait(1000);
    expect(orfs).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer([]);
      await Promise.resolve();
    });
    expect(editorStore.getState().analysis).toMatchObject({ digest, orfs: [] });
    expect(cutSites).toHaveBeenCalledTimes(1);
    expect(orfs).toHaveBeenCalledTimes(1);
  });

  it('names both scans when both give up', async () => {
    cutSites.mockRejectedValue(new Error('worker crashed'));
    orfs.mockReset().mockRejectedValue(new Error('worker crashed'));
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    for (const ms of RETRY_DELAYS_MS) await wait(ms);
    expect(editorStore.getState().error).toMatch(
      /Could not scan pX for restriction sites and ORFs \(worker crashed\)\. The digest waits/,
    );
  });
});
