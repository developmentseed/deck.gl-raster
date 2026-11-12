import type { Bounds } from "@developmentseed/deck.gl-raster";

/** A map projection the example can switch to. */
export type ProjectionPreset = {
  /** Stable identifier. */
  id: string;
  /** Display name. */
  label: string;
  /** CRS code shown next to the name. */
  code: string;
  /**
   * The view's `crs`: a PROJ string, or an EPSG code that math.gl knows
   * (only a few, such as `EPSG:3857`).
   */
  crs: string;
  /**
   * Valid domain in lng/lat (the view's `fromBounds`). Polar projections are
   * limited to their hemisphere plus 20° (the opposite pole projects to
   * infinity). The margin keeps whole-hemisphere polar datasets, whose
   * square extents reach about 19.6° across the equator, inside the domain:
   * clamping a non-geographic tile at the domain edge folds its mesh, which
   * the reprojector can't refine away.
   */
  fromBounds: Bounds;
  /**
   * Camera when the projection is selected. Centers are offset so the map's
   * focus sits in the middle of the area the control panel leaves visible.
   */
  initialViewState: { center: [number, number, number]; zoom: number };
  /** Graticule spacing in degrees. */
  graticuleStep: { lng: number; lat: number };
  /** One-line description for the control panel. */
  description: string;
};

/** Projections offered in the example, polar first. */
export const PROJECTIONS: ProjectionPreset[] = [
  {
    id: "arctic",
    label: "Arctic Polar Stereographic",
    code: "EPSG:3413",
    crs: "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    fromBounds: [-180, -20, 180, 90],
    initialViewState: { center: [-135, 68.2, 0], zoom: 2.6 },
    graticuleStep: { lng: 30, lat: 10 },
    description: "",
  },
  {
    id: "antarctic",
    label: "Antarctic Polar Stereographic",
    code: "EPSG:3031",
    crs: "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    fromBounds: [-180, -90, 180, 20],
    initialViewState: { center: [-90, -71, 0], zoom: 2.8 },
    graticuleStep: { lng: 30, lat: 10 },
    description: "",
  },
  {
    id: "equal-earth",
    label: "Equal Earth",
    code: "EPSG:8857",
    crs: "+proj=eqearth +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    fromBounds: [-180, -90, 180, 90],
    initialViewState: { center: [-70, 0, 0], zoom: 1 },
    graticuleStep: { lng: 30, lat: 30 },
    description: "",
  },
  {
    id: "web-mercator",
    label: "Web Mercator",
    code: "EPSG:3857",
    crs: "EPSG:3857",
    fromBounds: [-180, -85.0511287798066, 180, 85.0511287798066],
    initialViewState: { center: [-65, 25, 0], zoom: 1 },
    graticuleStep: { lng: 30, lat: 30 },
    description:
      "For comparison: the projection behind nearly every web map, here through the same custom-projection pipeline.",
  },
];
