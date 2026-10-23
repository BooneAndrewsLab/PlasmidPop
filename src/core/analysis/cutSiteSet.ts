import { type EnzymeSites } from './enzymeDigest';
import { type CutSite } from './restriction';

/**
 * The cut sites of one restriction scan, read by enzyme (#281). The scan's
 * order is `findCutSites`' (by cut, ties by name), and every list here keeps
 * it, so `pick(names)` is what `all().filter(s => names.has(s.enzyme))` was.
 *
 * A scan the worker answered is kept packed, four integers a site, and an
 * enzyme's site objects are made when something asks for them and kept from
 * then on: at 4.64 Mb that is 446,000 sites, whose objects set off a 35-80 ms
 * collection in the open when they were all made at once. A result carried
 * through an edit is an array of objects already (`cutSiteSetOf`).
 */
export interface CutSiteSet {
  /** How many sites in all. */
  readonly size: number;
  /** How many sites `enzyme` has; 0 for an enzyme without one. */
  count(enzyme: string): number;
  /** Per enzyme with a site, how many it has. */
  counts(): ReadonlyMap<string, number>;
  /** `enzyme`'s sites in the scan's order, made on the first call and kept. */
  of(enzyme: string): readonly CutSite[];
  /** The sites of `enzymes`, in the scan's order. */
  pick(enzymes: ReadonlySet<string>): readonly CutSite[];
  /** Every site in the scan's order; makes the objects of all of them. */
  all(): readonly CutSite[];
}

const NONE: readonly CutSite[] = [];

/** A set over sites that are objects already, as `findCutSites` gives them. */
export function cutSiteSetOf(sites: readonly CutSite[]): CutSiteSet {
  return new ArraySet(sites);
}

/** `sites` as a set, unless it is one already. */
export function toCutSiteSet(sites: CutSiteSet | readonly CutSite[]): CutSiteSet {
  return isCutSiteArray(sites) ? cutSiteSetOf(sites) : sites;
}

function isCutSiteArray(sites: CutSiteSet | readonly CutSite[]): sites is readonly CutSite[] {
  return Array.isArray(sites);
}

class ArraySet implements CutSiteSet {
  private groups: Map<string, CutSite[]> | undefined;
  private tally: Map<string, number> | undefined;

  constructor(private readonly sites: readonly CutSite[]) {}

  get size(): number {
    return this.sites.length;
  }

  private byName(): Map<string, CutSite[]> {
    if (this.groups === undefined) {
      const groups = new Map<string, CutSite[]>();
      for (const s of this.sites) {
        const group = groups.get(s.enzyme);
        if (group === undefined) groups.set(s.enzyme, [s]);
        else group.push(s);
      }
      this.groups = groups;
    }
    return this.groups;
  }

  count(enzyme: string): number {
    return this.byName().get(enzyme)?.length ?? 0;
  }

  counts(): ReadonlyMap<string, number> {
    this.tally ??= new Map([...this.byName()].map(([name, group]) => [name, group.length]));
    return this.tally;
  }

  of(enzyme: string): readonly CutSite[] {
    return this.byName().get(enzyme) ?? NONE;
  }

  pick(enzymes: ReadonlySet<string>): readonly CutSite[] {
    return enzymes.size === 0 ? NONE : this.sites.filter((s) => enzymes.has(s.enzyme));
  }

  all(): readonly CutSite[] {
    return this.sites;
  }
}

/**
 * The sites as the worker packs them (`PackedCutSites`): per site, `enzyme
 * index << 1 | reverse`, cut, cutBottom, siteStart, in the scan's order;
 * `enzymes` is what the indices point at. `host` is the digest's marks, one
 * per site in the same order, for the per-enzyme views (`groups`). The
 * names are distinct, as `packCutSites` gives them.
 */
export class PackedCutSiteSet implements CutSiteSet {
  readonly size: number;
  private readonly index = new Map<string, number>();
  /** Per enzyme, where its sites begin in `order`; one more entry closes the last. */
  private readonly offsets: Int32Array;
  /** The sites' indices grouped by enzyme, each group in the scan's order. */
  private readonly order: Int32Array;
  /** Per entry of `order`, its site's top-strand cut. */
  private readonly groupCuts: Int32Array;
  /** Per entry of `order`, its site's host marks. */
  private readonly groupHost: Uint8Array;
  /** Per enzyme, its site objects once all of them are made. */
  private readonly made: (readonly CutSite[] | undefined)[];
  /** Per enzyme, the odd site made before all of them were (a row of the Enzymes tab). */
  private readonly some: (Map<number, CutSite> | undefined)[];
  private views: ReadonlyMap<string, EnzymeSites> | undefined;
  private everything: readonly CutSite[] | undefined;
  private tally: ReadonlyMap<string, number> | undefined;

  constructor(
    private readonly data: Int32Array,
    private readonly enzymes: readonly string[],
    host: ArrayLike<number> = new Uint8Array(0),
  ) {
    const n = data.length >> 2;
    this.size = n;
    const e = enzymes.length;
    enzymes.forEach((name, i) => this.index.set(name, i));
    // A counting sort by enzyme: the shares, then each site into its place.
    const offsets = new Int32Array(e + 1);
    for (let i = 0; i < n; i++) {
      const k = (data[i * 4] ?? 0) >> 1;
      offsets[k + 1] = (offsets[k + 1] ?? 0) + 1;
    }
    for (let k = 0; k < e; k++) offsets[k + 1] = (offsets[k + 1] ?? 0) + (offsets[k] ?? 0);
    const next = offsets.slice(0, e);
    const order = new Int32Array(n);
    const groupCuts = new Int32Array(n);
    const groupHost = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = (data[i * 4] ?? 0) >> 1;
      const at = next[k] ?? 0;
      next[k] = at + 1;
      order[at] = i;
      groupCuts[at] = data[i * 4 + 1] ?? 0;
      groupHost[at] = host[i] ?? 0;
    }
    this.offsets = offsets;
    this.order = order;
    this.groupCuts = groupCuts;
    this.groupHost = groupHost;
    this.made = enzymes.map(() => undefined);
    this.some = enzymes.map(() => undefined);
  }

  private site(i: number): CutSite {
    const { data } = this;
    const head = data[i * 4] ?? 0;
    return {
      enzyme: this.enzymes[head >> 1] ?? '',
      cut: data[i * 4 + 1] ?? 0,
      cutBottom: data[i * 4 + 2] ?? 0,
      siteStart: data[i * 4 + 3] ?? 0,
      strand: (head & 1) === 1 ? 'reverse' : 'forward',
    };
  }

  private shareOf(k: number): number {
    return (this.offsets[k + 1] ?? 0) - (this.offsets[k] ?? 0);
  }

  /** Enzyme `k`'s `j`-th site, made once. */
  private siteOf(k: number, j: number): CutSite | undefined {
    if (j < 0 || j >= this.shareOf(k)) return undefined;
    const made = this.made[k];
    if (made !== undefined) return made[j];
    let some = this.some[k];
    if (some === undefined) {
      some = new Map();
      this.some[k] = some;
    }
    let site = some.get(j);
    if (site === undefined) {
      site = this.site(this.order[(this.offsets[k] ?? 0) + j] ?? 0);
      some.set(j, site);
    }
    return site;
  }

  private sitesOf(k: number): readonly CutSite[] {
    let made = this.made[k];
    if (made === undefined) {
      const from = this.offsets[k] ?? 0;
      const share = this.shareOf(k);
      const some = this.some[k];
      const out: CutSite[] = [];
      for (let j = 0; j < share; j++) {
        out.push(some?.get(j) ?? this.site(this.order[from + j] ?? 0));
      }
      made = out;
      this.made[k] = made;
      this.some[k] = undefined;
    }
    return made;
  }

  count(enzyme: string): number {
    const k = this.index.get(enzyme);
    return k === undefined ? 0 : this.shareOf(k);
  }

  counts(): ReadonlyMap<string, number> {
    if (this.tally === undefined) {
      const tally = new Map<string, number>();
      this.enzymes.forEach((name, k) => {
        const share = this.shareOf(k);
        if (share > 0) tally.set(name, share);
      });
      this.tally = tally;
    }
    return this.tally;
  }

  of(enzyme: string): readonly CutSite[] {
    const k = this.index.get(enzyme);
    return k === undefined ? NONE : this.sitesOf(k);
  }

  pick(enzymes: ReadonlySet<string>): readonly CutSite[] {
    const wanted: number[] = [];
    for (const name of enzymes) {
      const k = this.index.get(name);
      if (k !== undefined && this.shareOf(k) > 0) wanted.push(k);
    }
    const [only] = wanted;
    if (only === undefined) return NONE;
    return wanted.length === 1 ? this.sitesOf(only) : this.merge(wanted);
  }

  /** The sites of the enzymes `ks`, back in the scan's order. */
  private merge(ks: readonly number[]): readonly CutSite[] {
    const wanted = new Uint8Array(this.enzymes.length);
    for (const k of ks) wanted[k] = 1;
    const groups = this.enzymes.map((_, k) => (wanted[k] === 1 ? this.sitesOf(k) : NONE));
    const cursor = new Int32Array(this.enzymes.length);
    const out: CutSite[] = [];
    const { data, size } = this;
    for (let i = 0; i < size; i++) {
      const k = (data[i * 4] ?? 0) >> 1;
      if (wanted[k] !== 1) continue;
      const j = cursor[k] ?? 0;
      cursor[k] = j + 1;
      const site = groups[k]?.[j];
      if (site !== undefined) out.push(site);
    }
    return out;
  }

  all(): readonly CutSite[] {
    this.everything ??= this.merge(this.enzymes.map((_, k) => k));
    return this.everything;
  }

  /**
   * Per enzyme with a site, its sites as the Enzymes tab reads them: counts,
   * cuts and host marks out of the packed arrays, objects only when asked
   * for, and the same objects `of` gives.
   */
  groups(): ReadonlyMap<string, EnzymeSites> {
    if (this.views === undefined) {
      const views = new Map<string, EnzymeSites>();
      this.enzymes.forEach((name, k) => {
        const share = this.shareOf(k);
        if (share === 0) return;
        const from = this.offsets[k] ?? 0;
        views.set(name, {
          count: share,
          cuts: this.groupCuts.subarray(from, from + share),
          host: this.groupHost.subarray(from, from + share),
          site: (j) => this.siteOf(k, j),
          sites: () => this.sitesOf(k),
        });
      });
      this.views = views;
    }
    return this.views;
  }
}
