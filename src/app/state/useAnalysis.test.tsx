// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';

import { SeqDocument } from '@/core';
import { type analysisClient } from '@/workers/analysisClient';

import { useDocumentChecksum } from './documentChecksum';
import { editorStore } from './editorStore';
import { RETRY_DELAYS_MS, useAnalysis } from './useAnalysis';

const { cutSites, orfs, checksum } = vi.hoisted(() => ({
  cutSites: vi.fn<typeof analysisClient.cutSitesWithDigest>(),
  orfs: vi.fn<typeof analysisClient.orfs>(),
  checksum: vi.fn<typeof analysisClient.checksum>(),
}));
vi.mock('@/workers/analysisClient', () => ({
  analysisClient: { cutSitesWithDigest: cutSites, orfs, checksum },
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

  it('asks only for the ORFs again when an ORF setting changes (#275)', async () => {
    const digest = { host: new Uint8Array(0), lengths: new Map(), counts: new Map() };
    cutSites.mockResolvedValue({ sites: [], digest });
    renderHook(() => {
      useAnalysis();
    });
    await wait(150);
    expect(editorStore.getState().analysis).toMatchObject({ digest, orfs: [] });
    const minCodons = editorStore.getState().orfMinCodons;
    try {
      act(() => {
        editorStore.setOrfMinCodons(minCodons + 1);
      });
      expect(editorStore.getState().analysis).toMatchObject({ digest, orfs: null });
      await wait(1000);
      expect(orfs).toHaveBeenCalledTimes(2);
      expect(orfs.mock.calls[1]?.[2]).toMatchObject({ minCodons: minCodons + 1 });
      expect(cutSites).toHaveBeenCalledTimes(1);
      expect(editorStore.getState().analysis).toMatchObject({ digest, orfs: [] });
    } finally {
      act(() => {
        editorStore.setOrfMinCodons(minCodons);
      });
    }
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

describe('useAnalysis: what goes to the worker first (#276)', () => {
  const digest = { host: new Uint8Array(0), lengths: new Map(), counts: new Map() };
  /** Which request reached the worker when, in the order they were sent. */
  let sent: string[] = [];

  /** The status bar's checksum, in a child as in the app, so its effect runs first. */
  function Checksum(): ReactNode {
    useDocumentChecksum(editorStore.getState().history?.present ?? null);
    return null;
  }
  function App(): ReactNode {
    useAnalysis();
    return <Checksum />;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    cutSites.mockReset().mockImplementation(() => {
      sent.push('sites');
      return Promise.resolve({ sites: [], digest });
    });
    orfs.mockReset().mockImplementation(() => {
      sent.push('orfs');
      return Promise.resolve([]);
    });
    checksum.mockReset().mockImplementation(() => {
      sent.push('checksum');
      return Promise.resolve(null);
    });
    act(() => {
      editorStore.dismissError();
    });
  });

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.dismissError();
    });
    vi.useRealTimers();
  });

  /** Large enough that the status bar asks the worker for its checksum. */
  function large(name: string): SeqDocument {
    return SeqDocument.create({ name, sequence: 'ACGTTGCA'.repeat(10_000) });
  }

  it('sends the restriction scan of a document just opened before its checksum', async () => {
    act(() => {
      editorStore.openDocument(large('pBig'));
    });
    render(<App />);
    // Sent in the effect, before any timer has run.
    expect(sent).toEqual(['sites']);
    await wait(0);
    expect(sent).toEqual(['sites', 'checksum']);
    await wait(150);
    expect(sent).toEqual(['sites', 'checksum', 'orfs']);
  });

  it('still waits the beat after an edit', async () => {
    act(() => {
      editorStore.openDocument(large('pBig'));
    });
    render(<App />);
    await wait(1000);
    sent = [];
    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    await wait(149);
    expect(sent).toEqual(['checksum']);
    await wait(1);
    expect(sent).toEqual(['checksum', 'sites', 'orfs']);
  });

  it('waits the beat for a document undone to, whose results it no longer holds', async () => {
    act(() => {
      editorStore.openDocument(large('pBig'));
    });
    render(<App />);
    await wait(1000);
    act(() => {
      // Not mappable: nothing is carried through it.
      editorStore.apply({ type: 'reverseComplement' });
    });
    await wait(1000);
    sent = [];
    act(() => {
      editorStore.undo();
    });
    expect(sent).toEqual([]);
    await wait(150);
    expect(sent).toEqual(['sites', 'orfs']);
  });
});
