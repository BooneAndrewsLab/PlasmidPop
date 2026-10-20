// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';

import { useMenu } from './useMenu';

function Menu() {
  const { open, toggle, ref } = useMenu();
  return (
    <div className="menu" ref={ref}>
      <button type="button" onClick={toggle}>
        File
      </button>
      {open && (
        <div className="menu__list" role="menu">
          items
        </div>
      )}
    </div>
  );
}

/**
 * Opens the menu in a window `width` wide (and `height` tall) with the list
 * laid out at `left..right`, `listHeight` tall from y = 40.
 */
function openAt(
  width: number,
  left: number,
  right: number,
  height = 800,
  listHeight = 300,
): HTMLElement {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(height);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: left, y: 40, width: right - left, height: listHeight }),
  );
  render(<Menu />);
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  return screen.getByRole('menu');
}

describe('useMenu keeps an open list inside the window', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shifts a list running past the right edge back in (phone File menu)', () => {
    expect(openAt(360, 176, 436).style.translate).toBe('-84px 0');
  });

  it('shifts a list running past the left edge back in', () => {
    expect(openAt(360, -20, 200).style.translate).toBe('28px 0');
  });

  it('leaves a list that fits where it is', () => {
    expect(openAt(1200, 300, 560).style.translate).toBe('');
  });

  it('keeps the left edge in view when the list is wider than the window', () => {
    expect(openAt(300, 100, 500).style.translate).toBe('-92px 0');
  });

  it('caps a list too tall for the room below it, so it scrolls inside', () => {
    const list = openAt(360, 100, 300, 600, 700);
    expect(list.style.maxHeight).toBe('552px');
  });

  it('leaves the height of a list that fits', () => {
    expect(openAt(360, 100, 300, 600, 500).style.maxHeight).toBe('');
  });
});
