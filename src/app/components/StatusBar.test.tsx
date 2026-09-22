// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, documentChecksum } from '@/core';

import { editorStore } from '../state/editorStore';
import { StatusBar } from './StatusBar';

const PLASMID = SeqDocument.create({
  name: 'pTest',
  sequence: 'ATGCGTACGTTAGCCATGGATCCGAATTCAAGCTTGGTACCGAGCTCGGATCCACTAGT',
  topology: 'circular',
});

function stubClipboard(): { written: string[]; restore: () => void } {
  const written: string[] = [];
  const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  return {
    written,
    restore: () => {
      if (real === undefined) delete (navigator as { clipboard?: unknown }).clipboard;
      else Object.defineProperty(navigator, 'clipboard', real);
    },
  };
}

describe('the status bar checksum', () => {
  beforeEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('shows nothing when no document is open', () => {
    render(<StatusBar doc={null} />);
    expect(screen.queryByText(/seguid/)).toBeNull();
  });

  it('shows the molecule short, and copies it whole', () => {
    const clipboard = stubClipboard();
    try {
      render(<StatusBar doc={PLASMID} />);
      const full = documentChecksum(PLASMID);
      expect(full).not.toBeNull();
      const button = screen.getByRole('button', { name: /cdseguid=/ });
      expect(button.textContent).toContain(full?.short);
      expect(button.getAttribute('title')).toContain(full?.text);

      fireEvent.click(button);
      expect(clipboard.written).toEqual([full?.text]);
      expect(screen.getByRole('button', { name: 'Checksum copied' })).toBeTruthy();
    } finally {
      clipboard.restore();
    }
  });

  it('does not change when the same plasmid is written from another origin', () => {
    const { container, rerender } = render(<StatusBar doc={PLASMID} />);
    const before = container.textContent;
    rerender(<StatusBar doc={PLASMID.setOrigin(17)} />);
    expect(container.textContent).toBe(before);
  });
});
