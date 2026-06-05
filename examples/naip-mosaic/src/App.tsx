import { COGLayer, MosaicLayer } from "@developmentseed/deck.gl-geotiff";
import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  createColormapTexture,
  decodeColormapSprite,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { GeoTIFFFromUrlOptions, Overview } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import { DeckGlOverlay } from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer.js";
import type { ColormapId } from "./colormap-choices.js";
import { COLORMAP_CHOICES, DEFAULT_COLORMAP_ID } from "./colormap-choices.js";
import type { RenderMode } from "./control-panel.js";
import { ControlPanel } from "./control-panel.js";
import "./proj.js";
import STAC_DATA from "./minimal_stac.json";
import { epsgResolver } from "./proj.js";

/** Bounding box query passed to Microsoft Planetary Computer STAC API */
const STAC_BBOX = [-106.6059, 38.7455, -104.5917, 40.4223];

/**
 * A subset of STAC Item properties.
 *
 * These are the only properties we actually care about for this example.
 */
type PartialSTACItem = {
  bbox: [number, number, number, number];
  assets: {
    image: {
      href: string;
    };
  };
};

/** A feature collection of STAC items. */
type STACFeatureCollection = {
  features: PartialSTACItem[];
};

type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
};

/**
 * Module-level cache of opened GeoTIFFs keyed by URL.
 *
 * Header reads are small and the resulting GeoTIFF instance can be reused
 * across the example's lifetime. Holding this outside the MosaicLayer's
 * TileLayer cache lets us drop `maxCacheSize: Infinity` (which was previously
 * needed to keep header data, but had the side-effect of pinning every parent
 * tile — and its inner COGLayer's in-flight requests — in memory forever).
 *
 * We cache the `Promise<GeoTIFF>` rather than the resolved `GeoTIFF` so that
 * concurrent callers for the same URL share one in-flight fetch instead of
 * each kicking off a duplicate request before any of them sets the cache.
 *
 * The caller's signal is forwarded into `GeoTIFF.fromUrl` so an in-flight
 * header read can be aborted when the parent tile leaves view. On any
 * rejection (including `AbortError`) the entry is evicted, so a later visit
 * to the same source restarts the fetch rather than reusing a failed promise.
 *
 * Caveat: this assumes at most one interested caller per URL at a time. If a
 * second caller joined an in-flight fetch and the first caller aborted, the
 * second would see an `AbortError` even though it never wanted to abort. In
 * this example each STAC item maps to a unique parent tile so the assumption
 * holds; promoting this pattern into library code would want refcounted
 * cancellation (one underlying `AbortController`, abort only when all callers
 * have signalled).
 */
const geotiffCache = new Map<string, Promise<GeoTIFF>>();

function getCachedGeoTIFF(
  url: string,
  opts: GeoTIFFFromUrlOptions,
): Promise<GeoTIFF> {
  let promise = geotiffCache.get(url);
  if (!promise) {
    promise = GeoTIFF.fromUrl(url, opts).catch((err) => {
      geotiffCache.delete(url);
      throw err;
    });
    geotiffCache.set(url, promise);
  }
  return promise;
}

/** Custom tile loader that creates a GPU texture from the GeoTIFF image data. */
async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<TextureDataT> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const { array } = tile;

  if (array.layout === "band-separate") {
    throw new Error("naip data is pixel interleaved");
  }

  const { width, height, data } = array;

  const texture = device.createTexture({
    data,
    format: "rgba8unorm",
    width: width,
    height: height,
  });

  return {
    texture,
    height: height,
    width: width,
  };
}

/** Shader module that sets alpha channel to 1.0.
 *
 * The input NAIP imagery is 4-band but the 4th band means near-infrared (NIR)
 * rather than alpha, so we need to set alpha to 1.0 so that the imagery is
 * fully opaque when rendered.
 */
const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

/**
 * Shader module that reorders bands to a false color infrared composite.
 *
 * {@see https://www.usgs.gov/media/images/common-landsat-band-combinations}
 */
const setFalseColorInfrared = {
  name: "set-false-color-infrared",
  inject: {
    // Colors in the original image are ordered as: R, G, B, NIR
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      float green = color[1];
      color.rgb = vec3(nir, red, green);
    `,
  },
} as const satisfies ShaderModule;

/**
 * Shader module that computes NDVI into `color.r`.
 *
 * The result is the raw NDVI value in `[-1, 1]`, so the downstream
 * {@link ndviFilter} can compare it directly against the user-facing range
 * (also `[-1, 1]`). A {@link LinearRescale} step later in the pipeline maps it
 * to `[0, 1]` for the {@link Colormap} texture lookup.
 */
const normalizedDifference = {
  name: "normalizedDifference",
  inject: {
    // Colors in the original image are ordered as: R, G, B, NIR
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      color.r = (nir - red) / (nir + red);
    `,
  },
};

/** This module name must be consistent */
const NDVI_FILTER_MODULE_NAME = "ndviFilter";

const ndviUniformBlock = `\
uniform ${NDVI_FILTER_MODULE_NAME}Uniforms {
  float ndviMin;
  float ndviMax;
} ${NDVI_FILTER_MODULE_NAME};
`;

/**
 * A shader module that filters out pixels based on their NDVI value.
 *
 * It takes in min and max values for the range, and discards pixels outside of
 * that range.
 */
const ndviFilter = {
  name: NDVI_FILTER_MODULE_NAME,
  fs: ndviUniformBlock,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      if (color.r < ndviFilter.ndviMin || color.r > ndviFilter.ndviMax) {
        discard;
      }
    `,
  },
  uniformTypes: {
    ndviMin: "f32",
    ndviMax: "f32",
  },
  getUniforms: (props) => {
    return {
      ndviMin: props.ndviMin ?? -1.0,
      ndviMax: props.ndviMax ?? 1.0,
    };
  },
} as const satisfies ShaderModule<{ ndviMin: number; ndviMax: number }>;

/**
 * Create a rendering pipeline for RGB true-color rendering.
 *
 * Just uploads the texture and overrides the near-infrared (NIR) value in the
 * alpha channel to 1.
 */
function renderRGB(tileData: TextureDataT): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

/**
 * Create a rendering pipeline for false color infrared rendering.
 *
 * Reorders bands so that NIR is mapped to red, red is mapped to green, and
 * green is mapped to blue. Also overrides the alpha channel to 1.
 */
function renderFalseColor(tileData: TextureDataT): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
    { module: setFalseColorInfrared },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

/**
 * Options for {@link renderNDVI} beyond the tile payload.
 */
type RenderNDVIOptions = {
  /** The sprite texture holding all colormaps. */
  colormapTexture: Texture;
  /** [min, max] NDVI values to keep; pixels outside are discarded. */
  ndviRange: [number, number];
  /** Layer index into `colormapTexture` selecting which colormap to sample. */
  colormapIndex: number;
  /** Whether to sample the colormap in reverse. */
  colormapReversed: boolean;
};

/**
 * Create a rendering pipeline for NDVI rendering.
 *
 * Calculates NDVI in a shader module, then applies a color map based on the
 * resulting NDVI value. Also applies an NDVI range filter to allow filtering
 * out pixels with NDVI values outside of a specified range.
 */
function renderNDVI(
  tileData: TextureDataT,
  options: RenderNDVIOptions,
): RenderTileResult {
  const { colormapTexture, ndviRange, colormapIndex, colormapReversed } =
    options;
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
    // Call normalized difference, creating a range of [-1, 1] in the red
    // channel
    { module: normalizedDifference },
    // Filter pixels based on range of [-1, 1]
    {
      module: ndviFilter,
      props: { ndviMin: ndviRange[0], ndviMax: ndviRange[1] },
    },
    // Rescale channel from [-1, 1] to [0, 1] for the colormap lookup
    { module: LinearRescale, props: { rescaleMin: -1, rescaleMax: 1 } },
    {
      module: Colormap,
      props: {
        colormapTexture,
        colormapIndex,
        reversed: colormapReversed,
      },
    },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

// @ts-expect-error function kept for reference
// biome-ignore lint/correctness/noUnusedVariables: For now we hard-code our STAC results instead of fetching from the API. We keep this function around for reference and future use.
async function fetchSTACItems(): Promise<STACFeatureCollection> {
  const params = {
    collections: "naip",
    bbox: STAC_BBOX.join(","),
    filter: JSON.stringify({
      op: "=",
      args: [{ property: "naip:state" }, "co"],
    }),
    "filter-lang": "cql2-json",
    datetime: "2023-01-01T00:00:00Z/2023-12-31T23:59:59Z",
    limit: "1000",
  };

  const queryString = new URLSearchParams(params).toString();
  const url = `https://planetarycomputer.microsoft.com/api/stac/v1/search?${queryString}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`STAC API error: ${response.statusText}`);
  }

  const data: STACFeatureCollection = await response.json();
  return data;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [stacItems, setStacItems] = useState<PartialSTACItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("trueColor");
  const [ndviRange, setNdviRange] = useState<[number, number]>([-1, 1]);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  const [colormapId, setColormapId] = useState<ColormapId>(DEFAULT_COLORMAP_ID);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);

  const colormapChoice = useMemo(
    () =>
      COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0],
    [colormapId],
  );

  // Fetch STAC items on mount
  useEffect(() => {
    async function wrappedFetchSTACItems() {
      try {
        const data = STAC_DATA as unknown as STACFeatureCollection;
        setStacItems(data.features);
      } catch (err) {
        console.error("Error fetching STAC items:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch STAC items",
        );
      } finally {
        setLoading(false);
      }
    }

    wrappedFetchSTACItems();
  }, []);

  // Decode the shipped colormap sprite once at mount. Returns ImageData and
  // doesn't need a GPU device, so it can run in parallel with STAC fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(colormapsPngUrl);
        const bytes = await resp.arrayBuffer();
        const image = await decodeColormapSprite(bytes);
        if (cancelled) {
          return;
        }
        setColormapImage(image);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load colormap sprite:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the colormap sprite once both the Device and the decoded ImageData
  // are available.
  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

  const layers = [];

  if (stacItems.length > 0 && colormapTexture) {
    const mosaicLayer = new MosaicLayer<PartialSTACItem, GeoTIFF>({
      id: "naip-mosaic-layer",
      sources: stacItems,
      // For each source, fetch the GeoTIFF instance from a module-level cache
      // (see `geotiffCache` above). The cache is intentionally separate from
      // the MosaicLayer's TileLayer cache so we can keep cheap header metadata
      // around indefinitely without pinning every parent tile (and its inner
      // COGLayer's in-flight tile requests) in memory.
      getSource: async (source, opts) =>
        getCachedGeoTIFF(source.assets.image.href, opts),
      renderSource: (source, { data, signal }) => {
        const url = source.assets.image.href;
        return new COGLayer<TextureDataT>({
          id: `cog-${url}`,
          epsgResolver,
          geotiff: data,
          getTileData,
          renderTile:
            renderMode === "trueColor"
              ? renderRGB
              : renderMode === "falseColor"
                ? renderFalseColor
                : (tileData) =>
                    renderNDVI(tileData, {
                      colormapTexture,
                      ndviRange,
                      colormapIndex: colormapChoice.colormapIndex,
                      colormapReversed: colormapChoice.reversed,
                    }),
          onTileUnload: (tile) => tile.content?.texture.destroy(),
          signal,
        });
      },
      // Disable the MosaicLayer tile cache: each cached tile is a full
      // COGLayer instance, and opened GeoTIFFs are already kept in the
      // module-level `geotiffCache`, so there's nothing cheap to retain here.
      maxCacheSize: 0,
      // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
      // doesn't know about it.
      beforeId: "boundary_country_outline",
    });
    layers.push(mosaicLayer);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -104.9903,
          latitude: 39.7392,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }}
        maxBounds={[
          [STAC_BBOX[0] - 1, STAC_BBOX[1] - 1],
          [STAC_BBOX[2] + 1, STAC_BBOX[3] + 1],
        ]}
        minZoom={4}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      <ControlPanel
        loading={loading}
        error={error}
        stacItemCount={stacItems.length}
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        colormapId={colormapId}
        onColormapIdChange={setColormapId}
        colormapChoice={colormapChoice}
        ndviRange={ndviRange}
        onNdviRangeChange={setNdviRange}
      />
    </div>
  );
}
