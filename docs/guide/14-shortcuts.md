# Keyboard shortcuts

On macOS use `Cmd` where `Ctrl` is written.

## Files

| Keys                        | Action                                                         |
| --------------------------- | -------------------------------------------------------------- |
| `Ctrl+S`, `Ctrl+Shift+S`    | Download GenBank (a working copy's changes are reviewed first) |
| `Alt+L`                     | Copy a share link                                              |
| `Alt+1` … `Alt+9`           | Bring the first … ninth open document forward                  |
| `Alt+0`                     | Bring the [Bench](12-cloning.md#the-bench) forward             |
| `Alt+W`                     | Close the document in front (its tab)                          |
| `Alt+Shift+PageUp`, `…Down` | Move the document in front one tab left or right               |
| `Ctrl+V` with nothing open  | Open a pasted GenBank or FASTA record, or bare bases           |
| `Alt+K`                     | Compare with another tab or a file (**File ▸ Compare with…**)  |

## Editing

| Keys                     | Action                                                |
| ------------------------ | ----------------------------------------------------- |
| `A C G T …`              | Insert a base at the cursor, or replace the selection |
| `Backspace`              | Delete the base before the cursor, or the selection   |
| `Delete`                 | Delete the base after the cursor, or the selection    |
| `Ctrl+C`                 | Copy the selection with its features                  |
| `Ctrl+X`                 | Cut the selection with its features                   |
| `Ctrl+V`                 | Paste at the cursor or over the selection             |
| `Ctrl+Z`                 | Undo                                                  |
| `Ctrl+Shift+Z`, `Ctrl+Y` | Redo                                                  |

On the [Bench](12-cloning.md#the-bench), where there is no sequence to edit,
`Ctrl+Z` and `Ctrl+Shift+Z` (or `Ctrl+Y`) undo and redo changes to the shelf.

## Showing and hiding

Everything here is `Alt` and one key. Bare letters type bases in the
sequence view and `Ctrl` belongs to the browser, so `Alt` is the modifier
left for the view. In front of a [protein](16-proteins.md), `Alt+C`, `Alt+T`,
`Alt+R` and `Alt+V` do nothing, since a protein has no complement,
translations, cut sites or map, and `Alt+[` and `Alt+]` step through the tabs
it has.

| Keys             | Action                                                    |
| ---------------- | --------------------------------------------------------- |
| `Alt+C`          | Complement strand on or off                               |
| `Alt+T`          | Translations under CDS features on or off                 |
| `Alt+R`          | Cut sites on or off (the ticked enzymes are kept)         |
| `Alt+E`          | Edit marks off, and back to the baseline that was chosen  |
| `Alt+S`          | Collapse the sidebar to its rail, or bring the panel back |
| `Alt+V`          | The next of the views: Sequence, Map, Both                |
| `Alt+[`, `Alt+]` | The sidebar tab above or below (opens the sidebar)        |
| `Alt+=`, `Alt+-` | Larger or smaller sequence text                           |
| `Alt+O`          | Open the Format menu; Tab walks its items, Escape closes  |
| `Alt+Y`          | Open the Style menu for the selected bases (colour, size) |
| `Alt+U`          | Open the Case menu for the selected bases (upper, lower)  |

## Selecting and moving

| Keys                    | Action                                       |
| ----------------------- | -------------------------------------------- |
| `← →`                   | Move the cursor one base                     |
| `↑ ↓`                   | Move the cursor one row                      |
| `Shift` + arrows        | Extend the selection                         |
| `Ctrl+Shift+← →`        | Extend the selection a codon at a time       |
| `Home`, `End`           | Start or end of the row                      |
| `Ctrl+Home`, `Ctrl+End` | Start or end of the sequence                 |
| `Shift+click`           | Extend the selection to the clicked position |
| `Ctrl+A`                | Select all                                   |
| `Escape`                | Clear the selection                          |
| `Alt+N`                 | Select the next marked change                |
| `Alt+Shift+N`           | Select the previous marked change            |

## Find

| Keys          | Action         |
| ------------- | -------------- |
| `Ctrl+F`      | Open find      |
| `Enter`       | Next match     |
| `Shift+Enter` | Previous match |
| `Escape`      | Close find     |

## Map

| Input                         | Action                 |
| ----------------------------- | ---------------------- |
| Wheel, pinch                  | Zoom about the pointer |
| Double-click a feature        | Zoom to fit it         |
| Double-click elsewhere        | Zoom in one step       |
| Drag empty space, middle-drag | Pan when zoomed in     |

## Panes

`Alt+B` takes the keyboard to the next boundary between two panes (see
[Viewing](03-viewing.md#sizing-the-panes)); there:

| Input                     | Action                                              |
| ------------------------- | --------------------------------------------------- |
| `← →` or `↑ ↓`            | Move the boundary a little; past a floor, fold away |
| `Page Up`, `Page Down`    | Move it further                                     |
| `Home`, `End`             | Take it to either pane's floor                      |
| `Escape`                  | Back to where the keyboard was before `Alt+B`       |
| Double-click the boundary | Put that boundary back where it was                 |

## Help

| Keys                            | Action          |
| ------------------------------- | --------------- |
| `?` (outside the sequence view) | Open this guide |
| `Escape`                        | Close it        |
