export interface HistoryEntry<T> {
  readonly state: T;
  /** Human-readable description of the change that produced `state`. */
  readonly label: string;
}

export interface HistoryOptions {
  /** Maximum number of undo steps kept. Older ones are dropped. */
  readonly limit?: number;
}

/**
 * Immutable undo/redo stack over immutable states. Since document versions
 * share structure, storing whole states is cheap and avoids inverse-op bugs.
 */
export class History<T> {
  static create<T>(present: T, options: HistoryOptions = {}): History<T> {
    return new History(present, [], [], options.limit ?? 200);
  }

  private constructor(
    readonly present: T,
    private readonly past: readonly HistoryEntry<T>[],
    private readonly future: readonly HistoryEntry<T>[],
    readonly limit: number,
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

  /** Undoes or redoes as many steps as needed to have `position` changes applied. */
  jumpTo(position: number): History<T> {
    const target = Math.max(0, Math.min(this.past.length + this.future.length, position));
    if (this.position > target) return this.undo().jumpTo(target);
    if (this.position < target) return this.redo().jumpTo(target);
    return this;
  }

  /** Records `next` as the new present. Discards any redo steps. */
  push(next: T, label: string): History<T> {
    if (next === this.present) return this;
    let past = [...this.past, { state: this.present, label }];
    if (past.length > this.limit) past = past.slice(past.length - this.limit);
    return new History(next, past, [], this.limit);
  }

  undo(): History<T> {
    const entry = this.past[this.past.length - 1];
    if (entry === undefined) return this;
    return new History(
      entry.state,
      this.past.slice(0, -1),
      [...this.future, { state: this.present, label: entry.label }],
      this.limit,
    );
  }

  redo(): History<T> {
    const entry = this.future[this.future.length - 1];
    if (entry === undefined) return this;
    return new History(
      entry.state,
      [...this.past, { state: this.present, label: entry.label }],
      this.future.slice(0, -1),
      this.limit,
    );
  }
}
