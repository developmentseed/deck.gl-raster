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
 * Shortlist of colormap options appropriate for 2 m temperature. Order drives
 * the dropdown order in the control panel.
 *
 * `satisfies` preserves the literal `id` values for downstream type inference
 * while still enforcing the shape.
 */
export const COLORMAP_CHOICES = [
  {
    id: "coolwarm",
    label: "coolwarm (diverging)",
    colormapIndex: COLORMAP_INDEX.coolwarm,
    reversed: false,
  },
  {
    id: "rdbu_r",
    label: "RdBu reversed (blue→red)",
    colormapIndex: COLORMAP_INDEX.rdbu,
    reversed: true,
  },
  {
    id: "balance",
    label: "balance (cmocean diverging)",
    colormapIndex: COLORMAP_INDEX.balance,
    reversed: false,
  },
  {
    id: "thermal",
    label: "thermal (cmocean sequential)",
    colormapIndex: COLORMAP_INDEX.thermal,
    reversed: false,
  },
  {
    id: "turbo",
    label: "turbo",
    colormapIndex: COLORMAP_INDEX.turbo,
    reversed: false,
  },
] as const satisfies readonly ColormapChoiceShape[];

/** Union of valid colormap choice ids (e.g. `"coolwarm" | "rdbu_r" | ...`). */
export type ColormapId = (typeof COLORMAP_CHOICES)[number]["id"];

/** An entry from {@link COLORMAP_CHOICES}. */
export type ColormapChoice = (typeof COLORMAP_CHOICES)[number];

/** Default colormap on first load. */
export const DEFAULT_COLORMAP_ID: ColormapId = COLORMAP_CHOICES[0].id;
