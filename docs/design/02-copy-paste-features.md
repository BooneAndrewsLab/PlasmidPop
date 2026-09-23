# 2. Copy and paste with features

Done. Ctrl+C/X in the sequence
view copies the selection as a `SeqFragment` (bases plus trimmed
features, `source` left behind; `src/core/document/fragment.ts`) under
both `text/plain` and a JSON MIME type, remembering it in-tab as a
fallback (`src/app/clipboard.ts`). Ctrl+V applies one `insertFragment`
op (delete selection, insert bases, add shifted features with fresh
ids), so it is a single undo step. Cross-tab paste in browsers that strip
custom clipboard types (#3, 2026-09-23): the copy also writes `text/html`,
a `<pre>` of the bases carrying the fragment JSON in a
`data-plasmidpop-fragment` attribute. Every browser keeps `text/html` across
tabs and windows, and anything else that reads it sees only the bases. On
paste the HTML is parsed inert with `DOMParser`, only that attribute is read,
it goes through `parseFragmentJSON` like the typed copy, and it is used only
while the plain text beside it still equals its bases — an application that
changed the text but kept the markup has changed what was copied. The
in-tab memory stays as the last fallback. Not tested on Safari, which is
where custom types are known to be dropped; there is no Safari on the
development machine.
