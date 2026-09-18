import { createFeature, fragmentToJSON, rangeSegment } from '@/core';

import { FRAGMENT_MIME, readClipboard, resetClipboardMemory, writeFragment } from './clipboard';

/** Just enough of DataTransfer for the copy/paste helpers. */
function fakeDataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const store = new Map(Object.entries(initial));
  return {
    setData: (type: string, value: string) => {
      store.set(type, value);
    },
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
}

const fragment = {
  sequence: 'ACGTACGT',
  features: [createFeature({ id: 'f', type: 'gene', name: 'g', segments: [rangeSegment(2, 6)] })],
};

beforeEach(resetClipboardMemory);

describe('clipboard', () => {
  it('writes plain bases for other apps and a typed fragment for ourselves', () => {
    const dt = fakeDataTransfer();
    writeFragment(dt, fragment);
    expect(dt.getData('text/plain')).toBe('ACGTACGT');
    expect(dt.getData(FRAGMENT_MIME)).toBe(fragmentToJSON(fragment));
    expect(readClipboard(dt)).toEqual(fragment);
  });

  it('falls back to the last copied fragment when only its text survives', () => {
    writeFragment(fakeDataTransfer(), fragment);
    expect(readClipboard(fakeDataTransfer({ 'text/plain': 'ACGTACGT\n' }))).toEqual(fragment);
    expect(readClipboard(fakeDataTransfer({ 'text/plain': 'ACGTACGA' }))).toBe('ACGTACGA');
  });

  it('treats foreign or broken typed data as plain text', () => {
    const dt = fakeDataTransfer({ [FRAGMENT_MIME]: '{"oops":1}', 'text/plain': 'GGCC' });
    expect(readClipboard(dt)).toBe('GGCC');
    expect(readClipboard(fakeDataTransfer())).toBe('');
  });
});
