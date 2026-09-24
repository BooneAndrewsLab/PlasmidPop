# Keyboard shortcuts

On macOS use `Cmd` where `Ctrl` is written.

## Files

| Keys                        | Action                                                         |
| --------------------------- | -------------------------------------------------------------- |
| `Ctrl+S`, `Ctrl+Shift+S`    | Download GenBank (a working copy's changes are reviewed first) |
| `Alt+L`                     | Copy a share link                                              |
| `Alt+1` … `Alt+9`           | Bring the first … ninth open document forward                  |
| `Alt+W`                     | Close the document in front (its tab)                          |
| `Alt+Shift+PageUp`, `…Down` | Move the document in front one tab left or right               |
| `Ctrl+V` with nothing open  | Open a pasted GenBank or FASTA record, or bare bases           |

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
left for the view.

| Keys    | Action                                                    |
| ------- | --------------------------------------------------------- |
| `Alt+C` | Complement strand on or off                               |
| `Alt+T` | Translations under CDS features on or off                 |
| `Alt+R` | Cut sites on or off (the ticked enzymes are kept)         |
| `Alt+E` | Edit marks off, and back to the baseline that was chosen  |
| `Alt+S` | Collapse the sidebar to its rail, or bring the panel back |

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

With a boundary between two panes focused (Tab to it; see
[Viewing](03-viewing.md#sizing-the-panes)):

| Input                     | Action                              |
| ------------------------- | ----------------------------------- |
| `← →` or `↑ ↓`            | Move the boundary a little          |
| `Page Up`, `Page Down`    | Move it further                     |
| `Home`, `End`             | Take it to either pane's floor      |
| Double-click the boundary | Put that boundary back where it was |

## Help

| Keys                            | Action          |
| ------------------------------- | --------------- |
| `?` (outside the sequence view) | Open this guide |
| `Escape`                        | Close it        |
