export interface HistoryEntry<T> {
  readonly state: T;
  /** Human-readable description of the change that produced `state`. */
  readonly label: string;
  /** When the change was recorded, as epoch milliseconds. */
  readonly at: number;
  /**
   * What the next change must name in `Coalesce.follows` to merge into this
   * step instead of starting a new one. Absent on a step nothing may join.
   */
  readonly coalesceKey?: string;
  /** How many changes this one step holds; absent means the usual one. */
  readonly merged?: number;
}

/**
 * How a change may merge into the one before it, so that a run of small
 * related changes — typing base after base, holding Backspace — is one undo
 * step rather than dozens.
 *
 * The two keys make a run: a change merges when the step before it offers
 * exactly the `follows` it asks for, and the merged step then offers this
 * change's own `key` to whatever comes next. Keys therefore describe both
 * what kind of run this is and where it has got to, so that typing at the
 * caret continues a run while typing somewhere else begins one.
 *
 * Merging never reaches across an undo: a change is only ever folded into
 * the step immediately before it, in an unbroken run, and `seal()` ends a
 * run at a point that has to stay reachable on its own.
 */
export interface Coalesce {
  /** Merges into the previous step when that step's key is this. */
  readonly follows: string;
  /** The key the step offers to the change after it. */
  readonly key: string;
  /** Most changes that may become one step; the run breaks past that. */
  readonly limit?: number;
  /** Longest pause between two changes that still merges them, in ms. */
  readonly withinMs?: number;
  /** Label for the merged step, given how many changes it now holds. */
  readonly relabel?: (merged: number) => string;
}

/** Default for `Coalesce.withinMs`: a pause this long ends a run. */
export const DEFAULT_COALESCE_MS = 2000;

export interface HistoryOptions {
  /** Maximum number of undo steps kept. Older ones are dropped. */
  readonly limit?: number;
  /** When the starting state came into being; defaults to now. */
  readonly at?: number;
}

/** One recorded change, with the state it leads to. */
export interface HistoryStep<T> {
  /**
   * Number of changes applied once this step is in effect, so the first
   * change is 1. `jumpTo(position)` puts the document in `state`.
   */
  readonly position: number;
  readonly label: string;
  /** When the change was recorded, as epoch milliseconds. */
  readonly at: number;
  /** The state with this change applied. */
  readonly state: T;
}

/**
 * Immutable undo/redo stack over immutable states. Since document versions
 * share structure, storing whole states is cheap and avoids inverse-op bugs.
 */
export class History<T> {
  static create<T>(present: T, options: HistoryOptions = {}): History<T> {
    return new History(present, [], [], options.limit ?? 200, options.at ?? Date.now(), false);
  }

  private constructor(
    readonly present: T,
    private readonly past: readonly HistoryEntry<T>[],
    private readonly future: readonly HistoryEntry<T>[],
    readonly limit: number,
    /** When the oldest kept state was reached; the timestamp of step 0. */
    readonly startedAt: number,
    /** Whether steps older than `limit` were dropped, so step 0 is not the opened state. */
    readonly truncated: boolean,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Label of the change `undo()` would revert, if any. */
  get undoLabel(): string | undefined {
    return this.past[this.past.length - 1]?.label;
  }

  /** Label of the change `redo()` would re-apply, if any. */
  get redoLabel(): string | undefined {
    return this.future[this.future.length - 1]?.label;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  /**
   * Labels of every recorded change, oldest first: the undone ones follow
   * the applied ones. `position` says how many of them are applied.
   */
  get labels(): readonly string[] {
    const future = this.future.map((e) => e.label);
    future.reverse();
    return [...this.past.map((e) => e.label), ...future];
  }

  /** Number of applied changes; `labels[position - 1]` is what `undo()` reverts. */
  get position(): number {
    return this.past.length;
  }

  /** How many changes are recorded, applied and undone together. */
  get size(): number {
    return this.past.length + this.future.length;
  }

  /**
   * Every recorded change, oldest first, each with the state it produces, so
   * a history view can describe a step by what it did to the document.
   */
  get steps(): readonly HistoryStep<T>[] {
    // `past[i]` keeps the state *before* change i + 1, so a change's own state
    // is the next entry's, and the last applied change leads to the present.
    const applied = this.past.map((entry, i) => ({
      position: i + 1,
      label: entry.label,
      at: entry.at,
      state: this.past[i + 1]?.state ?? this.present,
    }));
    // `future` is a stack: its last element is the next redo.
    const undone = [...this.future].reverse().map((entry, i) => ({
      position: this.past.length + i + 1,
      label: entry.label,
      at: entry.at,
      state: entry.state,
    }));
    return [...applied, ...undone];
  }

  /** The state with `position` changes applied, or undefined when out of range. */
  stateAt(position: number): T | undefined {
    if (position === this.position) return this.present;
    if (position < this.position) return this.past[position]?.state;
    return this.future[this.size - position]?.state;
  }

  /** Undoes or redoes as many steps as needed to have `position` changes applied. */
  jumpTo(position: number): History<T> {
    const target = Math.max(0, Math.min(this.size, position));
    if (this.position > target) return this.undo().jumpTo(target);
    if (this.position < target) return this.redo().jumpTo(target);
    return this;
  }

  /**
   * Records `next` as the new present. Discards any redo steps.
   *
   * With a `coalesce` whose `follows` is what the step before offers, the
   * change is folded into that step instead of adding one: the step keeps
   * the state it started from, so undo still reaches back past the whole
   * run, and takes on the new label, time and key. A run breaks on a pause
   * longer than `withinMs`, once it holds `limit` changes, after an undo
   * (there is a redo stack to discard), and wherever `seal()` was called.
   */
  push(next: T, label: string, at: number = Date.now(), coalesce?: Coalesce): History<T> {
    if (next === this.present) return this;
    const merged = this.mergePush(next, at, coalesce);
    if (merged !== null) return merged;
    const entry: HistoryEntry<T> =
      coalesce === undefined
        ? { state: this.present, label, at }
        : { state: this.present, label, at, coalesceKey: coalesce.key };
    let past = [...this.past, entry];
    let startedAt = this.startedAt;
    let truncated = this.truncated;
    if (past.length > this.limit) {
      const dropped = past.length - this.limit;
      // The oldest kept state is now the starting point, so step 0 is dated
      // by the change that produced it and no longer is the opened document.
      startedAt = past[dropped - 1]?.at ?? startedAt;
      past = past.slice(dropped);
      truncated = true;
    }
    return new History(next, past, [], this.limit, startedAt, truncated);
  }

  /**
   * The history with `next` folded into the last step, or null when this
   * change does not continue a run and has to become a step of its own.
   */
  private mergePush(next: T, at: number, coalesce: Coalesce | undefined): History<T> | null {
    const last = this.past[this.past.length - 1];
    if (coalesce === undefined || last === undefined) return null;
    // A redo stack means the user has undone something: the run is over.
    if (this.future.length > 0) return null;
    // An unsealed step offers a key; a sealed one has none and matches nothing.
    if (last.coalesceKey !== coalesce.follows) return null;
    if (at - last.at > (coalesce.withinMs ?? DEFAULT_COALESCE_MS)) return null;
    const count = (last.merged ?? 1) + 1;
    if (coalesce.limit !== undefined && count > coalesce.limit) return null;
    const past = [
      ...this.past.slice(0, -1),
      // The state stays the one the run started from, so this is still a
      // single step back to before the first change of the run.
      {
        ...last,
        label: coalesce.relabel?.(count) ?? last.label,
        at,
        coalesceKey: coalesce.key,
        merged: count,
      },
    ];
    return new History(next, past, [], this.limit, this.startedAt, this.truncated);
  }

  /**
   * Ends any run at the present, so the next change starts a step of its own
   * and this state stays reachable as a step. Callers seal wherever the
   * present has become a landmark: it was written to a file, or the user
   * marked it.
   */
  seal(): History<T> {
    const last = this.past[this.past.length - 1];
    if (last?.coalesceKey === undefined) return this;
    const { coalesceKey: _dropped, ...sealed } = last;
    return new History(
      this.present,
      [...this.past.slice(0, -1), sealed],
      this.future,
      this.limit,
      this.startedAt,
      this.truncated,
    );
  }

  undo(): History<T> {
    const entry = this.past[this.past.length - 1];
    if (entry === undefined) return this;
    return new History(
      entry.state,
      this.past.slice(0, -1),
      [...this.future, { ...entry, state: this.present }],
      this.limit,
      this.startedAt,
      this.truncated,
    );
  }

  redo(): History<T> {
    const entry = this.future[this.future.length - 1];
    if (entry === undefined) return this;
    return new History(
      entry.state,
      [...this.past, { ...entry, state: this.present }],
      this.future.slice(0, -1),
      this.limit,
      this.startedAt,
      this.truncated,
    );
  }
}
