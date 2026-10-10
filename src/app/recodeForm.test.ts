import { CODON_USAGE_TABLES } from '@/core';

import { DEFAULT_RECODE_FORM, resolveRecodeForm } from './recodeForm';

describe('resolveRecodeForm (#209)', () => {
  const resolve = (patch: Partial<typeof DEFAULT_RECODE_FORM>) =>
    resolveRecodeForm({ ...DEFAULT_RECODE_FORM, ...patch }, CODON_USAGE_TABLES);

  it('turns the defaults into options', () => {
    const r = resolve({});
    if (!r.ok) throw new Error(r.error);
    expect(r.options.gcMin).toBeCloseTo(0.3);
    expect(r.options.gcMax).toBeCloseTo(0.7);
    expect(r.options.maxRun).toBe(6);
    expect(r.options.avoid).toEqual([]);
  });

  it('reads enzyme names, any case, as their sites', () => {
    const r = resolve({ avoid: 'ecori, BamHI;BsaI' });
    if (!r.ok) throw new Error(r.error);
    expect(r.options.avoid?.map((a) => [a.name, a.site])).toEqual([
      ['EcoRI', 'GAATTC'],
      ['BamHI', 'GGATCC'],
      ['BsaI', 'GGTCTC'],
    ]);
  });

  it('says what is wrong', () => {
    expect(resolve({ avoid: 'NotAnEnzyme' })).toEqual({
      ok: false,
      error: 'NotAnEnzyme is not an enzyme we know.',
    });
    expect(resolve({ gcMin: '80', gcMax: '40' }).ok).toBe(false);
    expect(resolve({ gcWindow: '3' }).ok).toBe(false);
    expect(resolve({ maxRun: '' }).ok).toBe(false);
    expect(resolve({ gcMax: '120' }).ok).toBe(false);
  });

  it('falls back to the first host for one it does not have', () => {
    const r = resolve({ host: 'gone' });
    if (!r.ok) throw new Error(r.error);
    expect(r.host.id).toBe(CODON_USAGE_TABLES[0]?.id);
  });
});
