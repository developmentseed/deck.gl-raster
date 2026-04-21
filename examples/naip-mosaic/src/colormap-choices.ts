import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";

/**
 * Shape constraint for a single colormap choice. Not exported as the
 * canonical item type — use {@link ColormapChoice} instead, which is
 * narrowed to the literal `id` union from the list below.
 */
type ColormapChoiceShape = {
  /** Stable identifier used as the select-option value. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Layer index into the colormap sprite. */
  colormapIndex: number;
  /** Whether to sample the colormap in reverse. */
  reversed: boolean;
};

/**
 * NDVI-appropriate colormap options. Order drives the dropdown order.
 *
 * `satisfies` preserves the literal `id` values for downstream type inference
 * while still enforcing the shape.
 */
export const COLORMAP_CHOICES = [
  {
    id: "cfastie",
    label: "cfastie (default NDVI)",
    colormapIndex: COLORMAP_INDEX.cfastie,
    reversed: false,
  },
  {
    id: "rdylgn",
    label: "RdYlGn (red → yellow → green)",
    colormapIndex: COLORMAP_INDEX.rdylgn,
    reversed: false,
  },
  {
    id: "greens",
    label: "greens (sequential)",
    colormapIndex: COLORMAP_INDEX.greens,
    reversed: false,
  },
  {
    id: "ylgn",
    label: "YlGn (yellow → green)",
    colormapIndex: COLORMAP_INDEX.ylgn,
    reversed: false,
  },
  {
    id: "viridis",
    label: "viridis (perceptually uniform)",
    colormapIndex: COLORMAP_INDEX.viridis,
    reversed: false,
  },
  {
    id: "spectral",
    label: "spectral (diverging)",
    colormapIndex: COLORMAP_INDEX.spectral,
    reversed: false,
  },
] as const satisfies readonly ColormapChoiceShape[];

/** Union of valid colormap choice ids (e.g. `"cfastie" | "rdylgn" | ...`). */
export type ColormapId = (typeof COLORMAP_CHOICES)[number]["id"];

/** An entry from {@link COLORMAP_CHOICES}. */
export type ColormapChoice = (typeof COLORMAP_CHOICES)[number];

/** Default colormap on first load — preserves prior NAIP NDVI rendering. */
export const DEFAULT_COLORMAP_ID: ColormapId = COLORMAP_CHOICES[0].id;
