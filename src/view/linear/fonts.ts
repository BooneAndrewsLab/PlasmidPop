/**
 * The fonts the sequence view draws with. Shared so that anything rendering
 * the same rows — the view itself, the save review — measures and draws
 * identically. The SVG export keeps its own Courier metric on purpose: a
 * file has to look the same wherever it is opened.
 */

export const monoFontOf = (size: number): string =>
  `${size}px ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;

/** Labels (the ruler, feature names) sit two pixels under the strand text. */
export const sansFontOf = (size: number): string =>
  `${size - 2}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
