import { WORDMARK_ACCENT, WORDMARK_INK, WORDMARK_WIDTH } from './logoWordmark';

/**
 * The PlasmidPop lockup: the plasmid-ring "p" mark standing in for the first
 * letter of the outlined "lasmidpop" wordmark (design/logo/README.md).
 *
 * Geometry follows the design's 64 px lockup: mark 92 px tall, 2 px gap, the
 * wordmark baseline at y = 0 and the mark's box bottom 18.22 px below it
 * (14 px padding plus the half-leading of the 0.8 line height). Ink parts use
 * currentColor so the logo follows the toolbar's light/dark text colour.
 */

const ACCENT = '#ec3013';
const MARK_SIZE = 92;
const MARK_SCALE = MARK_SIZE / 64;
const MARK_TOP = 18.22 - MARK_SIZE;
const TEXT_X = MARK_SIZE + 2;
const VIEW_TOP = -74;
const VIEW_HEIGHT = 90;
const VIEW_WIDTH = TEXT_X + WORDMARK_WIDTH;

interface Props {
  /** Rendered height in CSS pixels. */
  readonly height?: number;
}

export function Logo({ height = 26 }: Props) {
  return (
    <svg
      className="logo"
      role="img"
      viewBox={`0 ${VIEW_TOP} ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      height={height}
      width={(height * VIEW_WIDTH) / VIEW_HEIGHT}
    >
      <title>PlasmidPop</title>
      <g transform={`translate(0 ${MARK_TOP}) scale(${MARK_SCALE})`} fill="none">
        <rect x="4" y="17" width="11" height="45" fill="currentColor" />
        <path d="M49 34A17 17 0 1 1 32 17" stroke="currentColor" strokeWidth="11" />
        <path d="M40.5 19.3A17 17 0 0 1 49 34" stroke={ACCENT} strokeWidth="11" />
        <g stroke={ACCENT} strokeWidth="5" strokeLinecap="square">
          <line x1="29.6" y1="7.1" x2="29.1" y2="1.1" />
          <line x1="41.2" y1="8.6" x2="43.3" y2="3" />
          <line x1="51.1" y1="14.9" x2="55.3" y2="10.7" />
        </g>
      </g>
      <g transform={`translate(${TEXT_X} 0)`}>
        <path d={WORDMARK_INK} fill="currentColor" />
        <path d={WORDMARK_ACCENT} fill={ACCENT} />
      </g>
    </svg>
  );
}
