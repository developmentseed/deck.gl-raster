# @developmentseed/geozarr

Validation and parsing for the [GeoZarr] / [zarr-conventions] metadata used to describe geospatial Zarr datasets.

[GeoZarr]: https://geozarr.org/
[zarr-conventions]: https://github.com/zarr-developers/zarr-conventions

The package extracts the structural information needed to render a Zarr group as a tiled raster — multiscale layout, per-level affine transforms and array shapes, axis labels, and CRS — into a single typed `GeoZarrMetadata` value. It implements the `spatial`, `multiscales`, and `geo-proj` conventions.

This is the metadata layer used by [`@developmentseed/deck.gl-zarr`]; it has no rendering or I/O dependencies and can be used independently of deck.gl.

[`@developmentseed/deck.gl-zarr`]: https://developmentseed.org/deck.gl-raster/api/deck-gl-zarr/

## Usage

```ts
import { open } from "zarrita";
import { parseGeoZarrMetadata } from "@developmentseed/geozarr";

const group = await open(store, { kind: "group" });
const metadata = parseGeoZarrMetadata(group.attrs);

// metadata.levels    — finest-first list of resolution levels
// metadata.crs       — { code | wkt2 | projjson }
// metadata.axes      — axis labels (e.g. ["time", "y", "x"])
// metadata.{x,y}AxisIndex
```

Both single-resolution and multiscale groups are supported. Validation is implemented with [Zod] and surfaces structured errors when required conventions are missing or malformed.

[Zod]: https://zod.dev/
