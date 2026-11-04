// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REFERENCE_ROW, startSelection, type AlignmentSelection } from '../alignmentSelection';
import { copyText } from '../clipboard';
import { AlignmentCopyPanel } from './AlignmentCopyPanel';
import {
  SAMPLE_FRAME as frame,
  SAMPLE_STACK as stack,
  row,
  stackOf,
} from '../../test/alignmentStackFixture';

vi.mock('../clipboard', () => ({ copyText: vi.fn() }));

const sel = (r: number, a: number, b: number, track: 'bases' | 'aa' = 'bases') => ({
  ...startSelection(r, track, a),
  head: b,
});

function open(
  over: Partial<{
    selection: AlignmentSelection;
    frames: typeof frame extends infer F ? readonly F[] | null : never;
    stack: typeof stack;
    onCopied: (note: string) => void;
    onClose: () => void;
  }> = {},
) {
  const onCopied = over.onCopied ?? vi.fn();
  const onClose = over.onClose ?? vi.fn();
  const view = render(
    <AlignmentCopyPanel
      stack={over.stack ?? stack}
      frames={over.frames === undefined ? [frame] : over.frames}
      referenceName="ref"
      selection={over.selection ?? sel(0, 2, 8)}
      left={10}
      top={20}
      onCopied={onCopied}
      onClose={onClose}
    />,
  );
  return { ...view, onCopied, onClose };
}

const preview = (): string => screen.getByLabelText('Preview of the text to copy').textContent;
const radio = (name: string): HTMLElement => screen.getByRole('radio', { name });
const group = (name: string): HTMLElement => screen.getByRole('radiogroup', { name });

describe('AlignmentCopyPanel', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    vi.mocked(copyText).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on the row's residues, as Ctrl+C, with a preview and a count", () => {
    open();
    expect(radio('This row').getAttribute('aria-checked')).toBe('true');
    expect(radio('Selection (7)').getAttribute('aria-checked')).toBe('true');
    expect(radio('Dropped').getAttribute('aria-checked')).toBe('true');
    expect(radio('Bases').getAttribute('aria-checked')).toBe('true');
    expect(radio('Text').getAttribute('aria-checked')).toBe('true');
    expect(preview()).toBe('GAAGCC');
    expect(screen.getByText('1 row × 7 columns, 6 characters')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Names' })).toHaveProperty('checked', false);
  });

  it('keeps gaps once several rows go out, and frees them again', () => {
    open();
    fireEvent.click(radio('All 3'));
    expect(within(group('Gaps')).getByRole('radio', { name: 'Dropped' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(radio('Kept as -').getAttribute('aria-checked')).toBe('true');
    expect(preview()).toBe('GAAA-CC\nG-AAGCC\nGAAA-CC');
    expect(screen.getByText('3 rows × 7 columns, 23 characters')).toBeTruthy();
    fireEvent.click(radio('This row'));
    expect(radio('Dropped')).toHaveProperty('disabled', false);
    expect(preview()).toBe('GAAGCC');
  });

  it('names the lines in a padded column, and leads with the coordinates', () => {
    open();
    fireEvent.click(radio('With reference'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Names' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Coordinates' }));
    expect(preview()).toBe('Columns 3-9, reference 3-8\nref GAAA-CC\ns1  G-AAGCC');
  });

  it('writes FASTA, where the names are always on', () => {
    open();
    fireEvent.click(radio('FASTA'));
    const names = screen.getByRole('checkbox', { name: 'Names' });
    expect(names).toHaveProperty('disabled', true);
    expect(names).toHaveProperty('checked', true);
    expect(preview()).toBe('>s1\nGAAGCC');
  });

  it('offers no amino acids without residues in view', () => {
    open({ frames: null });
    expect(radio('Amino acids')).toHaveProperty('disabled', true);
    expect(radio('Bases').getAttribute('aria-checked')).toBe('true');
  });

  it('opens on the amino acids when the selection is on that strip, both tracks named', () => {
    open({ selection: sel(REFERENCE_ROW, 0, 9, 'aa') });
    expect(radio('Amino acids').getAttribute('aria-checked')).toBe('true');
    expect(preview()).toBe('MKP');
    fireEvent.click(radio('Both'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Names' }));
    expect(preview()).toBe('ref      ATGAAACCC\nref|x|aa MKP');
  });

  it('has no reference to add when the selection is on it', () => {
    open({ selection: sel(REFERENCE_ROW, 0, 9) });
    expect(radio('Reference').getAttribute('aria-checked')).toBe('true');
    expect(radio('With reference')).toHaveProperty('disabled', true);
  });

  it('says when there is nothing to copy, and will not', () => {
    const late = stackOf('ATGAAA-CCC', [row('s3', '      -CCC')]);
    open({ stack: late, selection: sel(0, 0, 4), frames: null });
    expect(screen.getByText(/Nothing to copy/).textContent).toContain('no residues');
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', true);
    fireEvent.click(radio('Kept as -'));
    expect(preview()).toBe('-----');
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveProperty('disabled', false);
  });

  it('copies what the preview shows, says so, and closes', () => {
    const { onCopied, onClose } = open();
    fireEvent.click(radio('All 3'));
    fireEvent.click(radio('FASTA'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyText).toHaveBeenCalledWith('>ref\nGAAA-CC\n>s1\nG-AAGCC\n>s2\nGAAA-CC\n');
    expect(onCopied).toHaveBeenCalledWith('Copied 3 rows × 7 columns as FASTA');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the first lines only, and says how many more there are', () => {
    const many = stackOf(
      'ACGTACGT',
      Array.from({ length: 9 }, (_, i) => row(`r${i}`, 'ACGTACGT')),
    );
    open({ stack: many, selection: sel(0, 0, 7), frames: null });
    fireEvent.click(radio('All 10'));
    expect(preview()).toContain('… 4 more lines');
    expect(preview().split('\n')).toHaveLength(7);
  });

  it('warns about a very large copy, which still goes', () => {
    const wide = stackOf('A'.repeat(1_100_000), [row('w', 'A'.repeat(1_100_000))]);
    const { onCopied } = open({ stack: wide, selection: sel(0, 0, 3), frames: null });
    expect(screen.queryByText(/large copy/)).toBeNull();
    fireEvent.click(radio('All 1,100,000'));
    expect(screen.getByText(/A large copy, about 1\.1 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(vi.mocked(copyText).mock.calls[0]?.[0]).toHaveLength(1_100_000);
    expect(onCopied).toHaveBeenCalledWith('Copied 1 row × 1,100,000 columns');
  });

  it('remembers the choices for the next time', () => {
    const first = open();
    fireEvent.click(radio('All 3'));
    fireEvent.click(radio('FASTA'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Coordinates' }));
    first.unmount();
    open();
    expect(radio('All 3').getAttribute('aria-checked')).toBe('true');
    expect(radio('FASTA').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Coordinates' })).toHaveProperty('checked', true);
  });

  it('works without storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    open();
    fireEvent.click(radio('FASTA'));
    expect(preview()).toBe('>s1\nGAAGCC');
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  it('closes on Esc, taking the key, and on a press outside but not inside', () => {
    const { onClose } = open();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(esc, 'stopPropagation');
    document.body.dispatchEvent(esc);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
    fireEvent.pointerDown(radio('FASTA'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('puts the focus on the chosen row choice when it opens', () => {
    open();
    expect(document.activeElement).toBe(radio('This row'));
  });
});
