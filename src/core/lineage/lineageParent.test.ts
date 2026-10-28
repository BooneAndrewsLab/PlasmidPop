import { type LineageNode, lineageParent } from './lineage';

const node = (name: string, checksum: string | null, step: LineageNode['step'] = null) => ({
  name,
  checksum,
  topology: 'linear' as const,
  length: 10,
  step,
});

describe('lineageParent', () => {
  it('is the first parent of the root step, by name and checksum', () => {
    const root = node('product', 'cdseguid=p', {
      op: 'ligation',
      parents: [node('vector', 'cdseguid=v'), node('insert', 'cdseguid=i')],
      circular: true,
      flipped: [false, false],
    });
    expect(lineageParent(root)).toEqual({ name: 'vector', checksum: 'cdseguid=v' });
  });

  it('is null with no lineage, no step, no parents, or a first parent with no checksum', () => {
    expect(lineageParent(null)).toBeNull();
    expect(lineageParent(undefined)).toBeNull();
    expect(lineageParent(node('opened', 'cdseguid=o'))).toBeNull();
    const noParents = node('x', 'c', { op: 'elided', parents: [] } as never);
    expect(lineageParent(noParents)).toBeNull();
    const unsummed = node('p', 'c', {
      op: 'pcr',
      parents: [node('template', null)],
      forward: { name: 'f', sequence: 'ACGT' },
      reverse: { name: 'r', sequence: 'ACGT' },
      polymerase: 'taq',
    });
    expect(lineageParent(unsummed)).toBeNull();
  });
});
