import { type HomologyKit, type LineageNode, type LineageStep } from './lineage';

const KITS: Readonly<Record<HomologyKit, string>> = {
  gibson: 'Gibson assembly',
  'in-fusion': 'In-Fusion assembly',
  nebuilder: 'NEBuilder HiFi assembly',
};

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function parts(n: number): string {
  return n === 1 ? '1 part' : `${n.toLocaleString()} parts`;
}

function flips(flipped: readonly boolean[]): string {
  const n = flipped.filter(Boolean).length;
  return n === 0 ? '' : `, ${n.toLocaleString()} turned over`;
}

/**
 * Where a digest fragment lay in its parent, 1-based and inclusive as the
 * views and GenBank count: `397–3082`, or across the origin `4100–120`.
 */
export function describeLineageRange(
  range: { readonly start: number; readonly end: number },
  parentLength: number,
): string {
  const from = range.start + 1;
  const to = parentLength > 0 ? ((range.end - 1) % parentLength) + 1 : range.end;
  return `${from.toLocaleString()}–${to.toLocaleString()}`;
}

/**
 * What a step did, in a line: the reaction and the settings that tell it
 * from another run of the same one. The parents are the tree's to show.
 */
export function describeLineageStep(step: LineageStep): string {
  switch (step.op) {
    case 'digest': {
      const parent = step.parents[0];
      const where =
        parent === undefined ? '' : ` · ${describeLineageRange(step.range, parent.length)}`;
      const cut = step.enzymes.length === 0 ? 'Uncut' : `Digest with ${list(step.enzymes)}`;
      const uncut =
        step.uncut === 0
          ? ''
          : `, partial: ${step.uncut.toLocaleString()} ${step.uncut === 1 ? 'site' : 'sites'} uncut`;
      return `${cut}${where}${uncut}`;
    }
    case 'pcr':
      return `PCR with ${step.forward.name} and ${step.reverse.name} · ${step.polymerase === 'taq' ? 'Taq' : 'proofreading'}`;
    case 'ligation':
      return `Ligation of ${parts(step.parents.length)}, ${step.circular ? 'circular' : 'linear'}${flips(step.flipped)}`;
    case 'golden-gate':
      return `Golden Gate with ${list(step.enzymes)} of ${parts(step.parents.length)}${flips(step.flipped)}`;
    case 'gibson':
      return `${KITS[step.kit]} of ${parts(step.parents.length)}${step.circular ? '' : ', linear'}`;
    case 'gateway':
      return `Gateway ${step.reaction} reaction${step.byproduct ? ', its byproduct' : ''}`;
    case 'mutagenesis':
      return `Mutagenesis ${step.change} · ${step.method === 'back-to-back' ? 'Q5 (back-to-back primers)' : 'QuikChange (overlapping primers)'}`;
    case 'phosphates':
      return step.removed ? 'Dephosphorylated' : 'Phosphorylated';
    case 'edited':
      return 'Edited after it was made';
    case 'elided':
      return `${step.nodes.toLocaleString()} earlier ${step.nodes === 1 ? 'molecule' : 'molecules'} not kept`;
  }
}

/** A lineage's root step in a line, for a summary; empty when it has none. */
export function describeLineage(node: LineageNode): string {
  return node.step === null ? '' : describeLineageStep(node.step);
}
