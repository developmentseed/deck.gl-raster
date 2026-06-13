/**
 * Band-combination presets.
 *
 * A `MultiCOGLayer` loads one COG per named source and composites them into the
 * RGB output channels on the GPU. By choosing *which* Sentinel-2 bands feed
 * R, G and B we get views that emphasize different physical phenomena.
 *
 * - `sources` maps an arbitrary slot name -> a Sentinel-2 band asset key
 *   (see {@link BandKey} in `stac.ts`).
 * - `composite` maps the RGB(A) output channels -> those slot names.
 *
 * Adapted from `examples/sentinel-2`, but keyed to Earth Search asset names
 * (`red`, `swir22`, ...) rather than raw `Bxx.tif` filenames.
 */

import type { BandKey } from "./stac.js";

/** One row of the color legend: a swatch (any CSS color) and what it means. */
export type LegendEntry = { color: string; label: string };

export type CompositePreset = {
  id: string;
  title: string;
  /** Hint shown in the UI explaining what the combination reveals. */
  hint: string;
  /** Color key shown in the UI: what the dominant colors represent. */
  legend: LegendEntry[];
  /** slot name -> Sentinel-2 band asset key. */
  sources: Record<string, BandKey>;
  /** output channel -> slot name. */
  composite: { r: string; g?: string; b?: string };
};

export const COMPOSITE_PRESETS: CompositePreset[] = [
  {
    id: "true-color",
    title: "True Color",
    hint: "Natural color (Red, Green, Blue) — how the scene looks to the eye.",
    legend: [
      { color: "#3fae4f", label: "Vegetation" },
      { color: "#0f2238", label: "Water" },
      { color: "#cdbb9a", label: "Bare soil / built-up" },
    ],
    sources: { red: "red", green: "green", blue: "blue" },
    composite: { r: "red", g: "green", b: "blue" },
  },
  {
    id: "swir-water",
    title: "SWIR — water / flood",
    hint:
      "SWIR22, NIR, Red. Water strongly absorbs shortwave-infrared, so flooded " +
      "land turns deep blue/black — the clearest view of flood extent over time.",
    legend: [
      { color: "#0a1a2f", label: "Water / flooded land" },
      { color: "#3fae4f", label: "Vegetation" },
      { color: "#d98cb3", label: "Bare soil / built-up" },
    ],
    sources: { swir: "swir22", nir: "nir", red: "red" },
    composite: { r: "swir", g: "nir", b: "red" },
  },
  {
    id: "false-color-ir",
    title: "False Color (vegetation)",
    hint:
      "NIR, Red, Green. Healthy vegetation reflects near-infrared strongly and " +
      "glows bright red; bare soil and built-up areas stay muted.",
    legend: [
      { color: "#d33a3a", label: "Healthy vegetation" },
      { color: "#0f2238", label: "Water" },
      { color: "#8fa3b0", label: "Bare soil / built-up" },
    ],
    sources: { nir: "nir", red: "red", green: "green" },
    composite: { r: "nir", g: "red", b: "green" },
  },
  {
    id: "burned-area",
    title: "Burned area",
    hint:
      "SWIR22, SWIR16, NIR. Recently burned ground is highly reflective in " +
      "shortwave-infrared, making fire scars stand out for comparison over time.",
    legend: [
      { color: "#b5482a", label: "Burn scar" },
      { color: "#3fae4f", label: "Healthy vegetation" },
      { color: "#0a1a2f", label: "Water" },
    ],
    sources: { swir22: "swir22", swir16: "swir16", nir: "nir" },
    composite: { r: "swir22", g: "swir16", b: "nir" },
  },
];

export const DEFAULT_PRESET_ID = COMPOSITE_PRESETS[0].id;
