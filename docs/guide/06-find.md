# Find

Press `Ctrl+F`, or click **Find** in the edit bar, to open the find bar above
the views. What you type decides what is searched:

- **Three or more IUPAC letters** search the sequence on both strands.
  Ambiguity codes work in the query: `GRCGYC` finds every BsaHI site, and
  `N` matches any base. An `N` in the sequence only matches an `N` in the
  query. Matches wrap around the origin of a circular sequence.
- **Anything else** searches feature names and types, case-insensitively,
  so `tet` finds _tet_ and _tetR_, and `promoter` finds every promoter.

The counter shows which match is current, how many there are, and whether a
sequence match is on the forward or reverse strand. The current match is
selected and both views scroll to it, so anything that works on a selection
(Add feature, Copy, Translate, Design primers) works on a find result.

While the bar is open, **every** match is drawn in both views as a dashed
preview (see [Previews](03-viewing.md#previews)), so you can see how the
matches are spread over the molecule and not only where the next one is. The
current one stays highlighted as the selection on top of that. Past 200
matches the views are left clear — the count answers the question better
than 200 marks would. Nothing is added to the document, and the marks go
when the bar closes.

- `Enter` or **↓** goes to the next match, `Shift+Enter` or **↑** to the
  previous one.
- `Escape` or **Close** closes the bar and leaves the last match selected.

## How to find a restriction site by sequence

1. Press `Ctrl+F`.
2. Type the recognition sequence, for example `GAATTC`.
3. Step through the hits with `Enter`.

For a list of sites per enzyme, with cut positions and fragment sizes, use
the [Enzymes](07-enzymes.md) tab instead.
