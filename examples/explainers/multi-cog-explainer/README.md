# MultiCOGLayer explainer

A step-by-step animation of how `MultiCOGLayer` draws bands stored at
different resolutions as one image. It follows one real Sentinel-2 tile
through the layer's pipeline: each band's own tile grid, the tiles that cover
it, stitching them into one texture per band, the UV transform that places the
tile inside each texture, and the shader sampling all three. It works both as
a talk prop and on its own.

This is an [explainer](../../README.md#explainers): its code was generated with
an LLM and hasn't been reviewed, so don't treat it as a pattern to copy. It
explains the mechanism rather than showing how to use `MultiCOGLayer`: instead
of the layer, it calls the same public building blocks the layer calls
(`selectSecondaryLevel`, `resolveSecondaryTiles`, `fetchTiles` and
`assembleTiles`), and it draws composites with `RasterLayer` and the
`CompositeBands` shader module.
