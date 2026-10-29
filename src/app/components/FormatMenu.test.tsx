// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { INS_LENGTH, insShapedRecord } from '@/test/insShapedRecord';

import { editorStore } from '../state/editorStore';
import { FormatMenu } from './FormatMenu';

describe('FormatMenu', () => {
  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.setBaseColors(null);
      editorStore.setColorBases(false);
      editorStore.setResidueNumbering('tens');
      editorStore.closeAllDocuments();
      editorStore.restoreLastHiddenFeatureTypes([]);
      editorStore.restoreLastTranscriptPicks([]);
    });
  });

  const open = (): void => {
    render(<FormatMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
  };

  it("takes a bases-per-row count of the user's own, held to 10–1,000 (#29)", () => {
    open();
    const other = screen.getByRole('spinbutton', { name: 'Bases per row' });
    fireEvent.change(other, { target: { value: '75' } });
    // Not applied per keystroke: a count is typed, then committed.
    expect(editorStore.getState().seqBasesPerRow).toBeNull();
    fireEvent.keyDown(other, { key: 'Enter' });
    expect(editorStore.getState().seqBasesPerRow).toBe(75);
    expect(other).toHaveValue(75);
    fireEvent.change(other, { target: { value: '5000' } });
    fireEvent.blur(other);
    expect(editorStore.getState().seqBasesPerRow).toBe(1000);
    // One of the fixed widths leaves the box empty again.
    fireEvent.click(screen.getByRole('radio', { name: '60' }));
    expect(other).toHaveValue(null);
  });

  it('lets the four base colours be chosen while bases are coloured, and put back', () => {
    open();
    expect(screen.queryByRole('group', { name: 'Base colours' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Colour the bases' }));
    const a = screen.getByLabelText('Colour of A');
    fireEvent.change(a, { target: { value: '#123456' } });
    expect(editorStore.getState().baseColors).toMatchObject({ a: '#123456' });
    // The other three are filled from what was drawn, so all four are set.
    expect(Object.values(editorStore.getState().baseColors ?? {})).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(editorStore.getState().baseColors).toBeNull();
  });

  it('turns the GC track on and sets its window (item 75)', () => {
    open();
    expect(screen.queryByRole('combobox', { name: 'GC window' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'GC content track' }));
    expect(editorStore.getState().showGc).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'GC window' }), {
      target: { value: '200' },
    });
    expect(editorStore.getState().gcWindow).toBe(200);
    fireEvent.change(screen.getByRole('combobox', { name: 'GC window' }), {
      target: { value: 'auto' },
    });
    expect(editorStore.getState().gcWindow).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'GC content track' }));
    expect(editorStore.getState().showGc).toBe(false);
  });

  it("moves along a row's choices with the arrow keys, wrapping at the ends (#227)", () => {
    open();
    const size = (name: string) => screen.getByRole('radio', { name });
    expect(size('Medium')).toHaveAttribute('aria-checked', 'true');
    size('Medium').focus();
    fireEvent.keyDown(size('Medium'), { key: 'ArrowRight' });
    expect(editorStore.getState().seqFontSize).toBe(16);
    expect(size('Large')).toHaveFocus();
    fireEvent.keyDown(size('Large'), { key: 'ArrowRight' });
    expect(editorStore.getState().seqFontSize).toBe(11);
    expect(size('Small')).toHaveFocus();
    fireEvent.keyDown(size('Small'), { key: 'ArrowLeft' });
    expect(editorStore.getState().seqFontSize).toBe(16);
    // A row whose value is typed rather than picked has no segment chosen.
    const other = screen.getByRole('spinbutton', { name: 'Bases per row' });
    fireEvent.change(other, { target: { value: '75' } });
    fireEvent.keyDown(other, { key: 'Enter' });
    const row = screen.getByRole('radiogroup', { name: 'Bases per row' });
    expect(row.querySelector('[aria-checked="true"]')).toBeNull();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Fit' }), { key: 'ArrowRight' });
    expect(editorStore.getState().seqBasesPerRow).toBe(30);
    act(() => {
      editorStore.setSeqFontSize(13);
    });
  });

  it('numbers residues every tenth by default, or every one, or not at all (#97)', () => {
    open();
    const item = (name: string) => screen.getByRole('radio', { name });
    expect(item('Every 10th')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(item('All'));
    expect(editorStore.getState().residueNumbering).toBe('every');
    expect(item('All')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(item('Off'));
    expect(editorStore.getState().residueNumbering).toBe('off');
  });

  it('chooses which CDS features get a translation line (#304)', () => {
    open();
    const item = (name: string) => screen.getByRole('radio', { name });
    expect(item('One per gene')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(item('Selected CDS'));
    expect(editorStore.getState().translationScope).toBe('selected');
    fireEvent.click(item('Every CDS'));
    expect(editorStore.getState().translationScope).toBe('all');
    act(() => {
      editorStore.setTranslationScope('gene');
    });
  });

  it('offers a transcript per gene with variants, and shows all again (item 119)', () => {
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({ sequence: 'A'.repeat(INS_LENGTH), features: insShapedRecord() }),
        'ins.gb',
      );
    });
    open();
    // INS has four transcripts; the readthrough gene has one and no row.
    expect(screen.queryByRole('combobox', { name: 'Transcript of INS-IGF2' })).toBeNull();
    const pick = screen.getByRole('combobox', { name: 'Transcript of INS' });
    expect(pick).toHaveValue('all');
    expect([...pick.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All 4',
      'NM_001185098.2',
      'NM_001291897.2',
      'NM_001185097.2',
      'NM_000207.3',
    ]);
    fireEvent.change(pick, { target: { value: 'NM_000207.3' } });
    expect([...editorStore.getState().transcriptPicks]).toEqual([['INS', 'NM_000207.3']]);
    expect(pick).toHaveValue('NM_000207.3');
    expect(screen.getByText(/1 transcript picked/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Format/ })).toHaveTextContent('1 picked');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show all transcripts' }));
    expect(editorStore.getState().transcriptPicks.size).toBe(0);
    expect(pick).toHaveValue('all');
    // A document with no gene of two or more transcripts has no such group.
    act(() => {
      editorStore.openDocument(SeqDocument.create({ sequence: 'ACGT' }), 'plain.gb');
    });
    expect(screen.queryByRole('combobox', { name: 'Transcript of INS' })).toBeNull();
  });

  it('lists the feature types of the document and hides them (#305)', () => {
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({
          sequence: 'ACGT'.repeat(10),
          features: [
            createFeature({ type: 'CDS', name: 'a', segments: [rangeSegment(0, 12)] }),
            createFeature({ type: 'exon', name: 'b', segments: [rangeSegment(0, 6)] }),
            createFeature({ type: 'source', segments: [rangeSegment(0, 40)] }),
          ],
        }),
        'x.gb',
      );
    });
    open();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'source' })).toBeNull();
    expect(screen.getByRole('menuitemcheckbox', { name: 'CDS' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'exon' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'exon' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText(/1 type hidden/)).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show all feature types' }));
    expect(editorStore.getState().hiddenFeatureTypes.size).toBe(0);
  });

  it('starts with the three view toggles only where the toolbar has no room for them (#296)', () => {
    const { unmount } = render(<FormatMenu />);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Complement/ })).toBeNull();
    unmount();

    render(<FormatMenu viewToggles />);
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    const complement = screen.getByRole('menuitemcheckbox', { name: /^Complement/ });
    const was = editorStore.getState().showComplement;
    expect(complement).toHaveAttribute('aria-checked', String(was));
    expect(complement).toHaveAttribute('aria-keyshortcuts', 'Alt+C');
    fireEvent.click(complement);
    expect(editorStore.getState().showComplement).toBe(!was);
    expect(complement).toHaveAttribute('aria-checked', String(!was));
    // The menu stays open, as for every other Format item.
    const translations = screen.getByRole('menuitemcheckbox', { name: /^Translations/ });
    const sites = screen.getByRole('menuitemcheckbox', { name: /^Cut sites/ });
    const translationsWere = editorStore.getState().showTranslations;
    const sitesWere = editorStore.getState().showCutSites;
    fireEvent.click(translations);
    fireEvent.click(sites);
    expect(editorStore.getState().showTranslations).toBe(!translationsWere);
    expect(editorStore.getState().showCutSites).toBe(!sitesWere);
    act(() => {
      editorStore.setShowComplement(was);
      editorStore.setShowTranslations(translationsWere);
      editorStore.setShowCutSites(sitesWere);
    });
  });
});
