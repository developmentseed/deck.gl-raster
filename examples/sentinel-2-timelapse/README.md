# Sentinel-2 Disaster Time-Lapse

Explore disasters through satellite imagery. Search [Sentinel-2][s2] scenes for an
event — a region and date range — then step through acquisitions on a time slider to
see how the ground changed: where water flooded, where fire burned.

Imagery is read **directly** from Cloud-Optimized GeoTIFFs in public S3 buckets via HTTP
range requests. There is no tile server: the browser fetches only the bytes it needs and
[`MultiCOGLayer`][multicog] reprojects each band from its native UTM zone and composites
it into RGB on the GPU.

## How it works

1. **Search** (`src/stac.ts`) — POSTs a query (bbox + date range + cloud-cover filter) to
   the [Earth Search][earth-search] STAC API. A bbox can straddle several Sentinel-2 MGRS
   tiles (each a different UTM zone); to keep things simple the example drops
   partial-coverage frames (high `s2:nodata_pixel_percentage`), then — among the tiles
   whose footprint covers the center of the view — keeps the one with the most *complete*
   acquisitions. (Picking by scene count alone can land on a well-imaged tile *next to*
   the area of interest; centering on the view avoids that.) The result is one clean,
   fully-imaged time series over the place you're looking at.
2. **Compose** (`src/composites.ts`) — maps Sentinel-2 bands to RGB. True color is the
   intuitive default; **SWIR — water/flood** makes flooded land go dark (water absorbs
   shortwave-infrared), and **Burned area** highlights fire scars.
3. **Animate** (`src/App.tsx`) — the time slider selects a date; play steps through dates
   with `requestAnimationFrame`. Each date is a distinct set of COGs, so stepping swaps
   the `MultiCOGLayer`'s sources.

The control panel is a live search form:

- **Quick start** — preset disaster events fly the map to the region, pre-fill the dates,
  and search. Defaults to the **2022 Pakistan floods** (Sindh).
- **Zoom to location** — fly the camera to a typed lat/lon.
- **Collection / dates / max cloud cover** — the search filters.
- **Search this view** — runs the search over the map's current visible bounds.

## Collections

This example uses `sentinel-2-l2a`, the dense historical archive. Its assets live in the
public `sentinel-cogs` bucket, which sends CORS headers (`Access-Control-Allow-Origin: *`),
so the browser can fetch the COGs directly — exactly what a tile-server-free example needs.

The newer `sentinel-2-c1-l2a` ("Collection 1") product is **deliberately not offered**: its
assets are in the `e84-earth-search-sentinel-data` bucket, which serves no CORS headers, so
every in-browser COG fetch fails and the map renders blank — even though the STAC search
itself succeeds and reports scenes. With no tile server in front of the COGs, there's no way
to use it here. The band asset keys are otherwise identical (`red`, `green`, `blue`, `nir`,
`swir16`, `swir22`).

## Run

```bash
pnpm install   # from the repo root
pnpm --filter deck.gl-sentinel-2-timelapse-example dev
```

Then open the dev server (port 3002).

## Limitations / follow-ups

- **Single MGRS tile per event.** A region spanning multiple tiles / UTM zones would need
  a `MosaicLayer` compositing per-item `MultiCOGLayer`s.
- **Reload on each time step.** Stepping swaps the layer, so the new date's tiles load
  fresh (a brief flicker). Unlike the [`dynamical-zarr-ecmwf`][ecmwf] example — which
  preloads every timestep into one GPU texture array from a single Zarr — each Sentinel-2
  date is a separate set of COGs. A smoother version would keep a small window of dates
  (current ± neighbors) mounted to warm the tile cache before stepping.
- **Single collection.** Overlaying other collections (buildings, VIIRS night-lights
  change) to correlate impact with what's on the ground is a natural next step.

[s2]: https://registry.opendata.aws/sentinel-2-l2a-cogs/
[earth-search]: https://earth-search.aws.element84.com/v1/
[multicog]: https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/
[ecmwf]: ../dynamical-zarr-ecmwf
