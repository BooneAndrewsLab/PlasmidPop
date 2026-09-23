# 2. Copy and paste with features

Done. Ctrl+C/X in the sequence
view copies the selection as a `SeqFragment` (bases plus trimmed
features, `source` left behind; `src/core/document/fragment.ts`) under
both `text/plain` and a JSON MIME type, remembering it in-tab as a
fallback (`src/app/clipboard.ts`). Ctrl+V applies one `insertFragment`
op (delete selection, insert bases, add shifted features with fresh
ids), so it is a single undo step. Not yet: cross-tab paste in browsers
that strip custom clipboard types (only the plain bases arrive there).
