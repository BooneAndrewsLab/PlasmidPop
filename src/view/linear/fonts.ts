/**
 * The fonts the sequence view draws with. Shared so that anything rendering
 * the same rows — the view itself, the save review — measures and draws
 * identically. The SVG export keeps its own Courier metric on purpose: a
 * file has to look the same wherever it is opened.
 */

/**
 * The strand font at `size`, in `family` first when one is chosen (#29) —
 * a name already cleaned to letters, digits, spaces and hyphens, so it can
 * be quoted as it is — and the system's monospace behind it.
 */
export const monoFontOf = (size: number, family = ''): string =>
  `${size}px ${family === '' ? '' : `"${family}", `}ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;

/** Labels (the ruler, feature names) sit two pixels under the strand text. */
export const sansFontOf = (size: number): string =>
  `${size - 2}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
