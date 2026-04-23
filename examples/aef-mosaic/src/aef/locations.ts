/**
 * A preset map view for the location dropdown.
 */
export type Location = {
  /** Stable identifier used as the `<option>` value. */
  id: string;
  /** Human-readable label shown in the dropdown. */
  label: string;
  /** Map longitude for `flyTo`. */
  longitude: number;
  /** Map latitude for `flyTo`. */
  latitude: number;
  /** Zoom level (must be ≥ MIN_VISIBLE_ZOOM for the layer to render). */
  zoom: number;
};

/**
 * Preset regions showcasing distinct AEF embedding regimes.
 *
 * Order drives the dropdown order. The first entry is used as the initial
 * map view.
 */
export const LOCATIONS: readonly Location[] = [
  {
    id: "sf-bay",
    label: "San Francisco Bay (urban + water)",
    longitude: -122.35,
    latitude: 37.8,
    zoom: 13,
  },
  {
    id: "iowa-corn",
    label: "Iowa corn belt (seasonal agriculture)",
    longitude: -93.5,
    latitude: 42.0,
    zoom: 13,
  },
  {
    id: "amazon-frontier",
    label: "Amazon deforestation frontier (Rondônia)",
    longitude: -62.2,
    latitude: -9.5,
    zoom: 12,
  },
  {
    id: "nile-delta",
    label: "Nile delta (irrigation mosaic)",
    longitude: 31.2,
    latitude: 30.8,
    zoom: 12,
  },
  {
    id: "alaska-north-slope",
    label: "Alaska North Slope (tundra)",
    longitude: -150.0,
    latitude: 69.5,
    zoom: 12,
  },
];
