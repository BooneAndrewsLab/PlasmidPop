import { useId } from 'react';

import {
  type DigestProfile,
  type GelBand,
  type GelOptions,
  bandIntensities,
  bandLabel,
  chooseLadder,
  migration,
} from '@/core';

/**
 * A digest as a lane on a gel, beside a ladder.
 *
 * `core/analysis/gel.ts` has worked out the bands since item 30 — which
 * fragments run together, what is too small to see, whether the lane can be
 * read — and then said it in a sentence. But nobody chooses a diagnostic
 * digest by reading a sentence: they picture the lane, because the question
 * is "will I be able to tell these two apart by eye", and an eye is what
 * answers it. `3,224 + 1,137 bp` is the same information and the wrong
 * shape.
 *
 * So this draws the same numbers rather than new ones: `migration` is the
 * same `maxResolved` and `minVisible` the warnings are written from, and a
 * band is `GelBand`, so the picture and the prose cannot disagree.
 *
 * SVG rather than canvas, unlike the sequence and the map: there are a
 * dozen rectangles here, not fifty thousand bases, and being in the DOM
 * means a band can be a button and a test can read the lane off without a
 * rasteriser.
 */

const LANE_W = 42;
const GAP = 14;
/** Room to the left for the ladder's numbers, and to the right for the lane's. */
const SLAB_LEFT = 46;
const LABEL_ROOM = 62;
const SLAB_W = GAP * 3 + LANE_W * 2;
const WIDTH = SLAB_LEFT + SLAB_W + LABEL_ROOM;
/** The slab, and under it the room the lane names sit in. */
const SLAB_H = 172;
const HEIGHT = SLAB_H + 18;
const WELL_Y = 8;
const WELL_H = 7;
/** The lane runs from just under the wells to the dye front. */
const TOP = WELL_Y + WELL_H + 5;
const BOTTOM = SLAB_H - 10;
const BAND_H = 3.4;
/** Two labels closer than this would be written over each other. */
const LABEL_GAP = 9;

const LADDER_X = SLAB_LEFT + GAP;
const SAMPLE_X = LADDER_X + LANE_W + GAP;
/** Both columns of numbers are off the slab, where they are read against the page. */
const LADDER_LABEL_X = SLAB_LEFT - 4;
const SAMPLE_LABEL_X = SLAB_LEFT + SLAB_W + 6;

function laneY(length: number, options: GelOptions | undefined): number {
  return TOP + migration(length, options) * (BOTTOM - TOP);
}

/** A label may sit a little above the wells or below the dye front, not past. */
const LABEL_TOP = TOP - 6;
const LABEL_BOTTOM = SLAB_H + 4;
/** How far a number may be moved from its own band before it is worth less than nothing. */
const MAX_SHIFT = LABEL_GAP * 2;

/**
 * Where each number goes beside its lane, and which ones are written at all.
 *
 * A crowded lane can be labelled two ways and neither is right everywhere.
 * **Pushing** moves a number clear of the one above it and keeps every band
 * named, which is what a diagnostic digest of three or four pieces wants.
 * **Dropping** leaves out what will not fit at its own band, which is what a
 * ladder wants — it is a scale, and a number half a band from its own line
 * is worse than one number fewer.
 *
 * So the lane tries to push and falls back to dropping when that would carry
 * a number more than `MAX_SHIFT` from the band it names: a digest with every
 * single cutter ticked puts sixteen bands at the foot of the lane, and
 * pushing them all apart draws a fan of leaders across the gel that answers
 * nothing. The sizes are listed under the picture in any case, so dropping a
 * label costs a glance and not the number.
 */
function labelRows(
  ys: readonly number[],
  mode: 'push' | 'drop',
): { readonly y: number; readonly shown: boolean }[] {
  if (mode === 'push') {
    const pushed = pushApart(ys);
    if (pushed !== null) return pushed.map((y) => ({ y, shown: true }));
  }
  let last = -Infinity;
  return ys.map((y) => {
    const shown = y - last >= LABEL_GAP;
    if (shown) last = y;
    return { y, shown };
  });
}

/**
 * The column spread out down the lane, or null where that cannot be done
 * without moving a number too far. A column pushed past the dye front is
 * pushed back up from the end first, since the room is there and only the
 * stacking ran out.
 */
function pushApart(ys: readonly number[]): number[] | null {
  const out: number[] = [];
  let last = LABEL_TOP - LABEL_GAP;
  for (const y of ys) {
    last = Math.max(y, last + LABEL_GAP);
    out.push(last);
  }
  if ((out[out.length - 1] ?? 0) > LABEL_BOTTOM) {
    for (let i = out.length - 1; i >= 0; i--) {
      const below = out[i + 1];
      out[i] = Math.min(out[i] ?? 0, (below ?? LABEL_BOTTOM + LABEL_GAP) - LABEL_GAP);
    }
  }
  return out.every((at, i) => Math.abs(at - (ys[i] ?? at)) <= MAX_SHIFT) ? out : null;
}

interface Props {
  readonly profile: DigestProfile;
  /** Heading over the sample lane: the enzymes, or what was amplified. */
  readonly label: string;
  readonly options?: GelOptions;
  /** Called when a band is clicked; without it the bands are not clickable. */
  readonly onPick?: (band: GelBand) => void;
  /** What clicking a band would do, for its title and its accessible name. */
  readonly pickTitle?: (band: GelBand) => string;
}

export function Gel({ profile, label, options, onPick, pickTitle }: Props) {
  const titleId = useId();
  const ladder = chooseLadder(profile.fragments);
  const ladderIntensity = bandIntensities(ladder.bands.map((n) => ({ length: n, fragments: [n] })));
  const sampleIntensity = bandIntensities(profile.bands);
  const ladderRows = labelRows(
    ladder.bands.map((n) => laneY(n, options)),
    'drop',
  );
  const sampleRows = labelRows(
    profile.bands.map((b) => laneY(b.length, options)),
    'push',
  );

  return (
    <figure className="gel">
      <svg
        className="gel__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="group"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          {`${label} on a ${ladder.name} ladder: ${profile.bands.map(bandLabel).join(', ')} bp`}
        </title>
        <rect className="gel__slab" x={SLAB_LEFT} y={0} width={SLAB_W} height={SLAB_H} rx={2} />
        {[LADDER_X, SAMPLE_X].map((x) => (
          <rect key={x} className="gel__well" x={x} y={WELL_Y} width={LANE_W} height={WELL_H} />
        ))}

        {ladder.bands.map((length, i) => {
          const y = laneY(length, options);
          const row = ladderRows[i];
          return (
            <g key={length}>
              <rect
                className="gel__band gel__band--ladder"
                x={LADDER_X}
                y={y - BAND_H / 2}
                width={LANE_W}
                height={BAND_H}
                opacity={ladderIntensity[i] ?? 1}
              />
              {row?.shown === true && (
                <text className="gel__size" x={LADDER_LABEL_X} y={y + 2.8} textAnchor="end">
                  {length.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}

        {profile.bands.map((band, i) => {
          const y = laneY(band.length, options);
          const row = sampleRows[i];
          const at = row?.y ?? y;
          // A number the lane had no room for is left out, as on the ladder;
          // every size is listed under the picture in any case.
          const named = row?.shown !== false;
          const name = `${bandLabel(band)} bp`;
          const title = pickTitle?.(band) ?? `${name}: ${band.fragments.join(' + ')} bp`;
          const body = (
            <>
              <rect
                className="gel__band"
                x={SAMPLE_X}
                y={y - BAND_H / 2}
                width={LANE_W}
                height={BAND_H}
                opacity={sampleIntensity[i] ?? 1}
              />
              {/* A label pushed clear of its neighbour is joined back to its
                  own band, or the lane reads as one band short and one
                  number too many. */}
              {named && Math.abs(at - y) > 1.5 && (
                <line
                  className="gel__leader"
                  x1={SAMPLE_X + LANE_W}
                  y1={y}
                  x2={SAMPLE_LABEL_X - 2}
                  y2={at}
                />
              )}
              {named && (
                <text className="gel__size" x={SAMPLE_LABEL_X} y={at + 2.8}>
                  {bandLabel(band)}
                </text>
              )}
            </>
          );
          if (onPick === undefined) {
            return (
              <g key={`${band.length}-${i}`}>
                <title>{title}</title>
                {body}
              </g>
            );
          }
          return (
            <g
              key={`${band.length}-${i}`}
              className="gel__pick"
              role="button"
              tabIndex={0}
              aria-label={title}
              onClick={() => {
                onPick(band);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onPick(band);
              }}
            >
              <title>{title}</title>
              {/* A 3 px band is not a target; the hit area is the row it is in. */}
              <rect
                className="gel__hit"
                x={SAMPLE_X}
                y={y - LABEL_GAP / 2}
                width={LANE_W}
                height={LABEL_GAP}
              />
              {body}
            </g>
          );
        })}

        <text
          className="gel__lane-name"
          x={LADDER_X + LANE_W / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
        >
          {ladder.name}
        </text>
        <text
          className="gel__lane-name"
          x={SAMPLE_X + LANE_W / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
        >
          {label}
        </text>
      </svg>
      <figcaption className="gel__caption">
        Calculated for a 1 % agarose gel, not measured: band positions and how brightly each one
        stains are a model.
      </figcaption>
    </figure>
  );
}
