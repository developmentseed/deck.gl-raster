# GeoArrow overlay (experimental)

Millions of vector points from [deck.gl-geoarrow] drawn on top of a
Cloud-Optimized GeoTIFF from deck.gl-raster, in the same deck.gl instance.

- **Raster:** the [EOxCloudless 2024] global mosaic, a COG in EPSG:4326 that
  deck.gl-raster reprojects to Web Mercator on the GPU.
- **Vector:** 3.4 million [Speedtest by Ookla] mobile network performance tiles
  (Q2 2026), read directly from Ookla's own Parquet file on S3 with
  [parquet-wasm]. HTTP range requests fetch only the 3 columns the map needs
  (28 MB of the 185 MB file). The `tile_x`/`tile_y` centroid columns become a
  GeoArrow point column (the "separated" `struct<x, y>` layout) without copying
  them.
- **Filter:** the download speed slider drives a `DataFilterExtension`, so
  filtering happens on the GPU without touching the data.

> [!WARNING]
> This example is experimental. Its code is LLM-generated and unreviewed, and
> it may change substantially or be withdrawn.

[deck.gl-geoarrow]: https://github.com/geoarrow/deck.gl-geoarrow
[EOxCloudless 2024]: https://cloudless.eox.at
[Speedtest by Ookla]: https://github.com/teamookla/ookla-open-data
[parquet-wasm]: https://github.com/kylebarron/parquet-wasm

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/geoarrow-overlay
pnpm dev
```

## Loading a local copy

Over a slow connection the 28 MB read can take tens of seconds. To load
instantly, download the file once and serve it locally:

```bash
curl -O https://ookla-open-data.s3.us-west-2.amazonaws.com/parquet/performance/type=mobile/year=2026/quarter=2/2026-04-01_performance_mobile_tiles.parquet
npx serve --cors -l 8090 .
```

Then pass its URL with the `url` query parameter:

```
http://localhost:3000/deck.gl-raster/examples/geoarrow-overlay/?url=http://localhost:8090/2026-04-01_performance_mobile_tiles.parquet
```

The server must support suffix range requests (`Range: bytes=-8`), which
parquet-wasm uses to read the Parquet footer. `serve` does; `http-server`
doesn't.

## Limitations

- The EOxCloudless COG is about 10 km per pixel, so the imagery is blurry when
  zoomed in to city scale.
