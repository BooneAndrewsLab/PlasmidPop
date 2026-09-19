# Restriction enzymes

The **Enzymes** tab scans the sequence for the recognition sites of a
bundled table of about 130 common, commercially available enzymes. The scan
runs in the background whenever the sequence changes, on both strands, and
handles ambiguity codes in recognition sequences (`GRCGYC`), enzymes that cut
outside their site (Type IIS such as BsaI and BsmBI) and sites that wrap the
origin of a circular sequence.

## Reading the list

Each row is one enzyme that cuts the sequence:

- a **tick box** that chooses the enzyme: its cut sites are drawn in the
  views, and the Cloning tab digests with it;
- the **name**;
- the **recognition site**, 5′→3′ on the top strand (hover to see whether it
  leaves a blunt end, a 5′ overhang or a 3′ overhang);
- the **cut positions**: the base after which the top strand is cut. Click
  one to select that recognition site in the views.

Below the list: how many enzymes cut, and how many do not cut at all.

## Choosing which to show

- When a document opens, the enzymes that cut **exactly once** are ticked,
  so unique sites are on the map at once.
- Tick or untick individual enzymes. **Show listed** ticks every enzyme
  currently in the (filtered) list, **Hide all** clears them.
- **Filter** by name (`Eco`) or by site (`GGATCC`).
- **Single cutters only** hides enzymes with more than one site.

Cut sites of the ticked enzymes are drawn in the sequence view (a mark with
the enzyme name above the bases) and on the map (labels around the ring), and
they are included in **Export map as SVG** and **Export sequence view as
SVG**.

## Hiding the cut sites without losing the choice

**Cut sites** in the toolbar, next to Complement and Translations, hides
every drawn cut site at once — useful when a map with a dozen labels is too
busy to read. The ticks stay exactly as they are, so switching it back on
restores the same set; no need to untick and re-tick a carefully chosen list.

While it is off:

- the sequence view, the map, **Export map as SVG** and **Export sequence
  view as SVG** draw no cut sites;
- the **Fragments from ticked enzymes** list below and the
  [Cloning](12-cloning.md) tab's digest are unchanged — they follow the
  ticks, not the toggle.

The Enzymes tab says so while the sites are hidden, and offers a **Show cut
sites** link to bring them back.

## Fragments

**Fragments from ticked enzymes** lists the sizes of the pieces a complete
digest with all ticked enzymes would produce, largest first, the way they
would appear on a gel. On a circular molecule, n cuts give n fragments; on a
linear one, n + 1.

For the fragments themselves, with their ends and the features they carry,
and to join them into a new construct, use the [Cloning](12-cloning.md)
tab.

## How to check whether an enzyme is a unique cutter

1. Open the **Enzymes** tab.
2. Type the enzyme name in the filter box.
3. Look at the number of cut positions in its row. Tick **Single cutters
   only** to list all unique cutters at once.

## Notes

The enzyme table was typed from supplier catalogues and does not include
methylation sensitivity, isoschizomer grouping or supplier information.
Cut positions are given on the top strand; the bottom-strand cut and the
overhang are used by the Cloning tab.
