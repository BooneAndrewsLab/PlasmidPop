// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { type ClipboardHandlers, useClipboardEvents } from './useClipboardEvents';

/**
 * Clipboard events for a focusable element that is not editable (#267):
 * Chrome sends them to the focused element, Firefox to `<body>` (or the node
 * holding the page's text selection). Either way they must reach the view.
 */

function View({ handlers }: { handlers: ClipboardHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  useClipboardEvents(ref, handlers);
  return (
    <>
      <div ref={ref} tabIndex={0} role="textbox" aria-label="View">
        <button type="button">Inside</button>
        <input aria-label="Inside field" />
      </div>
      <input aria-label="Outside field" />
      <p>Page text</p>
    </>
  );
}

function setup() {
  const handlers = { copy: vi.fn(), cut: vi.fn(), paste: vi.fn() };
  const utils = render(<View handlers={handlers} />);
  return { handlers, utils, view: screen.getByRole('textbox', { name: 'View' }) };
}

describe('useClipboardEvents (#267)', () => {
  it('takes an event sent to the focused element, as Chrome sends it', () => {
    const { handlers, view } = setup();
    view.focus();
    fireEvent.paste(view);
    fireEvent.copy(view);
    fireEvent.cut(view);
    expect(handlers.paste).toHaveBeenCalledTimes(1);
    expect(handlers.copy).toHaveBeenCalledTimes(1);
    expect(handlers.cut).toHaveBeenCalledTimes(1);
  });

  it('takes an event sent to the body while the element has the focus, as Firefox sends it', () => {
    const { handlers, view } = setup();
    view.focus();
    fireEvent.paste(document.body);
    fireEvent.copy(document.body);
    fireEvent.cut(document.body);
    expect(handlers.paste).toHaveBeenCalledTimes(1);
    expect(handlers.copy).toHaveBeenCalledTimes(1);
    expect(handlers.cut).toHaveBeenCalledTimes(1);
  });

  it('takes an event sent to selected page text while the element has the focus', () => {
    const { handlers, view } = setup();
    view.focus();
    fireEvent.paste(screen.getByText('Page text'));
    expect(handlers.paste).toHaveBeenCalledTimes(1);
  });

  it('takes an event while a button inside the element has the focus', () => {
    const { handlers } = setup();
    const inside = screen.getByRole('button', { name: 'Inside' });
    inside.focus();
    fireEvent.paste(document.body);
    fireEvent.paste(inside);
    expect(handlers.paste).toHaveBeenCalledTimes(2);
  });

  it('leaves an event alone when the element does not have the focus', () => {
    const { handlers } = setup();
    screen.getByRole('button', { name: 'Inside' }).blur();
    fireEvent.paste(document.body);
    expect(handlers.paste).not.toHaveBeenCalled();
  });

  it('leaves a text field its own clipboard, inside the element or out', () => {
    const { handlers } = setup();
    for (const name of ['Inside field', 'Outside field']) {
      const field = screen.getByRole('textbox', { name });
      field.focus();
      fireEvent.paste(field);
      fireEvent.copy(field);
      fireEvent.cut(field);
    }
    expect(handlers.paste).not.toHaveBeenCalled();
    expect(handlers.copy).not.toHaveBeenCalled();
    expect(handlers.cut).not.toHaveBeenCalled();
  });

  it('leaves an event someone has already handled', () => {
    const { handlers, view } = setup();
    view.focus();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(handlers.paste).not.toHaveBeenCalled();
  });

  it('calls the handlers of the latest render', () => {
    const { handlers, utils, view } = setup();
    const next = { copy: vi.fn(), cut: vi.fn(), paste: vi.fn() };
    utils.rerender(<View handlers={next} />);
    view.focus();
    fireEvent.paste(document.body);
    expect(handlers.paste).not.toHaveBeenCalled();
    expect(next.paste).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', () => {
    const { handlers, utils, view } = setup();
    view.focus();
    utils.unmount();
    fireEvent.paste(document.body);
    expect(handlers.paste).not.toHaveBeenCalled();
  });
});
