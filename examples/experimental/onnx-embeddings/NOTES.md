# Notes: ONNX Runtime Web on GeoZarr embeddings

## The question

"We should make an example in deck.gl-raster of using with onnx runtime. If we
could have something with onnx connected to geozarr embeddings, that would be
really cool." And: what does building it teach us about the pros and cons of
ONNX Runtime Web as an engine for per-pixel raster work?

## Short answer

Yes. Similarity search, k-means clusters and a click-trained logistic
regression all run as tiny ONNX models on WebGPU over every loaded tile of the
AlphaEarth Foundations mosaic, and update in place when the query changes. A
query change over the 15 tiles of the default view takes about **120 ms**
(8 ms per tile), or about **60 ms** if each tile's embeddings stay on the GPU.

The compute itself is fast: about **1 ms** per 256 × 256 × 64 tile once the
data is on ONNX Runtime's GPU device. Everything around it is the cost: the
29 MB WebAssembly binary, a WebGPU device that ONNX Runtime owns apart from
deck.gl's WebGL2 context, int8 data that the WebGPU provider cannot cast, and a
16 MiB float32 upload per tile per run. As a general engine for per-pixel band math,
it is heavy and leaky; as a way to run a small trained model per pixel, it
works well. Details below.

## Setup

- Apple M2 Pro, 16 GB, macOS 27.2.
- Chromium 158 (Playwright's headless shell) with `--enable-unsafe-webgpu
  --use-angle=metal`; WebGPU adapter `apple metal-3`.
- `onnxruntime-web` 1.31.1, `onnxruntime-web/webgpu`, WebGPU execution
  provider, one WebAssembly thread.
- Data: [AEF GeoZarr mosaic], array `embeddings`, int8, shape
  `[9, 64, 1859584, 4009984]`, sharded with 256 × 256 inner chunks. One tile is
  one inner chunk of all 64 bands: 4 MiB of int8.
- Viewport 1280 × 800. The default view (San Francisco, zoom 13) loads
  **15 tiles**; the Nile delta preset (zoom 12) loads **60 tiles**.

The chrome-devtools browser was not available to this session (another
session's MCP server held its profile), so every browser check ran in headless
Chromium through Playwright. The screenshots in `notes/` come from there.

[AEF GeoZarr mosaic]: https://source.coop/tge-labs/aef-mosaic

## Screenshots

From headless Chromium at 1280 × 800, resized:

- [`notes/00-rgb.jpg`](notes/00-rgb.jpg): the RGB composite (bands A00, A16,
  A32), as in `aef-mosaic`.
- [`notes/02-similarity.jpg`](notes/02-similarity.jpg): similarity to a pixel
  in a park; Golden Gate Park, the Presidio and other parks light up.
- [`notes/03-similarity-second-query.jpg`](notes/03-similarity-second-query.jpg):
  a second query, run on the same 15 tiles with no refetch.
- [`notes/07-similarity-2017.jpg`](notes/07-similarity-2017.jpg): the 2025
  query on 2017 tiles, after switching the year.
- [`notes/04-clusters.jpg`](notes/04-clusters.jpg): six k-means clusters over
  the loaded tiles.
- [`notes/05-classifier.jpg`](notes/05-classifier.jpg): a logistic regression
  from two positive (green) and two negative (red) clicks.
- [`notes/06-scale-nile-delta.jpg`](notes/06-scale-nile-delta.jpg): similarity
  over 60 tiles of fields in the Nile delta.

## Design

### Data flow

1. `getTileData` (`src/aef/get-tile-data.ts`, `loadTile`) reads one chunk with
   `zarr.get`, keeps the `Int8Array` of shape `[64, h, w]`, uploads it as an
   `r8sint` 2D array texture (the RGB composite and nodata mask read it), and
   creates an empty `r32float` texture for model output.
2. `TileAnalysis` (`src/analysis/tile-analysis.ts`) is the bridge between
   deck.gl-raster and ONNX Runtime. It keeps its own registry of loaded tiles:
   `getTileData` adds a tile after running the current model on it, and
   `onTileUnload` removes it.
3. A new task (a query vector, centroids, or classifier weights) bumps a
   generation counter and starts a pass: run the model on every registered
   tile whose result is stale, then write every output into its tile's
   existing `r32float` texture in one synchronous step and bump `renderVersion`,
   which the layer has in `updateTriggers.renderTile`. Textures are never
   replaced and tiles are never refetched; the smoke test counted **0** store
   requests during a query change.
4. Passes are latest-wins: a task that arrives mid-pass abandons the pass. A
   tile that loads during a pass runs in `getTileData`, and a catch-up pass
   handles anything that slipped between the two.
5. `ModelRunner` (`src/onnx/model-runner.ts`) owns the sessions, one per model,
   and queues every `run` call, because two runs in flight on one session never
   resolve (see the friction log).
6. Results come back to the CPU (`await tensor.getData()`, 256 KiB per tile)
   and go into WebGL2 textures. `renderTile` draws the RGB composite, then a
   shader module (`src/gpu/value-overlay.ts` or `src/gpu/cluster-overlay.ts`)
   colors the output. Threshold, color range, colormap and opacity are
   uniforms, so dragging those sliders runs no model.

### Models

`models/make_models.py` builds six graphs with `onnx.helper` and checks them
against NumPy with Python's `onnxruntime` (max error 1.4e-6). Each reshapes the
`[1, 64, h, w]` tile to a `[64, pixels]` matrix and multiplies it by a matrix
that is a model input:

| Model | Inputs besides `embeddings` | Output per pixel | Size (int8 / float32) |
| --- | --- | --- | --- |
| similarity | `query` `[1, 64]` | dot product (a cosine, as embeddings are unit length) | 403 / 238 B |
| clusters | `centroids` `[k, 64]`, `cluster_ids` `[1, k]` | index of the best centroid, as a float | 774 / 609 B |
| classifier | `weights` `[1, 64]`, `bias` `[1]` | `sigmoid(w · x + b)` | 487 / 322 B |

The int8 variants dequantize in the graph (`Cast`, then `v * |v| / 127.5²`;
`Sign` would run on the CPU). The float32 variants take values dequantized in
JavaScript with a 256-entry lookup table.

**Clusters avoid `ArgMax`**, whose int64 output sends it to the CPU. The graph
takes the argmax with float operations only: `ReduceMax` over the clusters,
`Sub`, `Mul` by 1e7, `Add` 1, `Floor`, `Relu` gives a one-hot mask of the best
score, and a `MatMul` with `[0, 1, …, k − 1]` turns it into the index. Every
node runs on WebGPU. Two exactly equal scores would add their indices; that
needs two centroids with bit-identical dot products and was never seen.

k-means itself (spherical, k-means++ seeding) and the logistic regression
(full-batch gradient descent with an L2 penalty, classes weighted equally) run
in plain JavaScript on the main thread.

### Model input paths

The "Model input" control switches how a tile reaches the model:

- **int8 (default)**: the raw `Int8Array` as a CPU tensor. ONNX Runtime runs
  `Cast` on its CPU provider, copies the 16 MiB float32 result to the GPU, and
  runs the rest there. Fastest of the paths that keep no extra copy.
- **float32**: dequantized in JavaScript into one reused 16 MiB buffer, then a
  CPU tensor. Every node runs on WebGPU (the session sets
  `disable_cpu_ep_fallback`, so a fallback would be an error).
- **gpu**: dequantized once per tile into a buffer on ONNX Runtime's device,
  wrapped with `Tensor.fromGpuBuffer`, kept until the tile unloads. 16 MiB of
  GPU memory per tile.

### Alternatives rejected

- **Refetch on change** (`updateTriggers.getTileData`): blanks every tile and
  fetches 4 MiB per tile again.
- **Run the model in `renderTile`**: it is synchronous; `session.run` is not.
- **Read deck.gl's tile cache** for the resident tiles: private state two
  layers down (`ZarrLayer` → `RasterTileLayer` → `TileLayer`). A registry is
  the same work and also holds the per-tile GPU buffers.
- **Commit each tile as it finishes**: a pass shows mixed queries. At about
  120 ms per pass, committing once is fine.
- **Keep a float32 copy per tile on the CPU**: 16 MiB per tile instead of 4,
  to save about 3 ms of dequantization per tile per run.
- **GPU-resident input as the default**: 2 to 4 times faster per query, but
  960 MiB of extra GPU memory at 60 tiles, on a second GPU device. Kept as an
  option.
- **1 × 1 `Conv`** (the first formulation): ONNX Runtime wraps it in two
  NCHW ↔ NHWC transposes of the whole tile; see the measurements.
- **Threshold and colormap in the model**: then every slider move would be a
  pass. As shader uniforms they are free.
- **Nodata in the model**: the fragment shader already samples band 0 from the
  `r8sint` texture and discards −128, so the model ignores nodata (its value
  there is meaningless but never drawn).

## Measurements

All times in milliseconds. "Per tile" includes uploading the input and reading
the output back to the CPU.

### Per tile, isolated

A Vitest browser test on a synthetic 256 × 256 × 64 tile, median of 7 runs
after 2 warm-up runs, nothing else on the page. First the similarity model in
three formulations:

| Formulation | int8 input (`Cast` on CPU) | float32 from CPU | float32, JS dequantization included | float32 already on the GPU |
| --- | --- | --- | --- | --- |
| 1 × 1 `Conv`, default (NHWC) layout | 7.2 | 6.0 | 8.3 | 2.4 |
| 1 × 1 `Conv`, `preferredLayout: "NCHW"` | 6.0 | 4.8 | 6.8 | 1.1 |
| `Reshape` + `MatMul` (shipped) | **5.7** | 4.5 | 6.6 | **1.0** |

Then the three shipped models, from a second run on the committed files (the
first table's `MatMul` row used a copy with the same nodes):

| Model | int8 input (`Cast` on CPU) | float32 from CPU | float32, JS dequantization included | float32 already on the GPU |
| --- | --- | --- | --- | --- |
| similarity | 5.7 | 4.6 | 6.7 | **1.1** |
| clusters, k = 8 | 6.7 | 5.2 | 7.2 | **1.5** |
| classifier | 5.6 | 4.4 | 6.5 | **1.0** |

JavaScript dequantization through the lookup table takes **3.2–3.3 ms** per
tile, so ONNX Runtime's CPU `Cast` plus a GPU dequantization (5.7 ms in total)
beats dequantizing in JavaScript and sending float32 (6.6–6.7 ms).

### One query change over all loaded tiles, in the app

The pass time shown in the panel: wall time from the start of a pass to the
texture writes. Ranges over 4 to 7 passes after the first. The first pass
after a model loads is slower, 84 to 370 ms for 15 tiles, likely from compiling
its shaders.

| View | Model | int8 (default) | float32 | gpu |
| --- | --- | --- | --- | --- |
| 15 tiles | similarity | **115–129** (7.6–8.6 per tile) | 165–190 (11.0–12.6) | **54–64** (3.5–4.2) |
| 15 tiles | clusters, k = 6 | 117–136 (7.8–9.0) | not measured | 57–70 (3.8–4.7) |
| 15 tiles | classifier | 117–127 (7.8–8.4) | not measured | 53–58 (3.5–3.9) |
| 60 tiles | similarity | **408–446** (6.7–7.2) | 577–678 (9.6–10.6) | **125–143** (2.1–2.4) |

The first pass on the gpu path also dequantizes and uploads every tile: 223 ms
for 15 tiles, 608 ms for 60.

Per tile, the app is slower than the isolated test, about 8 ms against 5.7 for
int8 and 2 to 4 ms against 1.0 for gpu input. The app shares the main thread
and the GPU with MapLibre and deck.gl, and every run awaits its readback
before the next starts. I did not profile the gap further.

Other timings:

- k-means on 15,360 sampled pixels (1,024 per tile), k = 6, at most 25
  iterations: **205–222 ms** on the main thread.
- The logistic regression fit on a handful of points was not timed separately;
  by operation count it is a few milliseconds.

### Memory

| Per 256 × 256 tile | Size | Where |
| --- | --- | --- |
| int8 embeddings | 4 MiB | CPU (JavaScript) |
| `r8sint` band texture | 4 MiB | deck.gl's WebGL2 device |
| `r32float` output texture | 256 KiB | deck.gl's WebGL2 device |
| float32 input, int8 and float32 paths | 16 MiB, per run | uploaded each run into ONNX Runtime's GPU buffers |
| float32 input, gpu path | **16 MiB, kept** | ONNX Runtime's WebGPU device |

So 15 tiles hold 60 MiB of embeddings on the CPU, and the gpu path adds
**240 MiB** of GPU memory; 60 tiles hold 240 MiB, and the gpu path adds
**960 MiB**. The JavaScript heap reported by `performance.memory` was 200 to
270 MB at 15 tiles and 415 MB at 60. GPU memory is computed from buffer sizes,
not measured; ONNX Runtime's own buffer cache is not included.

### Load time and bundle size

| Item | Size or time |
| --- | --- |
| ONNX Runtime JavaScript, a lazy chunk | 120 kB (39 kB gzip) |
| ONNX Runtime WebAssembly (`ort-wasm-simd-threaded.asyncify.wasm`) | **28.7 MB (7.3 MB gzip)** |
| This example's code, beyond `aef-mosaic` | +37 kB (+12 kB gzip) |
| Models | 238 to 774 bytes each |
| Page load to first tiles drawn | 2.5–5.1 s (S3 reads) |
| First mode to ONNX Runtime ready (import, WebAssembly compile, device, first session), served from localhost | **0.40–0.45 s** built; 1.7–2.6 s on a cold Vite dev server |

Over a real network, the 7.3 MB compressed WebAssembly download comes on top
of the localhost time. I did not measure that.

## What ran on the GPU and what fell back

From ONNX Runtime's verbose session log (`logSeverityLevel: 0`, which prints
the node placements), and from creating each session with
`disable_cpu_ep_fallback`:

- **float32 models: every node on WebGPU** (`Reshape`, `MatMul`, `ReduceMax`,
  `Sub`, `Mul`, `Add`, `Floor`, `Relu`, `Sigmoid`). The app creates these
  sessions with fallback disabled, so this holds for every run.
- **int8 models: `Cast` on the CPU provider**, everything else on WebGPU, with
  a `MemcpyFromHost` of the 16 MiB float32 tensor that `Cast` produces.
- 1 × 1 `Conv`: WebGPU, plus two `Transpose` nodes that ONNX Runtime inserts,
  since the provider prefers NHWC.
- From earlier single-op probes with the same runtime: `ArgMax` (int64
  output), `Sign`, `Round`, `Mod`, `IsNaN`, and integer arithmetic on uint8
  run on the CPU; uint16 graphs fail to load. See friction item 2.

For clusters I chose the float-only argmax over `ArgMax` with CPU fallback:
it keeps the whole graph on the GPU, so the gpu input path reads back one
float per pixel instead of `k`.

## Friction log

Every awkward API and wrong assumption, in the order I hit them.

### ONNX Runtime Web

1. **Silent CPU fallback.** A node with no WebGPU kernel runs on the CPU
   provider with only a warning, which ONNX Runtime prints through
   `console.error` with ANSI color codes, so it looks like an error in the
   console. Seeing where nodes run needs `logSeverityLevel: 0` and reading the
   verbose log; enforcing it needs the session config entry
   `session.disable_cpu_ep_fallback`, passed through
   `extra: { session: { disable_cpu_ep_fallback: "1" } }`.
2. **Integer support is patchy.** `Cast` from int8 has no WebGPU kernel, so
   every int8 run pays a CPU cast and a float32 upload four times the size of
   the data. The provider has int64 off by default (its log prints
   `WebGPU EP enable int64: 0`), which sends `ArgMax` to the CPU. An earlier
   single-op probe on the same machine and runtime, which I did not re-run,
   found more: uint8 `Cast` to float runs on WebGPU but uint8 `Add`, `Div`,
   `Greater` and bitwise ops fall back; int32 and uint32 `Cast` and `Add` run on
   WebGPU but bitwise ops fall back; **any uint16 graph failed at session
   creation** with an internal error (`Provider type for Cast node with name ''
   is not set`); and float `Round`, `Mod`, `IsNaN` and `Sign` fall back.
3. **`Conv` gets wrapped in transposes.** The WebGPU provider prefers NHWC, so
   a 1 × 1 `Conv` on an NCHW tile runs as transpose, conv, transpose: 2.4 ms
   instead of 1.0 with GPU input. `preferredLayout: "NCHW"` in the provider
   options or a `MatMul` formulation avoids it. I only found this in the
   verbose log.
4. **Two runs in flight on one session never resolve.** `Promise.all` of two
   `session.run` calls on one WebGPU session hung until the 120 s test timeout,
   with no error. Earlier probes that issued ten concurrent calls hung the same
   way, with the renderer at 100% CPU. All runs go through one queue.
5. **The device is not stable.** ONNX Runtime creates its own WebGPU device.
   Each of the 9 times my probe read `env.webgpu.device` after every earlier
   session had been released, it got a new device. A buffer made on the old
   device then fails in `run` with
   `[Buffer] is associated with [Device], and cannot be used with [Device]`.
   GPU-resident tensors must die with their sessions.
6. **`env.webgpu.device` is a promise.** I assumed a `GPUDevice` after the
   first session, as the brief said; in 1.31 the getter returns
   `Promise<GPUDevice>`.
7. **No interop with deck.gl's device.** deck.gl draws with WebGL2 here, and
   ONNX Runtime runs on its own WebGPU device, so every output goes through the
   CPU. Outputs are small (256 KiB per tile); the inputs are the problem.
8. **The binary is 29 MB** for models of a few hundred bytes. The
   `onnxruntime-web/webgpu` bundle loads `ort-wasm-simd-threaded.asyncify.wasm`
   (not the `jsep` build); the package exports that path, so a Vite `?url`
   import plus `env.wasm.wasmPaths = { wasm: url }` serves it with no CDN. I
   did not test whether Vite resolves it without `wasmPaths`.
9. **My JavaScript dequantization lost to ONNX Runtime's CPU `Cast`**: 3.2 to
   3.3 ms for the lookup-table loop, while the int8 path's whole run is 5.7 ms.
   I expected the float32 path to win.
10. **Graphs come from Python.** There is no graph builder in the JavaScript
    package; I wrote the models with `onnx.helper` and committed the bytes. A
    tool that builds graphs from user expressions in the browser would have to
    encode ONNX protobuf itself.
11. **Errors are opaque.** A wrong-device buffer surfaces as `failed to call
    OrtRun(). ERROR_CODE: 1, ERROR_MESSAGE: WebGPU error scope failed. type=2.`
12. **Verbose logging is slow.** With `logSeverityLevel: 0` on a session,
    every run logs per node; my first probe spent minutes in logging.
13. **TypeScript**: ONNX Runtime types the device as the global `GPUDevice`,
    and TypeScript 7's DOM library has the WebGPU interfaces but not the
    `GPUBufferUsage` constants, so the runner spells out the flag values.

### deck.gl and deck.gl-raster

14. **No API for "the tiles that are loaded now"** or for updating a tile's
    data in place. The example keeps its own registry and bumps
    `updateTriggers.renderTile` after writing into existing textures. It works,
    but every "re-run an analysis on loaded tiles" use needs the same code.
15. **`onTileUnload` is not called when the inner `TileLayer` is replaced.**
    deck.gl-raster replaces it when the selection changes (the year here), and
    deck.gl's `Tileset2D.finalize()` drops its tiles without calling
    `onTileUnload`, so per-tile GPU resources leak. `aef-mosaic`, which frees
    its textures in `onTileUnload`, should leak the same way (read from the
    source, not measured). This example clears its registry on a year change
    and frees the old tiles a second later.
16. **No helper for "the pixel under the cursor".** The example projects the
    click with `tilesetDescriptor.projectFrom4326`, then inverts tile (0, 0)'s
    affine transform to get a pixel in the whole level. That assumes an affine
    tile grid.
17. **MapLibre's box zoom takes shift-click**, so shift-click to add a
    negative example did nothing until the map got `boxZoom={false}`.
18. luma.gl warns `Binding sampler not set: Not found in shader layout.`; the
    `aef-mosaic` example logs the same warning.

### The data

19. The tile count at the default view was 15, not the 50 I estimated from
    256-pixel tiles: MapLibre's zoom 13 is at 512-pixel tile scale, and the
    mosaic's pixels are about 8 m wide at San Francisco's latitude.

## What this says about ONNX Runtime Web as an engine

For someone deciding whether to build per-pixel raster math on it.

### Pros

- **The compute is fast.** A 64-band dot product over a 256 × 256 tile takes
  about 1 ms when the input is already on the GPU, and the cluster model with
  its extra reductions takes 1.5 ms.
- **Parameters are inputs.** Queries, centroids and weights change per run with
  no new session and no shader compile; a query change is just a pass.
- **A standard, testable format.** The same `.onnx` files run in Python, where I
  checked every model against NumPy in a few lines. The same graphs could run
  on a server or in a notebook.
- **Placement can be enforced.** With fallback disabled, a session either runs
  entirely on WebGPU or fails at creation, which is the right contract for a
  tool that promises GPU execution.
- **Real models come for free.** A trained head on embeddings, or a small
  convolutional network, runs without writing kernels; that is where ONNX
  Runtime is strongest, and this example's linear models barely use it.

### Cons

- **Data movement dominates.** With float32 input from the CPU a run takes
  4.4 to 5.2 ms per tile, against 1.0 to 1.5 ms when the same tensor is
  already on the GPU: most of every run is the 16 MiB upload. Avoiding it means keeping float32
  copies on ONNX Runtime's device: 16 MiB per tile, 4 times the int8 data, on
  a second GPU device next to the renderer's.
- **Integer rasters are second-class.** int8 casts on the CPU, uint8
  arithmetic falls back, uint16 graphs (Sentinel-2, Landsat) did not load at
  all, and int64 is off by default. Most raster sources are integers, so a
  tool would widen them to float32 or int32 before the runtime sees them.
- **A separate GPU device, owned by the runtime.** No sharing with a WebGL2
  renderer, so results round-trip through the CPU, and the device can change
  under GPU-resident data when sessions are released. Sharing a device with a
  WebGPU renderer (by setting `env.webgpu.device` first) is not tested here.
- **Weight.** 29 MB of WebAssembly (7.3 MB compressed) to run graphs of a few
  hundred bytes. A WGSL shader for the same work would be a few kilobytes.
- **Surprises you only see in verbose logs**: silent CPU fallback, inserted
  layout transposes, and runs that hang when two are in flight.
- **Expressions need a graph compiler anyway.** Turning a user expression into
  ONNX means emitting protobuf in the browser, and choosing formulations
  (`MatMul` over `Conv`, float argmax over `ArgMax`) that the runtime handles
  well: much of the same work as generating WGSL directly.

### Verdict

ONNX Runtime Web is a good fit for applying a small trained model to every
pixel of float data that can stay on its device, and for prototyping per-pixel
linear algebra quickly. As the core of a per-pixel band math engine, where most
work is elementwise math on integer rasters that already sit in the renderer's
GPU memory, it adds a 29 MB runtime, a second GPU device and a CPU round trip
per tile, and its per-tile time is dominated by moving data the renderer
already has.

## What I could not verify

- Only one machine (Apple M2 Pro) and one browser (headless Chromium 158 on
  Metal). No Windows, Linux, discrete GPU, Firefox or Safari.
- The chrome-devtools browser was unavailable, so nothing ran in a visible
  window; WebGL drew in headless Chromium.
- The WebAssembly download over a real network.
- GPU memory, other than by adding up buffer sizes; ONNX Runtime's buffer
  cache; how accurate `performance.memory` is for array buffers.
- Zoom levels below 12, where the tile count grows about four times per level;
  tiles narrower than 256 pixels at the edges of the mosaic.
- Whether ONNX Runtime keeps one device as long as one session stays alive.
  The app keeps its sessions and the gpu path kept working across passes, but
  I did not test it directly.
- Not tried: a shared device with a WebGPU deck.gl, float16 inputs (half the
  memory of float32), several tiles batched into one run, multi-threaded
  WebAssembly (needs cross-origin isolation), and ONNX Runtime's worker proxy
  (`env.wasm.proxy`) to take the CPU `Cast` off the main thread.
- The quality of the clusters and the classifier beyond looking at the map.
