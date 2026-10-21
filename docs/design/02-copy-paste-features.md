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

## Firefox: clipboard events on a view that is not editable (#267)

Ctrl+C, Ctrl+X and Ctrl+V did nothing in the sequence view in Firefox
(2026-10-20). The view is a focusable `div[tabIndex=0]`, not an editable
element, and Firefox does not send a clipboard event to a focused element
that is not editable: it sends it to the node holding the page's text
selection, or to `<body>`. Checked with Playwright in Firefox 1555 against
the dev server: the events arrived as `paste@BODY`, `copy@BODY`,
`cut@BODY` with the view focused, so React's `onPaste` on the view never
ran; Chromium sent them to the view itself.

The view's handlers now sit on the document (`useClipboardEvents`): an
event is the view's when it lands inside the view (Chrome) or when the
view, or something in it, has the focus (Firefox), and never when it lands
on a text field or was already handled. The other pattern considered was
a hidden focused textarea or `contenteditable` taking the focus for the
view. It is what makes the browser route events, but it would move the
focus off the `role="textbox"` element, bring the on-screen keyboard and
IME into play on touch devices, and add a selection and caret of its own to
keep out of the way, all to receive three events the document already gets.
What it would add and this does not: Shift+Insert, which Firefox binds to
paste only inside an editable element, still does nothing there; Ctrl+V
works. No other view relies on clipboard events: the circular map, the
alignment and the panels copy through buttons (`copyText`), and the empty
page already listened on the document.
