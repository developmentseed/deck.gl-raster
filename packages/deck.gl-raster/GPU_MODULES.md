# @developmentseed/deck.gl-raster/gpu-modules

GPU shader modules for raster rendering. Each module is a [luma.gl `ShaderModule`](https://luma.gl/docs/api-reference/shadertools/shader-module/) that performs one transformation on raw pixel data — decoding, rescaling, masking, colorization, etc. Compose them into a render pipeline by passing an array of {@link RasterModule} entries to the `renderPipeline` prop on {@link RasterLayer} or {@link RasterTileLayer}.

```ts
import {
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";

const renderPipeline = [
  { module: FilterNoDataVal, props: { noDataValue: 0 } },
  { module: LinearRescale, props: { rescaleMin: 0, rescaleMax: 0.05 } },
];
```

Pipelines run in order: each module receives the output of the previous one. A typical pipeline starts with decoding (e.g. `FilterNoDataVal`, `CompositeBands`), applies numeric transforms (`LinearRescale`), then maps values to colors (`Colormap`, `BlackIsZero`, `CMYKToRGB`).
