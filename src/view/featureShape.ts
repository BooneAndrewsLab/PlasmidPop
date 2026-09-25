import { type Feature } from '@/core';

/**
 * How thick a feature's bar is drawn (#88), in both views and their SVG
 * exports. The lane keeps its height whatever the bar's, so the layout,
 * the labels on the map and clicking a feature are as they were; a thinner
 * bar is drawn in the middle of its lane.
 */
export type FeatureThickness = 'thin' | 'medium' | 'full';

export const FEATURE_THICKNESSES: readonly FeatureThickness[] = ['thin', 'medium', 'full'];

/**
 * The qualifier a chosen thickness is kept in, so it travels wherever the
 * feature does (GenBank, the store, a share link, the clipboard) and other
 * programs pass it by, as ApE's colour qualifiers are passed by here.
 */
export const THICKNESS_QUALIFIER = 'PlasmidPop_thickness';

/** The share of the lane a bar of each thickness fills. */
const FRACTION: Readonly<Record<FeatureThickness, number>> = {
  thin: 0.3,
  medium: 0.6,
  full: 1,
};

/**
 * Thin by default for what joins the parts that matter rather than being
 * one: an intron is the gap between two exons, and drawn as solid as they
 * are it hides the gene's structure.
 */
const DEFAULT_BY_TYPE: Readonly<Record<string, FeatureThickness>> = {
  intron: 'thin',
};

export function isFeatureThickness(value: unknown): value is FeatureThickness {
  return value === 'thin' || value === 'medium' || value === 'full';
}

/** The thickness chosen for this feature, or null when it has the default of its type. */
export function chosenThickness(feature: Feature): FeatureThickness | null {
  const q = feature.qualifiers.find((q) => q.name === THICKNESS_QUALIFIER);
  const value = q?.value?.trim().toLowerCase();
  return isFeatureThickness(value) ? value : null;
}

/** The thickness a feature of `type` has when none is chosen. */
export function defaultThickness(type: string): FeatureThickness {
  return DEFAULT_BY_TYPE[type] ?? 'full';
}

export function featureThickness(feature: Feature): FeatureThickness {
  return chosenThickness(feature) ?? defaultThickness(feature.type);
}

/** The share of its lane the feature's bar fills, 0 to 1. */
export function thicknessFraction(feature: Feature): number {
  return FRACTION[featureThickness(feature)];
}
