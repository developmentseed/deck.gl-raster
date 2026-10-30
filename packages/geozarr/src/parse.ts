import { GeoProjAttrsSchema, SpatialAttrsSchema } from "./schemas.js";
import type { CRSInfo, GeoZarrMetadata, MultiscaleLevel } from "./types.js";

/**
 * Parse zarr-conventions metadata from group attributes.
 *
 * Supports both single-resolution Zarr (no multiscales) and multi-resolution.
 * Array sizes are read from `spatial:shape` in the attributes (either at the
 * top level for single-resolution, or per layout item for multiscales).
 *
 * Levels in the returned `GeoZarrMetadata` are ordered finest-first (natural
 * Zarr order, matching the multiscales layout array). Reverse to get
 * coarsest-first for `TilesetDescriptor`.
 *
 * The Y and X axes are found by name when `spatial:dimensions` contains both
 * a Y label ("y", "latitude" or "lat") and an X label ("x", "longitude" or
 * "lon"), ignoring case. Otherwise they are the last two entries, following
 * the convention's row-major order (`[y, x]` or `[z, y, x]`), whatever their
 * names.
 *
 * @param attrs  Raw group attributes object (e.g. from zarrita `group.attrs`).
 *
 * @throws If required conventions (spatial, geo-proj) are missing or invalid,
 *         or if spatial:shape is absent where required.
 */
export function parseGeoZarrMetadata(attrs: unknown): GeoZarrMetadata {
  const spatial = SpatialAttrsSchema.parse(attrs);
  const geoProjResult = GeoProjAttrsSchema.safeParse(attrs);

  if (!geoProjResult.success) {
    throw new Error(
      `geo-proj convention not found or invalid in group attributes: ${geoProjResult.error.message}`,
    );
  }

  const geoProj = geoProjResult.data;

  // --- CRS ---
  const crs: CRSInfo = {};
  if ("proj:code" in geoProj) {
    crs.code = geoProj["proj:code"];
  } else if ("proj:wkt2" in geoProj) {
    crs.wkt2 = geoProj["proj:wkt2"];
  } else if ("proj:projjson" in geoProj) {
    crs.projjson = geoProj["proj:projjson"];
  }

  // --- Axes ---
  const axes = spatial["spatial:dimensions"];
  // The convention leaves dimension names free and identifies Y and X by
  // position. Recognized labels still win when both are present, so data that
  // lists them out of order, such as `["lon", "lat"]`, keeps working.
  const Y_LABELS = new Set(["y", "latitude", "lat"]);
  const X_LABELS = new Set(["x", "longitude", "lon"]);
  let yAxisIndex = axes.findIndex((a) => Y_LABELS.has(a.toLowerCase()));
  let xAxisIndex = axes.findIndex((a) => X_LABELS.has(a.toLowerCase()));

  if (yAxisIndex === -1 || xAxisIndex === -1) {
    // The schema guarantees at least 2 entries.
    yAxisIndex = axes.length - 2;
    xAxisIndex = axes.length - 1;
  }

  // --- Levels ---
  const layout = spatial.multiscales?.layout;
  let levels: MultiscaleLevel[];

  if (layout) {
    levels = layout.map((item, i) => {
      // Transform may be per-level or at group level (validated by superRefine)
      const transform =
        item["spatial:transform"] ?? spatial["spatial:transform"];

      if (!transform) {
        throw new Error(
          `spatial:transform missing for multiscales layout item at index ${i} (path: "${item.asset}")`,
        );
      }

      const shape = item["spatial:shape"];
      if (!shape) {
        throw new Error(
          `spatial:shape missing for multiscales layout item at index ${i} (path: "${item.asset}")`,
        );
      }

      // spatial:shape is [height, width]
      return {
        path: item.asset,
        affine: transform,
        arrayWidth: shape[1],
        arrayHeight: shape[0],
      };
    });
  } else {
    // Single-resolution
    const transform = spatial["spatial:transform"];
    if (!transform) {
      throw new Error(
        "spatial:transform is required for single-resolution Zarr",
      );
    }

    const shape = spatial["spatial:shape"];
    if (!shape) {
      throw new Error("spatial:shape is required for single-resolution Zarr");
    }

    levels = [
      {
        path: ".",
        affine: transform,
        arrayWidth: shape[1],
        arrayHeight: shape[0],
      },
    ];
  }

  return {
    levels,
    crs,
    registration: spatial["spatial:registration"] ?? "pixel",
    axes,
    yAxisIndex,
    xAxisIndex,
  };
}
