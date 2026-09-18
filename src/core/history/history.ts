export interface HistoryEntry<T> {
  readonly state: T;
  /** Human-readable description of the change that produced `state`. */
  readonly label: string;
  /** When the change was recorded, as epoch milliseconds. */
  readonly at: number;
}

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

  /** Records `next` as the new present. Discards any redo steps. */
  push(next: T, label: string, at: number = Date.now()): History<T> {
    if (next === this.present) return this;
    let past = [...this.past, { state: this.present, label, at }];
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

  undo(): History<T> {
    const entry = this.past[this.past.length - 1];
    if (entry === undefined) return this;
    return new History(
      entry.state,
      this.past.slice(0, -1),
      [...this.future, { state: this.present, label: entry.label, at: entry.at }],
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
      [...this.past, { state: this.present, label: entry.label, at: entry.at }],
      this.future.slice(0, -1),
      this.limit,
      this.startedAt,
      this.truncated,
    );
  }
}
