import {
  type Feature,
  type Range,
  type Segment,
  type Topology,
  firstQualifier,
  formatLocation,
  rangePieces,
  rangeSegment,
} from '@/core';

/**
 * Display-time grouping of features that would otherwise stack lane on lane
 * (item 115, #308). An NCBI gene record repeats its processing features once
 * per transcript variant — four identical `sig_peptide`s, four CDSs that
 * differ only in `/protein_id` — and lists one mRNA per variant; drawn one
 * each, the INS record took 21 lanes for 35 features and its map no longer
 * fit the canvas. The views draw each group as one bar instead:
 *
 * - **copies**: features of one type, strand and location, whatever their
 *   qualifiers, as one bar labelled with a count (`sig_peptide ×4`);
 * - **transcripts**: a gene's mRNAs (by `/gene`, as the translation scope
 *   groups CDSs), as the union of their exons labelled `INS · 4 transcripts`,
 *   which expands in place to a row per transcript under it.
 *
 * Like `drawableFeatures` and the hidden types (item 109), this is a view
 * of `doc.features`: the document, the Features list, undo and every writer
 * see the members, never the stand-in. Hidden types are filtered before
 * this runs, so a group is only ever made of what is drawn.
 */

export type FeatureGroupKind = 'copies' | 'transcripts';

export interface FeatureGroup {
  /** The stand-in's id, which the lanes and the hit tests carry; never a feature's. */
  readonly id: string;
  readonly kind: FeatureGroupKind;
  /** The members in document order; the first is what selecting the group selects. */
  readonly members: readonly Feature[];
  /** The one feature drawn in the members' place. */
  readonly standIn: Feature;
  /** A transcripts group drawn with a row per member under it; always false for copies. */
  readonly expanded: boolean;
}

export interface GroupedFeatures {
  /**
   * What the lanes are packed from and the views draw, in document order:
   * every feature in no group as it is, each group as its stand-in, and
   * under an expanded group its members.
   */
  readonly features: readonly Feature[];
  /** Every group, by its stand-in's id. */
  readonly groups: ReadonlyMap<string, FeatureGroup>;
  /** The group each member is in, by the member's id. */
  readonly groupOf: ReadonlyMap<string, FeatureGroup>;
}

const GROUP_PREFIX = 'group:';
const NO_GROUPS: ReadonlySet<string> = new Set();

/** Whether an id in a lane is a group's rather than a feature's. */
export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX);
}

function segmentKey(seg: Segment): string {
  if (seg.kind === 'site') return `@${String(seg.position)}`;
  return `${String(seg.start)}-${String(seg.end)}${seg.partialStart ? '<' : ''}${seg.partialEnd ? '>' : ''}${seg.single === true ? '.' : ''}`;
}

/** Type, strand and location, qualifiers left out: what two copies share. */
function copiesKey(f: Feature): string {
  return `${f.type}\u0000${f.strand}\u0000${f.joining ?? ''}\u0000${f.segments.map(segmentKey).join(',')}`;
}

/** The gene a transcript belongs to, for grouping; undefined for one that names none. */
function transcriptGene(f: Feature): string | undefined {
  if (f.type !== 'mRNA') return undefined;
  const gene = firstQualifier(f, 'gene')?.trim();
  return gene === undefined || gene === '' ? undefined : gene;
}

/** What a feature is called on its bar: its name, or its type when it has none. */
export function featureLabel(f: Feature): string {
  return f.name === '' ? f.type : f.name;
}

/**
 * The bases the members cover, merged, as segments in forward order. On a
 * circular sequence a union that runs through the origin is one segment
 * past the end, as a wrapped feature's is, so the arrow stays on the right
 * end of it.
 */
function unionSegments(members: readonly Feature[], seqLength: number): Segment[] {
  const pieces: Range[] = [];
  let wraps = false;
  for (const m of members)
    for (const seg of m.segments) {
      if (seg.kind !== 'range') continue;
      if (seg.end > seqLength) wraps = true;
      pieces.push(...rangePieces(seg, seqLength));
    }
  pieces.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && p.start <= last.end) {
      if (p.end > last.end) merged[merged.length - 1] = { start: last.start, end: p.end };
    } else merged.push(p);
  }
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (wraps && merged.length > 1 && first !== undefined && last !== undefined) {
    if (first.start === 0 && last.end === seqLength) {
      merged.pop();
      merged.shift();
      merged.unshift({ start: last.start, end: seqLength + first.end });
    }
  }
  return merged.map((p) => rangeSegment(p.start, p.end));
}

function copiesStandIn(id: string, members: readonly Feature[]): Feature {
  const first = members[0];
  if (first === undefined) throw new Error('A group needs a member');
  return {
    id,
    type: first.type,
    name: `${featureLabel(first)} ×${String(members.length)}`,
    strand: first.strand,
    segments: first.segments,
    ...(first.joining === 'order' ? { joining: 'order' as const } : {}),
    qualifiers: first.qualifiers,
  };
}

function transcriptsStandIn(
  id: string,
  gene: string,
  members: readonly Feature[],
  seqLength: number,
  expanded: boolean,
  selected: boolean,
): Feature {
  const first = members[0];
  if (first === undefined) throw new Error('A group needs a member');
  return {
    id,
    type: first.type,
    // The arrow says a second click opens the row, so it shows once a first
    // click has selected it: before that a click on it would seem to do nothing.
    name: `${gene} · ${String(members.length)} transcripts${expanded ? ' ▾' : selected ? ' ▸' : ''}`,
    strand: first.strand,
    segments: unionSegments(members, seqLength),
    qualifiers: first.qualifiers,
  };
}

/**
 * Groups `features` (already filtered by `drawableFeatures`) for drawing.
 * `expanded` holds the ids of the transcript groups shown with their
 * members; `selectedId` is the selected feature, whose group shows its arrow. A gene with one mRNA is no group, and a feature that is the only
 * one of its kind at its place is drawn as itself; every group has at least
 * two members.
 */
export function groupFeatures(
  features: readonly Feature[],
  seqLength: number,
  expanded: ReadonlySet<string> = NO_GROUPS,
  selectedId: string | null = null,
): GroupedFeatures {
  // A gene's transcripts first: those collapse to a row per gene whatever
  // their locations, so copies are only looked for among what is left.
  const transcripts = new Map<string, Feature[]>();
  for (const f of features) {
    const gene = transcriptGene(f);
    if (gene === undefined) continue;
    const key = `${GROUP_PREFIX}transcripts:${f.strand}:${gene}`;
    const list = transcripts.get(key) ?? [];
    list.push(f);
    transcripts.set(key, list);
  }
  const groups = new Map<string, FeatureGroup>();
  const groupOf = new Map<string, FeatureGroup>();
  const transcriptOf = new Map<string, FeatureGroup>();
  for (const [id, members] of transcripts) {
    if (members.length < 2) continue;
    const first = members[0];
    const gene = first === undefined ? '' : (transcriptGene(first) ?? '');
    const group: FeatureGroup = {
      id,
      kind: 'transcripts',
      members,
      standIn: transcriptsStandIn(
        id,
        gene,
        members,
        seqLength,
        expanded.has(id),
        members.some((m) => m.id === selectedId),
      ),
      expanded: expanded.has(id),
    };
    groups.set(id, group);
    for (const m of members) {
      groupOf.set(m.id, group);
      transcriptOf.set(m.id, group);
    }
  }

  // Then the copies, among the features drawn on their own: those in no
  // transcript group, and the members of an expanded one.
  const copies = new Map<string, Feature[]>();
  for (const f of features) {
    const t = transcriptOf.get(f.id);
    if (t !== undefined && !t.expanded) continue;
    const key = `${GROUP_PREFIX}copies:${copiesKey(f)}`;
    const list = copies.get(key) ?? [];
    list.push(f);
    copies.set(key, list);
  }
  const copyOf = new Map<string, FeatureGroup>();
  for (const [id, members] of copies) {
    if (members.length < 2) continue;
    const group: FeatureGroup = {
      id,
      kind: 'copies',
      members,
      standIn: copiesStandIn(id, members),
      expanded: false,
    };
    groups.set(id, group);
    for (const m of members) {
      copyOf.set(m.id, group);
      // A transcript under an expanded group that is also a copy: the copies
      // group is what is drawn for it, so a hit on that bar lands there.
      groupOf.set(m.id, group);
    }
  }

  // In document order, each stand-in where its first member was.
  const out: Feature[] = [];
  const emitted = new Set<string>();
  for (const f of features) {
    const t = transcriptOf.get(f.id);
    if (t !== undefined) {
      if (!emitted.has(t.id)) {
        emitted.add(t.id);
        out.push(t.standIn);
      }
      if (!t.expanded) continue;
    }
    const c = copyOf.get(f.id);
    if (c === undefined) out.push(f);
    else if (!emitted.has(c.id)) {
      emitted.add(c.id);
      out.push(c.standIn);
    }
  }
  return { features: out, groups, groupOf };
}

/**
 * The feature a hit on `id` stands for: the feature itself, or, for a
 * group's stand-in, the member the user can act on, which is the first in
 * document order. Undefined for an id the views know nothing of.
 */
export function featureForHit(
  grouped: GroupedFeatures,
  id: string,
  lookup: (featureId: string) => Feature | undefined,
): Feature | undefined {
  const group = grouped.groups.get(id);
  return group === undefined ? lookup(id) : group.members[0];
}

/** Qualifiers of one member that not every member of the group carries, as `/name=value`. */
function differingQualifiers(member: Feature, group: FeatureGroup): string[] {
  const shared = new Set<string>();
  const first = group.members[0];
  if (first !== undefined)
    for (const q of first.qualifiers) shared.add(`${q.name}\u0000${q.value ?? ''}`);
  for (const m of group.members.slice(1)) {
    const own = new Set(m.qualifiers.map((q) => `${q.name}\u0000${q.value ?? ''}`));
    for (const key of [...shared]) if (!own.has(key)) shared.delete(key);
  }
  return member.qualifiers
    .filter((q) => !shared.has(`${q.name}\u0000${q.value ?? ''}`))
    .map((q) => (q.value === null ? `/${q.name}` : `/${q.name}=${q.value}`));
}

/**
 * One line per member, for the tooltip and the inspector: what each one is
 * and, for copies, the qualifiers that tell it from the others (`identical`
 * when nothing does).
 */
export function describeGroupMembers(
  group: FeatureGroup,
  seqLength: number,
  topology: Topology,
): string[] {
  return group.members.map((m) => {
    if (group.kind === 'transcripts') {
      const id = firstQualifier(m, 'transcript_id');
      const where = formatLocation(m, seqLength, topology);
      return `${featureLabel(m)}${id === undefined ? '' : ` (${id})`}: ${where}`;
    }
    const differs = differingQualifiers(m, group);
    return `${featureLabel(m)}: ${differs.length === 0 ? 'identical' : differs.join(' ')}`;
  });
}

/** The tooltip over a group's bar: what it stands for, and how to open it. */
export function groupTip(group: FeatureGroup, seqLength: number, topology: Topology): string {
  const n = String(group.members.length);
  const head =
    group.kind === 'transcripts'
      ? `${n} transcripts drawn as one row (${group.expanded ? 'click to collapse' : 'click to select, again to expand'})`
      : `${n} features drawn as one bar`;
  return [head, ...describeGroupMembers(group, seqLength, topology)].join('\n');
}
