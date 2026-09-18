// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';

import { GUIDE } from './guide';
import { HelpButton } from './HelpButton';

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
