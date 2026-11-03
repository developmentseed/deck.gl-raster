import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";

/** Colormaps for elevation. Order drives the dropdown order. */
export const COLORMAP_CHOICES = [
  { id: "terrain", label: "Terrain", colormapIndex: COLORMAP_INDEX.terrain },
  {
    id: "gist_earth",
    label: "Earth",
    colormapIndex: COLORMAP_INDEX.gist_earth,
  },
  { id: "viridis", label: "Viridis", colormapIndex: COLORMAP_INDEX.viridis },
  { id: "cividis", label: "Cividis", colormapIndex: COLORMAP_INDEX.cividis },
] as const satisfies readonly {
  id: string;
  label: string;
  colormapIndex: number;
}[];

/** A colormap choice from {@link COLORMAP_CHOICES}. */
export type ColormapChoice = (typeof COLORMAP_CHOICES)[number];

/** The id of a colormap choice. */
export type ColormapId = ColormapChoice["id"];
