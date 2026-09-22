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

/** A lane on its own is 42 units wide; beside others it gives up some of that. */
const LANE_W_ALONE = 42;
const LANE_W_SHARED = 32;
const GAP = 14;
/** Room to the left for the ladder's numbers, and to the right for the last lane's. */
const SLAB_LEFT = 46;
const LABEL_ROOM = 62;
/**
 * Units to pixels at most. One lane beside a ladder was drawn at the 320 px
 * the panel gives it; a wider gel keeps that scale rather than shrinking its
 * text to fit, and only gives way where the panel is narrower.
 */
const SCALE = 320 / (SLAB_LEFT + GAP * 3 + LANE_W_ALONE * 2 + LABEL_ROOM);
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
/** Characters of a lane's name that fit under a shared lane. */
const NAME_CHARS = 7;

/** The ladder's numbers are off the slab, where they are read against the page. */
const LADDER_LABEL_X = SLAB_LEFT - 4;

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

/** One sample lane: a digest, or what a PCR made. */
export interface GelLane {
  readonly profile: DigestProfile;
  /** Heading under the lane: an enzyme, "Both", or what was amplified. */
  readonly label: string;
  /** Called when a band is clicked; without it the bands are not clickable. */
  readonly onPick?: (band: GelBand) => void;
  /** What clicking a band would do, for its title and its accessible name. */
  readonly pickTitle?: (band: GelBand) => string;
}

interface Props {
  /** Left to right after the ladder. The last one is the lane the sizes are written beside. */
  readonly lanes: readonly GelLane[];
  readonly options?: GelOptions;
}

/** "HindIII" fits under a shared lane; "BsaXI-HF" is cut to it, and named in full on hover. */
function laneName(label: string, shared: boolean): string {
  return shared && label.length > NAME_CHARS ? `${label.slice(0, NAME_CHARS - 1)}\u2026` : label;
}

/**
 * The gel. Several lanes are for comparing digests — a double digest beside
 * the two single ones, which is how a double digest is read at the bench: a
 * band that is in the double lane and in neither single lane is the piece
 * between the two enzymes' sites.
 *
 * Only the last lane has its sizes written beside it. Numbers between lanes
 * would need a gap as wide as the label room for each, and a gel five lanes
 * wide at that spacing is shrunk until nothing on it can be read; the other
 * lanes' bands are named on hover, and every size is listed under the
 * picture by whoever draws it.
 */
export function Gel({ lanes, options }: Props) {
  const titleId = useId();
  const shared = lanes.length > 1;
  const laneW = shared ? LANE_W_SHARED : LANE_W_ALONE;
  const slabW = GAP * (lanes.length + 2) + laneW * (lanes.length + 1);
  const width = SLAB_LEFT + slabW + LABEL_ROOM;
  const ladderX = SLAB_LEFT + GAP;
  const laneX = (i: number): number => ladderX + (laneW + GAP) * (i + 1);
  const sampleLabelX = SLAB_LEFT + slabW + 6;

  const ladder = chooseLadder(lanes.flatMap((l) => l.profile.fragments));
  const ladderIntensity = bandIntensities(ladder.bands.map((n) => ({ length: n, fragments: [n] })));
  const ladderRows = labelRows(
    ladder.bands.map((n) => laneY(n, options)),
    'drop',
  );
  const lastIndex = lanes.length - 1;
  const last = lanes[lastIndex];
  const sampleRows =
    last === undefined
      ? []
      : labelRows(
          last.profile.bands.map((b) => laneY(b.length, options)),
          'push',
        );

  return (
    <figure className="gel">
      <svg
        className="gel__svg"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        style={{ maxWidth: Math.round(width * SCALE) }}
        role="group"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          {`${lanes
            .map((l) => `${l.label}: ${l.profile.bands.map(bandLabel).join(', ')} bp`)
            .join('; ')}; beside a ${ladder.name} ladder`}
        </title>
        <rect className="gel__slab" x={SLAB_LEFT} y={0} width={slabW} height={SLAB_H} rx={2} />
        {[ladderX, ...lanes.map((_, i) => laneX(i))].map((x) => (
          <rect key={x} className="gel__well" x={x} y={WELL_Y} width={laneW} height={WELL_H} />
        ))}

        {ladder.bands.map((length, i) => {
          const y = laneY(length, options);
          const row = ladderRows[i];
          return (
            <g key={length}>
              <rect
                className="gel__band gel__band--ladder"
                x={ladderX}
                y={y - BAND_H / 2}
                width={laneW}
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

        {lanes.map((lane, laneIndex) => {
          const x = laneX(laneIndex);
          const intensity = bandIntensities(lane.profile.bands);
          const labelled = laneIndex === lastIndex;
          return (
            <g key={laneIndex} className="gel__lane" data-lane={lane.label}>
              {lane.profile.bands.map((band, i) => {
                const y = laneY(band.length, options);
                const row = labelled ? sampleRows[i] : undefined;
                const at = row?.y ?? y;
                // A number the lane had no room for is left out, as on the
                // ladder; every size is listed under the picture in any case.
                const named = labelled && row?.shown !== false;
                const name = `${bandLabel(band)} bp`;
                const title =
                  lane.pickTitle?.(band) ??
                  `${shared ? `${lane.label}: ` : ''}${name}: ${band.fragments.join(' + ')} bp`;
                const body = (
                  <>
                    <rect
                      className="gel__band"
                      x={x}
                      y={y - BAND_H / 2}
                      width={laneW}
                      height={BAND_H}
                      opacity={intensity[i] ?? 1}
                    />
                    {/* A label pushed clear of its neighbour is joined back to
                        its own band, or the lane reads as one band short and
                        one number too many. */}
                    {named && Math.abs(at - y) > 1.5 && (
                      <line
                        className="gel__leader"
                        x1={x + laneW}
                        y1={y}
                        x2={sampleLabelX - 2}
                        y2={at}
                      />
                    )}
                    {named && (
                      <text className="gel__size" x={sampleLabelX} y={at + 2.8}>
                        {bandLabel(band)}
                      </text>
                    )}
                  </>
                );
                const { onPick } = lane;
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
                      x={x}
                      y={y - LABEL_GAP / 2}
                      width={laneW}
                      height={LABEL_GAP}
                    />
                    {body}
                  </g>
                );
              })}
              <g>
                {/* Only a name that was cut short needs saying in full. */}
                {laneName(lane.label, shared) !== lane.label && <title>{lane.label}</title>}
                <text
                  className="gel__lane-name"
                  x={x + laneW / 2}
                  y={HEIGHT - 4}
                  textAnchor="middle"
                >
                  {laneName(lane.label, shared)}
                </text>
              </g>
            </g>
          );
        })}

        <text className="gel__lane-name" x={ladderX + laneW / 2} y={HEIGHT - 4} textAnchor="middle">
          {ladder.name}
        </text>
      </svg>
      <figcaption className="gel__caption">
        Calculated for a 1 % agarose gel, not measured: band positions and how brightly each one
        stains are a model.
      </figcaption>
    </figure>
  );
}
