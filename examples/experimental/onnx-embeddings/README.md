# ONNX Embeddings (experimental)

Explore AlphaEarth Foundations satellite embeddings in the browser with
[ONNX Runtime Web] on WebGPU. The data is the 64-band, 10 m
[AEF GeoZarr mosaic], read tile by tile with `ZarrLayer`, as in the
[`aef-mosaic`](../../aef-mosaic/) example. Small ONNX models run on every
loaded tile:

- **Similarity**: click a pixel, and every loaded pixel gets its cosine
  similarity to it, drawn through a colormap above a threshold.
- **Clusters**: k-means in JavaScript on pixels sampled from the loaded tiles
  gives `k` centroids, and every pixel gets the color of its nearest one.
- **Classifier**: click a few examples of what you are looking for, and
  shift-click a few of what you are not. A logistic regression fit in
  JavaScript gives every pixel a probability. Its learning rate, number of
  steps and L2 penalty are in the panel.
- **RGB**: the three-band composite of `aef-mosaic`.

A new query, new centroids or new examples run the models again on the tiles
already loaded, without fetching them again. The query also carries across
years: pick a pixel in 2025, then switch the year to compare.

Similarity starts with a query of its own, the pixel in the middle of the map,
and picks a new one when you change location. "Show embeddings underneath"
draws the RGB composite, dimmed, under the results of the other modes, so you
can see where data has loaded; turn it off to see results over the basemap.

> [!WARNING]
> This example is experimental. Its code is LLM-generated and unreviewed, and
> it may change substantially or be withdrawn.

It needs a browser with WebGPU, such as a recent Chrome or Edge. In a browser
without it, a dialog says so, and only the RGB mode works.

[ONNX Runtime Web]: https://onnxruntime.ai/docs/tutorials/web/
[AEF GeoZarr mosaic]: https://source.coop/tge-labs/aef-mosaic

To view locally:

```bash
pnpm install
pnpm build
cd examples/experimental/onnx-embeddings
pnpm dev
```

## How it works

1. For each tile, `getTileData` fetches one 256 × 256 chunk of all 64 bands
   for the chosen year with zarrita. It keeps the int8 array on the CPU, uploads
   it as an `r8sint` 2D array texture for the RGB composite, and creates an
   `r32float` texture for the model output.
2. `TileAnalysis` keeps its own registry of loaded tiles: added in
   `getTileData`, removed in `onTileUnload`. When the query, the centroids or
   the classifier change, it runs the model on every registered tile, writes
   all the outputs into the tiles' existing `r32float` textures at once, and
   bumps `updateTriggers.renderTile`. A tile that loads later runs the model
   in `getTileData`, before it is first drawn.
3. The models are tiny ONNX graphs of about a kilobyte, written as Python
   functions in [`models/make_models.py`](models/make_models.py) and served
   from `public/models/`. Each takes the raw int8 `[1, 64, height, width]`
   tile, dequantizes it on the GPU, reshapes it to a `[64, pixels]` matrix and
   multiplies it by the query, the centroids or the
   classifier weights. Those are model inputs, so changing them needs no new
   model. The cluster model picks the nearest centroid with float operations
   only, which keeps it on the GPU.
4. ONNX Runtime Web creates and owns its own WebGPU device, while deck.gl draws
   with WebGL2, so each output (256 KB per tile) comes back to the CPU and is
   written into the tile's WebGL2 texture.
5. A shader module colors the model output over the basemap: a colormap above
   a threshold for similarity and probability, or categorical colors for
   clusters. Pixels below the threshold are not drawn, and neither is a mode
   with nothing to show yet, such as a classifier with no examples.

ONNX Runtime's JavaScript is a dynamic import, and its 29 MB WebAssembly binary
(7 MB compressed) is fetched when a model is first needed. The app starts in
Similarity mode, so that is right away.

[`NOTES.md`](NOTES.md) has the design, measurements, and what this example
taught us about ONNX Runtime Web as an engine.

To rebuild the models, and check them against NumPy:

```bash
uv run models/make_models.py public/models
```
