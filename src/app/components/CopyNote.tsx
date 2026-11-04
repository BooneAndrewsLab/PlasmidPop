interface Props {
  /** What the last copy or save did; null or empty for nothing yet. */
  readonly note: string | null;
}

/**
 * The line under an alignment that says what was just copied (#366, #368).
 * It always holds its line, empty until there is something to say, so a
 * copy never grows the window and flashes a scrollbar, and it is the same
 * line in the single-sample view and the multiple alignment.
 */
export function CopyNote({ note }: Props) {
  return (
    <div className="copy-note" role="status">
      {note}
    </div>
  );
}
