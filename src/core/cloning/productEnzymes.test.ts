import { type DigestFragment } from './digest';
import {
  cloningSeed,
  goldenGateSeed,
  inheritedSeed,
  ligationSeed,
  resolveSeed,
} from './productEnzymes';

const part = (left: string | null, right: string | null): DigestFragment =>
  ({ left: { enzyme: left }, right: { enzyme: right } }) as unknown as DigestFragment;

describe('the enzymes a product opens with ticked', () => {
  it('ligation: the enzymes at the ends of the parts, each once, blunt ends naming none', () => {
    expect(ligationSeed([part('BamHI', 'EcoRI'), part('EcoRI', 'BamHI')])).toEqual([
      'BamHI',
      'EcoRI',
    ]);
    expect(ligationSeed([part('EcoRI', 'EcoRI')])).toEqual(['EcoRI']);
    expect(ligationSeed([part(null, 'PstI'), part('PstI', null)])).toEqual(['PstI']);
    expect(ligationSeed([part(null, null)])).toEqual([]);
  });

  it('restriction cloning: the two primers enzymes, one when they are the same', () => {
    expect(cloningSeed('EcoRI', 'BamHI')).toEqual(['EcoRI', 'BamHI']);
    expect(cloningSeed('NcoI', 'NcoI')).toEqual(['NcoI']);
  });

  it('Golden Gate and Modular: the Type IIS enzyme, and the second when set', () => {
    expect(goldenGateSeed('BsaI')).toEqual(['BsaI']);
    expect(goldenGateSeed('BsaI', 'BsmBI')).toEqual(['BsaI', 'BsmBI']);
    expect(goldenGateSeed('BsaI', 'BsaI')).toEqual(['BsaI']);
    expect(goldenGateSeed(undefined)).toEqual([]);
  });

  it('a single-parent edit: what the parent has ticked', () => {
    expect(inheritedSeed(new Set(['EcoRI', 'NotI']))).toEqual(['EcoRI', 'NotI']);
    expect(inheritedSeed(new Set())).toEqual([]);
  });

  it('resolves names against the table, spelling as the table does, ignoring unknown ones', () => {
    const table = [{ name: 'EcoRI' }, { name: 'BamHI' }];
    expect([...(resolveSeed(['ecori', 'Nope', 'BamHI'], table) ?? [])]).toEqual(['EcoRI', 'BamHI']);
    expect(resolveSeed(['Nope'], table)).toBeNull();
    expect(resolveSeed([], table)).toBeNull();
  });
});
