// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';

import pkg from '../../../package.json' with { type: 'json' };

import { GUIDE } from './guide';
import { HelpButton } from './HelpButton';
import { openGuide } from './openGuide';

describe('HelpButton', () => {
  it('opens the guide on the first page and lists every page', () => {
    render(<HelpButton />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = screen.getByRole('dialog', { name: 'PlasmidPop guide' });
    expect(dialog).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Guide pages' });
    for (const p of GUIDE) expect(nav).toHaveTextContent(p.title);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(GUIDE[0]?.title ?? '');
  });

  it('says which release this is', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const dialog = screen.getByRole('dialog', { name: 'PlasmidPop guide' });
    expect(dialog).toHaveTextContent(`Version ${pkg.version}`);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('links the standalone tutorials, opened in a tab of their own (#312)', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const link = screen.getByRole('link', { name: 'Tutorials' });
    expect(link).toHaveAttribute('href', `${import.meta.env.BASE_URL}tutorials/`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('switches pages from the list and from links inside a page', () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    const nav = screen.getByRole('navigation', { name: 'Guide pages' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Keyboard shortcuts');
    fireEvent.click(within(nav).getByRole('button', { name: 'Getting started' }));
    // Getting started links to the files page in its text.
    const article = screen.getByRole('article');
    fireEvent.click(within(article).getByRole('button', { name: 'Files and storage' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Files and storage');
    expect(within(nav).getByRole('button', { name: 'Files and storage' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('sends a repo-relative tutorial link in a guide page to the site tutorial (item 137)', () => {
    render(<HelpButton />);
    act(() => {
      openGuide('07-enzymes');
    });
    const link = screen.getByRole('link', { name: 'Enzymes tutorial' });
    expect(link).toHaveAttribute('href', `${import.meta.env.BASE_URL}tutorials/enzymes/`);
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('opens at the page something else asked for', () => {
    render(<HelpButton />);
    act(() => {
      openGuide('02-files');
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Files and storage');
    // Another page while it is up wins; the "?" button goes back to the top.
    act(() => {
      openGuide('14-shortcuts');
    });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Keyboard shortcuts');
    fireEvent.click(screen.getByRole('button', { name: 'Close guide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(GUIDE[0]?.title ?? '');
  });

  it('makes a link within a page scroll to that section instead of opening a tab', () => {
    render(<HelpButton />);
    act(() => {
      openGuide('02-files');
    });
    const article = screen.getByRole('article');
    // Every heading is a target, and `[working copy](#working-copies)` in the
    // page text is a button in the dialog rather than a link out of it.
    expect(article.querySelector('#working-copies')?.textContent).toBe('Working copies');
    const links = within(article).getAllByRole('button', { name: 'working copy' });
    expect(links.length).toBeGreaterThan(0);
    expect(article.querySelector('a[href="#working-copies"]')).toBeNull();
    const [link] = links;
    if (link === undefined) throw new Error('expected a link to the working copies section');
    fireEvent.click(link);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Files and storage');
  });

  it('opens at a section when one is named', () => {
    render(<HelpButton />);
    act(() => {
      openGuide('02-files#downloading-in-firefox-and-safari');
    });
    const article = screen.getByRole('article');
    expect(article.querySelector('#downloading-in-firefox-and-safari')?.textContent).toBe(
      'Downloading in Firefox and Safari',
    );
  });

  it('closes with Escape, the Close button and a backdrop click', () => {
    render(<HelpButton />);
    const open = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    };
    open();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close guide' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    open();
    const backdrop = screen.getByRole('dialog').parentElement;
    if (backdrop === null) throw new Error('dialog has no backdrop');
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens with the ? key unless typing in a text field or the sequence view', () => {
    render(
      <>
        <HelpButton />
        <input aria-label="field" />
        <div role="textbox" tabIndex={0} aria-label="Sequence" />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText('field'), { key: '?' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), { key: '?' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// Item 138 (#409): search of the guide in the dialog.
/** The element a test has found, or a failure that says nothing was. */
function must<T>(found: T | undefined): T {
  if (found === undefined) throw new Error('not found');
  return found;
}

describe('the guide’s search box', () => {
  const open = () => {
    render(<HelpButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    return screen.getByRole('dialog', { name: 'PlasmidPop guide' });
  };
  const box = () => screen.getByRole('searchbox', { name: 'Search the guide' });
  const type = (text: string) => {
    fireEvent.change(box(), { target: { value: text } });
  };

  it('stands above the page list, with the placeholder the static pages have', () => {
    const dialog = open();
    expect(box()).toHaveAttribute('placeholder', 'Search the guide');
    const side = box().closest('.help__side');
    expect(side).not.toBeNull();
    expect(within(dialog).getByRole('navigation', { name: 'Guide pages' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('lists the page and heading of each result, with a snippet, in place of the page', () => {
    open();
    type('keyboard shortcuts');
    const results = screen.getByRole('region', { name: 'Search results' });
    const first = within(results).getAllByRole('button')[0];
    expect(first).toHaveTextContent('Keyboard shortcuts');
    expect(first?.querySelector('.help__result-snippet')?.textContent).not.toBe('');
    expect(screen.getByRole('status')).toHaveTextContent(/\d+ results?/);
    expect(screen.getByRole('article', { hidden: true })).not.toBeVisible();
  });

  it('marks what matched in the snippet', () => {
    open();
    type('dam');
    expect(document.querySelector('.help__result-snippet mark')).not.toBeNull();
  });

  it('says so when nothing matches', () => {
    open();
    type('zzzzzzzz');
    expect(screen.getByRole('status')).toHaveTextContent('No matches for “zzzzzzzz”.');
  });

  it('opens a result at its heading, scrolling to it, and gives the page back', () => {
    open();
    type('Open the app');
    fireEvent.click(
      must(
        within(screen.getByRole('region', { name: 'Search results' })).getAllByRole('button')[0],
      ),
    );
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
    expect(box()).toHaveValue('');
    const article = screen.getByRole('article');
    expect(article).toBeVisible();
    expect(article).toHaveFocus();
  });

  it('opens the page that holds the result and marks it current', () => {
    open();
    type('Ctrl+Shift+Z');
    const nav = screen.getByRole('navigation', { name: 'Guide pages' });
    const results = screen.getByRole('region', { name: 'Search results' });
    fireEvent.click(must(within(results).getAllByRole('button')[0]));
    expect(within(nav).getByRole('button', { name: 'Keyboard shortcuts' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('scrolls to the heading of the result, every time it is opened', () => {
    open();
    // jsdom has no layout: say where the sections are.
    const offset = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === 'H3' ? 500 : 0;
    });
    try {
      const article = screen.getByRole('article', { hidden: true });
      const openSection = (): void => {
        type('Jumping to a state');
        const results = screen.getByRole('region', { name: 'Search results' });
        const section = within(results)
          .getAllByRole('button')
          .find((b) => b.querySelector('strong') !== null);
        article.scrollTop = 0;
        fireEvent.click(must(section));
      };
      openSection();
      expect(article.scrollTop).toBe(500);
      // The page is already at that heading, and opening it again still scrolls.
      openSection();
      expect(article.scrollTop).toBe(500);
    } finally {
      offset.mockRestore();
    }
  });

  it('opens the first result on Enter, and walks the results with the arrow keys', () => {
    open();
    type('shortcuts');
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const buttons = within(screen.getByRole('region', { name: 'Search results' })).getAllByRole(
      'button',
    );
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(must(buttons[0]), { key: 'ArrowDown' });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(must(buttons[1]), { key: 'ArrowUp' });
    fireEvent.keyDown(must(buttons[0]), { key: 'ArrowUp' });
    expect(box()).toHaveFocus();
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
    expect(box()).toHaveValue('');
  });

  it('does nothing on Enter when there is nothing to open', () => {
    open();
    fireEvent.keyDown(box(), { key: 'Enter' });
    type('zzzzzzzz');
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(box()).toHaveValue('zzzzzzzz');
  });

  it('clears the box on Escape before it closes the dialog', () => {
    const dialog = open();
    type('dam');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('focuses on "/" and on Ctrl+K or Cmd+K inside the dialog, but types "/" in a field', () => {
    const dialog = open();
    expect(box()).not.toHaveFocus();
    const slash = createEvent.keyDown(dialog, { key: '/' });
    fireEvent(dialog, slash);
    expect(slash.defaultPrevented).toBe(true);
    expect(box()).toHaveFocus();
    screen.getByRole('button', { name: 'Close guide' }).focus();
    const ctrlK = createEvent.keyDown(dialog, { key: 'k', ctrlKey: true });
    fireEvent(dialog, ctrlK);
    expect(ctrlK.defaultPrevented).toBe(true);
    expect(box()).toHaveFocus();
    screen.getByRole('button', { name: 'Close guide' }).focus();
    fireEvent.keyDown(dialog, { key: 'K', metaKey: true });
    expect(box()).toHaveFocus();
    // In the box a slash is a character; the other modified keys are not ours.
    const typed = createEvent.keyDown(box(), { key: '/' });
    fireEvent(box(), typed);
    expect(typed.defaultPrevented).toBe(false);
    screen.getByRole('button', { name: 'Close guide' }).focus();
    fireEvent.keyDown(dialog, { key: 'k', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(dialog, { key: '/', altKey: true });
    fireEvent.keyDown(dialog, { key: 'j', ctrlKey: true });
    expect(box()).not.toHaveFocus();
  });

  it('is left alone by a click on a page in the list: the page shows again', () => {
    open();
    type('dam');
    const nav = screen.getByRole('navigation', { name: 'Guide pages' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Files and storage' }));
    expect(screen.queryByRole('region', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Files and storage');
  });
});
