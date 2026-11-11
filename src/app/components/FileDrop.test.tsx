// @vitest-environment jsdom
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileDrop } from './FileDrop';

afterEach(cleanup);

const OVER = 'enzyme-import__drop--over';

const setup = (props: {
  busy?: boolean;
  accept?: string;
  onFile?: (f: File | undefined) => void;
}) => {
  const onFile = props.onFile ?? vi.fn();
  const { container } = render(
    <FileDrop
      accept={props.accept ?? '.txt'}
      hint="or drop it here"
      busy={props.busy ?? false}
      onFile={onFile}
    />,
  );
  const zone = container.querySelector<HTMLElement>('.enzyme-import__drop');
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (zone === null || input === null) throw new Error('FileDrop did not render');
  return { zone, input, onFile };
};

describe('FileDrop', () => {
  it('highlights on dragover, and clears on dragleave', () => {
    const { zone } = setup({});
    expect(zone.classList.contains(OVER)).toBe(false);
    fireEvent.dragOver(zone);
    expect(zone.classList.contains(OVER)).toBe(true);
    fireEvent.dragLeave(zone);
    expect(zone.classList.contains(OVER)).toBe(false);
  });

  it('prevents the default of dragover and drop, hands over the first dropped file and clears', () => {
    const { zone, onFile } = setup({});
    const over = createEvent.dragOver(zone);
    fireEvent(zone, over);
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains(OVER)).toBe(true);

    const file = new File(['x'], 'a.txt');
    const other = new File(['y'], 'b.txt');
    const drop = createEvent.drop(zone, { dataTransfer: { files: [file, other] } });
    fireEvent(zone, drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(zone.classList.contains(OVER)).toBe(false);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('hands over an empty drop as undefined', () => {
    const { zone, onFile } = setup({});
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onFile).toHaveBeenCalledWith(undefined);
  });

  it('hands over the chosen file and resets the input', () => {
    const { input, onFile } = setup({});
    const file = new File(['x'], 'a.txt');
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('shows Choose file when idle and a disabled Reading when busy', () => {
    setup({});
    const idle = screen.getByRole<HTMLButtonElement>('button');
    expect(idle.textContent).toBe('Choose file…');
    expect(idle.disabled).toBe(false);
    cleanup();
    setup({ busy: true });
    const busy = screen.getByRole<HTMLButtonElement>('button');
    expect(busy.textContent).toBe('Reading…');
    expect(busy.disabled).toBe(true);
  });

  it('renders the hint', () => {
    setup({});
    expect(screen.getByText('or drop it here').className).toBe('enzyme-import__hint');
  });

  it('passes accept to the picker', () => {
    const { input } = setup({ accept: '.csv,text/csv' });
    expect(input.getAttribute('accept')).toBe('.csv,text/csv');
  });
});
