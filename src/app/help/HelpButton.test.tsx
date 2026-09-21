// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

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
