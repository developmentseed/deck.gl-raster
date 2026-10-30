/** Identifier of one of the {@link PLACES}. */
export type PlaceId = "matterhorn" | "everest" | "grand-canyon" | "yosemite";

/** A place worth shading, with the view and colormap range it opens with. */
export type Place = {
  id: PlaceId;
  label: string;
  longitude: number;
  latitude: number;
  zoom: number;
  /**
   * Elevations, in meters, that the colormap spans in the elevation modes.
   * The `terrain` colormap starts in blue (water), so the low end sits about
   * a quarter of the range below the lowest ground, which then lands in green.
   */
  elevationRange: [number, number];
};

/** The places in the picker, in display order. */
export const PLACES: readonly Place[] = [
  {
    id: "matterhorn",
    label: "Matterhorn",
    longitude: 7.6586,
    latitude: 45.9763,
    zoom: 12,
    elevationRange: [500, 4500],
  },
  {
    id: "everest",
    label: "Everest",
    longitude: 86.925,
    latitude: 27.9881,
    zoom: 11,
    elevationRange: [2000, 8850],
  },
  {
    id: "grand-canyon",
    label: "Grand Canyon",
    longitude: -112.095,
    latitude: 36.1,
    zoom: 11,
    elevationRange: [0, 2800],
  },
  {
    id: "yosemite",
    label: "Yosemite Valley",
    longitude: -119.5885,
    latitude: 37.7456,
    zoom: 12,
    elevationRange: [400, 3000],
  },
];

/** The place the example opens on. */
export const DEFAULT_PLACE_ID: PlaceId = "matterhorn";
