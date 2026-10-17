/**
 * What the Export figure dialog (#240, item 94) chooses between, and the
 * arithmetic behind its live size check (#243), kept out of the component
 * so it can be tested without rendering.
 */

/** The two pictures the dialog exports: the circular map or the sequence rows. */
export type FigureView = 'map' | 'sequence';

/**
 * How the figure leaves. A PDF (#242) joins here, with a vector-or-raster
 * choice of its own beside Scale.
 */
export type FigureFileType = 'svg' | 'png';

export const FIGURE_FILE_TYPES: readonly { value: FigureFileType; label: string; title: string }[] =
  [
    {
      value: 'svg',
      label: 'SVG',
      title: 'A vector file: sharp at any size, editable in Inkscape or Illustrator',
    },
    { value: 'png', label: 'PNG', title: 'A picture at a chosen scale, for slides and documents' },
  ];

/** The text sizes the map's figure offers, as multiples of the on-screen size (item 89). */
export const FIGURE_FONT_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.8, label: 'Smaller' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: 'Larger' },
  { value: 1.6, label: 'Largest' },
];

/** A size in CSS pixels, as the SVG would be written. */
export interface FigureSize {
  readonly width: number;
  readonly height: number;
}
