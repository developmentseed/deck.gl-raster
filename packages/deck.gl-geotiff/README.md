GeoTIFF and Cloud-Optimized GeoTIFF visualization in deck.gl.

There are two layers exported:

- `COGLayer` uses a `TileLayer` to individually render each internal tile of a COG. This relies on the input geotiff being tiled and having overviews.
- `GeoTIFFLayer` **doesn't use a `TileLayer`**. It just fetches the highest resolution image of a `GeoTIFF` and renders it using a `RasterLayer`. This should work for more generic GeoTIFF images, including those that don't have overviews and those that are laid out in strips instead of in tiles.
