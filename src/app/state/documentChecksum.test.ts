// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';

import {
  SeqDocument,
  type Seguid,
  describeMolecule,
  documentChecksum,
  knownChecksum,
  moleculeChecksum,
} from '@/core';
import { randomDna, seededRandom } from '@/test/random';
import { type analysisClient } from '@/workers/analysisClient';

import {
  CHECKSUM_DEBOUNCE_MS,
  WORKER_CHECKSUM_FROM,
  documentChecksumLater,
  useDocumentChecksum,
} from './documentChecksum';

const { checksum } = vi.hoisted(() => ({ checksum: vi.fn<typeof analysisClient.checksum>() }));
vi.mock('@/workers/analysisClient', () => ({ analysisClient: { checksum } }));

const rand = seededRandom(270);
const SMALL = SeqDocument.create({ sequence: randomDna(rand, 4000), topology: 'circular' });
const large = (): SeqDocument =>
  SeqDocument.create({ sequence: randomDna(rand, WORKER_CHECKSUM_FROM), topology: 'circular' });

/** What the worker would answer: the same digest, taken from the description. */
function answerLikeTheWorker(): void {
  checksum.mockImplementation((molecule) => Promise.resolve(moleculeChecksum(molecule)));
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('documentChecksumLater (#270)', () => {
  beforeEach(() => {
    checksum.mockReset();
    answerLikeTheWorker();
  });

  it('takes a small document inline, without the worker', async () => {
    expect(await documentChecksumLater(SMALL)).toBe(documentChecksum(SMALL));
    expect(checksum).not.toHaveBeenCalled();
  });

  it('asks the worker for a large one, once, and remembers the answer for the sync callers', async () => {
    const doc = large();
    expect(knownChecksum(doc)).toBeUndefined();
    const [a, b] = await Promise.all([documentChecksumLater(doc), documentChecksumLater(doc)]);
    expect(checksum).toHaveBeenCalledTimes(1);
    expect(checksum).toHaveBeenCalledWith(describeMolecule(doc));
    expect(a).toEqual(documentChecksum(doc));
    expect(a).toBe(b);
    expect(knownChecksum(doc)).toBe(a);
    // Asked again, it is a lookup.
    expect(await documentChecksumLater(doc)).toBe(a);
    expect(checksum).toHaveBeenCalledTimes(1);
  });

  it('falls back to the main thread when the worker fails', async () => {
    checksum.mockRejectedValue(new Error('Analysis worker failed'));
    const doc = large();
    expect(await documentChecksumLater(doc)).toEqual(documentChecksum(doc));
  });
});

describe('useDocumentChecksum (#270)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checksum.mockReset();
    answerLikeTheWorker();
  });
  afterEach(() => {
    // Let the beat after this test's last request pass, so the next test
    // starts with a status bar that has been quiet for a while.
    vi.advanceTimersByTime(CHECKSUM_DEBOUNCE_MS + 1);
    vi.useRealTimers();
  });

  it('has a small document at once and null for none', () => {
    const { result, rerender } = renderHook<Seguid | null | undefined, SeqDocument | null>(
      (doc) => useDocumentChecksum(doc),
      { initialProps: SMALL },
    );
    expect(result.current).toBe(documentChecksum(SMALL));
    rerender(null);
    expect(result.current).toBeNull();
    expect(checksum).not.toHaveBeenCalled();
  });

  it('shows nothing for a large document until the worker answers, then the same value', async () => {
    const doc = large();
    const { result } = renderHook(() => useDocumentChecksum(doc));
    expect(result.current).toBeUndefined();
    // A document opened into a quiet status bar is asked for at once.
    await wait(0);
    expect(checksum).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(documentChecksum(doc));
    expect(result.current).toBe(knownChecksum(doc));
  });

  it('waits a beat for a document that follows another, and never asks for one replaced within it', async () => {
    const first = large();
    const second = large();
    const third = large();
    const { result, rerender } = renderHook((doc: SeqDocument) => useDocumentChecksum(doc), {
      initialProps: first,
    });
    await wait(0);
    expect(checksum).toHaveBeenCalledTimes(1);
    // Typing: the second document comes within the beat of the first's
    // request, and the third within the beat the second then waits.
    await wait(CHECKSUM_DEBOUNCE_MS / 2);
    rerender(second);
    await wait(CHECKSUM_DEBOUNCE_MS / 4);
    expect(checksum).toHaveBeenCalledTimes(1);
    rerender(third);
    expect(result.current).toBeUndefined();
    await wait(CHECKSUM_DEBOUNCE_MS - 1);
    expect(checksum).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(checksum).toHaveBeenCalledTimes(2);
    expect(checksum).toHaveBeenLastCalledWith(describeMolecule(third));
    expect(result.current).toEqual(documentChecksum(third));
    expect(knownChecksum(second)).toBeUndefined();
  });

  it('drops a stale answer for a document that was replaced while the worker had it', async () => {
    const first = large();
    const second = large();
    let answerFirst: (() => void) | null = null;
    checksum.mockImplementationOnce(
      (molecule) =>
        new Promise((resolve) => {
          answerFirst = () => {
            resolve(moleculeChecksum(molecule));
          };
        }),
    );
    const { result, rerender } = renderHook((doc: SeqDocument) => useDocumentChecksum(doc), {
      initialProps: first,
    });
    await wait(0);
    expect(checksum).toHaveBeenCalledTimes(1);
    expect(result.current).toBeUndefined();
    rerender(second);
    expect(result.current).toBeUndefined();
    await wait(CHECKSUM_DEBOUNCE_MS);
    expect(checksum).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(documentChecksum(second));
    // The first document's answer lands now, and changes nothing shown.
    await act(async () => {
      answerFirst?.();
      await Promise.resolve();
    });
    expect(result.current).toEqual(documentChecksum(second));
    expect(result.current?.text).not.toBe(documentChecksum(first)?.text);
    // Though it is not wasted: the first document's checksum is known now.
    expect(knownChecksum(first)).toEqual(documentChecksum(first));
  });

  it('shows a large document whose checksum is already known at once', () => {
    const doc = large();
    expect(documentChecksum(doc)).not.toBeNull();
    const { result } = renderHook(() => useDocumentChecksum(doc));
    expect(result.current).toBe(documentChecksum(doc));
    expect(checksum).not.toHaveBeenCalled();
  });
});
