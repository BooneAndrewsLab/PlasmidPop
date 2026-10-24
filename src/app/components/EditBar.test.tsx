// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { EditBar } from './EditBar';

describe('EditBar (#292)', () => {
  const doc = SeqDocument.create({
    name: 'p',
    sequence: 'ACGT'.repeat(10),
    topology: 'circular',
  });

  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
  });

  it('keeps the visible hint short and the long one in the tooltip', () => {
    render(<EditBar doc={doc} />);
    const hint = screen.getByText('Insert bases…');
    expect(hint.getAttribute('data-tip')).toMatch(/Backspace to delete/);
  });

  it('names the icon buttons for assistive technology', () => {
    render(<EditBar doc={doc} />);
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add feature' })).toBeInTheDocument();
  });

  it('has Style, Case, Set origin and Make linear in the More group, which More opens', () => {
    render(<EditBar doc={doc} />);
    const more = screen.getByRole('button', { name: /More/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const items = document.querySelector('.editbar__more-items');
    expect(items).not.toBeNull();
    for (const name of [/Style/, /Case/, 'Set origin here', 'Make linear']) {
      expect(
        [...(items?.querySelectorAll('button') ?? [])].some((b) =>
          typeof name === 'string' ? b.textContent === name : name.test(b.textContent),
        ),
      ).toBe(true);
    }
  });
});
