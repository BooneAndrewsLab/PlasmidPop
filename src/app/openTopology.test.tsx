// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type MockInstance } from 'vitest';

import { analytics } from './analytics';
import { TopologyDialog } from './components/TopologyDialog';
import { openFile, openFiles, openPastedText } from './openFile';
import { editorStore } from './state/editorStore';

// 30 bp; the CDS 28..6 runs across the end of the sequence.
const SEQ = `GCCTAA${'C'.repeat(21)}ATG`;
const TEXT = [
  'LOCUS       X                         30 bp    DNA     linear   SYN 01-JAN-2020',
  'FEATURES             Location/Qualifiers',
  '     CDS             28..6',
  '                     /label="secretwrapper"',
  '     misc_feature    10..12',
  `ORIGIN\n        1 ${SEQ.slice(0, 10)} ${SEQ.slice(10, 20)} ${SEQ.slice(20)}\n//\n`,
].join('\n');

const fileOf = (text = TEXT): File => new File([text], 'wrap.gb');

/** Starts an open, optionally answers the question it puts, and returns what the open came to. */
async function run<T>(
  opening: () => Promise<T>,
  choice: string | null = null,
  after?: (text: string) => void,
): Promise<T> {
  let result!: T;
  await act(async () => {
    const p = opening();
    if (choice !== null) {
      await screen.findByRole('dialog');
      after?.(screen.getByRole('dialog').textContent);
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${choice}`) }));
    }
    result = await p;
  });
  return result;
}

describe('opening a linear record with features across its end (#462)', () => {
  let track: MockInstance;
  beforeEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
    track = vi.spyOn(analytics, 'track').mockImplementation(() => undefined);
  });
  afterEach(() => {
    track.mockRestore();
  });

  it('asks with a count only, and Circular opens it circular with the feature kept', async () => {
    render(<TopologyDialog />);
    const id = await run(
      () => openFile(fileOf(), { askTopology: true }),
      'Circular',
      (text) => {
        expect(text).toContain('1 feature runs');
        expect(text).not.toContain('secretwrapper');
        expect(text).not.toContain('GCCTAA');
      },
    );
    expect(id).not.toBeNull();
    const doc = editorStore.document;
    expect(doc?.topology).toBe('circular');
    expect(doc?.features.size).toBe(2);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(track).toHaveBeenCalledWith('file', 'open-topology', 'circular');
  });

  it('Linear opens it as the file says, the feature dropped with the warning', async () => {
    render(<TopologyDialog />);
    const id = await run(() => openFile(fileOf(), { askTopology: true }), 'Linear');
    expect(id).not.toBeNull();
    expect(editorStore.document?.topology).toBe('linear');
    expect(editorStore.document?.features.size).toBe(1);
    expect(
      editorStore
        .getState()
        .warnings.map((w) => w.message)
        .join(),
    ).toMatch(/spans the origin of a linear/);
    expect(track).toHaveBeenCalledWith('file', 'open-topology', 'linear');
  });

  it('Cancel opens nothing, and so does Escape', async () => {
    render(<TopologyDialog />);
    expect(await run(() => openFile(fileOf(), { askTopology: true }), 'Cancel')).toBeNull();
    expect(editorStore.getState().documents).toHaveLength(0);
    let result: string | null | undefined;
    await act(async () => {
      const opening = openFile(fileOf(), { askTopology: true });
      await screen.findByRole('dialog');
      fireEvent.keyDown(document, { key: 'Escape' });
      result = await opening;
    });
    expect(result).toBeNull();
    expect(editorStore.getState().documents).toHaveLength(0);
    expect(track).toHaveBeenCalledWith('file', 'open-topology', 'cancel');
  });

  it('a file dropped or picked (openFiles) asks', async () => {
    render(<TopologyDialog />);
    await run(() => openFiles([fileOf()]), 'Circular');
    expect(editorStore.document?.topology).toBe('circular');
  });

  it('a pasted record asks too', async () => {
    render(<TopologyDialog />);
    await act(async () => {
      openPastedText(TEXT);
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: /^Circular/ }));
      await vi.waitFor(() => {
        expect(editorStore.document?.topology).toBe('circular');
      });
    });
  });

  it('without askTopology nothing is asked: linear, dropped, warned', async () => {
    const id = await run(() => openFile(fileOf()));
    expect(id).not.toBeNull();
    expect(editorStore.getState().topologyPrompt).toBeNull();
    expect(editorStore.document?.topology).toBe('linear');
    expect(editorStore.document?.features.size).toBe(1);
    expect(track).not.toHaveBeenCalledWith('file', 'open-topology', expect.anything());
  });

  it('a circular record or one without such features is not asked about', async () => {
    const plain = TEXT.replace('28..6', '2..6');
    expect(await run(() => openFile(fileOf(plain), { askTopology: true }))).not.toBeNull();
    const circular = TEXT.replace(/linear {3}/, 'circular ');
    expect(await run(() => openFile(fileOf(circular), { askTopology: true }))).not.toBeNull();
    expect(editorStore.getState().topologyPrompt).toBeNull();
  });
});
