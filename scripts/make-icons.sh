#!/usr/bin/env sh
# Regenerates the app-icon SVG sources in design/logo/ and public/icons/*.png from the
# logo mark (design/logo/README.md); the PNGs are rendered from those SVGs.
# Requires rsvg-convert (librsvg). Run from the repo root.
set -eu
INK='#201e1d'; RED='#ec3013'; GROUND='#f3f2f2'
MARK="<rect x='4' y='17' width='11' height='45' fill='$INK'/><path d='M49 34A17 17 0 1 1 32 17' stroke='$INK' stroke-width='11'/><path d='M40.5 19.3A17 17 0 0 1 49 34' stroke='$RED' stroke-width='11'/><line x1='29.6' y1='7.1' x2='29.1' y2='1.1' stroke='$RED' stroke-width='5' stroke-linecap='square'/><line x1='41.2' y1='8.6' x2='43.3' y2='3' stroke='$RED' stroke-width='5' stroke-linecap='square'/><line x1='51.1' y1='14.9' x2='55.3' y2='10.7' stroke='$RED' stroke-width='5' stroke-linecap='square'/>"
# $1 = SVG source, $2 = PNG output, $3 = pixel size, $4 = corner radius (viewBox units of 512),
# $5 = mark scale
render() {
  off=$(awk "BEGIN{print (512-64*$5)/2}")
  printf "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512' fill='none'><rect width='512' height='512' rx='%s' fill='%s'/><g transform='translate(%s %s) scale(%s)'>%s</g></svg>\n" \
    "$4" "$GROUND" "$off" "$off" "$5" "$MARK" > "$1"
  rsvg-convert -w "$3" -h "$3" -o "$2" "$1"
}
render design/logo/plasmidpop-app-icon.svg public/icons/icon-512.png 512 112 5.6
rsvg-convert -w 192 -h 192 -o public/icons/icon-192.png design/logo/plasmidpop-app-icon.svg
# Maskable: full-bleed ground, mark inside the central 80 % safe zone.
render design/logo/plasmidpop-app-icon-maskable.svg public/icons/icon-maskable-512.png 512 0 4.6
