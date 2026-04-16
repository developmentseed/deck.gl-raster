import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer, MosaicLayer } from "@developmentseed/deck.gl-geotiff";
import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Overview } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import * as Slider from "@radix-ui/react-slider";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer";
import colormap from "./cfastie";
import "./proj";
import STAC_DATA from "./minimal_stac.json";
import { epsgResolver } from "./proj";

/** Bounding box query passed to Microsoft Planetary Computer STAC API */
const STAC_BBOX = [-106.6059, 38.7455, -104.5917, 40.4223];

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

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

/** Shader module that calculates NDVI. */
const ndvi = {
  name: "ndvi",
  inject: {
    // Colors in the original image are ordered as: R, G, B, NIR
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float nir = color[3];
      float red = color[0];
      float ndvi = (nir - red) / (nir + red);
      // normalize to 0-1 range
      color.r = (ndvi + 1.0) / 2.0;
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
      ndviMin: props.ndviMin || -1.0,
      ndviMax: props.ndviMax || 1.0,
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
 * Create a rendering pipeline for NDVI rendering.
 *
 * Calculates NDVI in a shader module, then applies a color map based on the
 * resulting NDVI value. Also applies an NDVI range filter to allow filtering
 * out pixels with NDVI values outside of a specified range.
 */
function renderNDVI(
  tileData: TextureDataT,
  colormapTexture: Texture,
  ndviRange: [number, number],
): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
    { module: ndvi },
    {
      module: ndviFilter,
      props: { ndviMin: ndviRange[0], ndviMax: ndviRange[1] },
    },
    { module: Colormap, props: { colormapTexture } },
    { module: SetAlpha1 },
  ];
  return { renderPipeline };
}

type RenderMode = "trueColor" | "falseColor" | "ndvi";

const RENDER_MODE_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: "trueColor", label: "True Color" },
  { value: "falseColor", label: "False Color Infrared" },
  { value: "ndvi", label: "NDVI" },
];

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
  const [panelOpen, setPanelOpen] = useState(true);

  // Fetch STAC items on mount
  useEffect(() => {
    async function wrappedFetchSTACItems() {
      try {
        // const data: STACFeatureCollection = await fetchSTACItems();
        const data = STAC_DATA as unknown as STACFeatureCollection;
        (window as any).data = data;
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

  useEffect(() => {
    if (!device) return;

    // Create colormap texture
    const texture = device.createTexture({
      data: colormap.data,
      width: colormap.width,
      height: colormap.height,
      format: "rgba8unorm",
      sampler: {
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });

    setColormapTexture(texture);
  }, [device]);

  const layers = [];

  if (stacItems.length > 0 && colormapTexture) {
    const mosaicLayer = new MosaicLayer<PartialSTACItem, GeoTIFF>({
      id: "naip-mosaic-layer",
      sources: stacItems,
      // For each source, fetch the GeoTIFF instance
      // Doing this in getSource allows us to cache the results using TileLayer
      // mechanisms.
      getSource: async (source, { signal: _ }) => {
        const url = source.assets.image.href;
        // TODO: restore passing down signal
        // https://github.com/developmentseed/deck.gl-raster/issues/292
        const tiff = await GeoTIFF.fromUrl(url);
        return tiff;
      },
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
                    renderNDVI(tileData, colormapTexture, ndviRange),
          signal,
        });
      },
      // We have a max of 1000 STAC items fetched from the Microsoft STAC API;
      // this isn't so large that we can't just cache all the GeoTIFF header
      // metadata instances
      maxCacheSize: Infinity,
      // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
      // doesn't know about it.
      beforeId: "tunnel_service_case",
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
        <DeckGLOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      {/* UI Overlay Container */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1000,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            width: "300px",
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            style={{
              all: "unset",
              width: "100%",
              margin: 0,
              fontSize: "16px",
              fontWeight: "bold",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              userSelect: "none",
            }}
            onClick={() => setPanelOpen((o) => !o)}
          >
            NAIP Mosaic
            <span
              style={{
                fontSize: "12px",
                transition: "transform 0.2s",
                transform: panelOpen ? "rotate(0deg)" : "rotate(-90deg)",
              }}
            >
              ▼
            </span>
          </button>
          {panelOpen && <>
          <p style={{ margin: "8px 0 12px 0", fontSize: "14px", color: "#666" }}>
            {loading && "Loading STAC items... "}
            {error && `Error: ${error}`}
            {!loading && !error && `Fetched ${stacItems.length} `}
            <a
              href="https://stacspec.org/en"
              target="_blank"
              rel="noopener noreferrer"
            >
              STAC
            </a>
            {" Items "}
            from{" "}
            <a
              href="https://planetarycomputer.microsoft.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Microsoft Planetary Computer
            </a>
            's{" "}
            <a
              href="https://planetarycomputer.microsoft.com/dataset/naip"
              target="_blank"
              rel="noopener noreferrer"
            >
              NAIP dataset
            </a>
            .
            <br />
            <br />
            All imagery is rendered client-side with <b>no server involved</b>{" "}
            using{" "}
            <a
              href="https://github.com/developmentseed/deck.gl-raster"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: "monospace",
              }}
            >
              @developmentseed/deck.gl-raster
            </a>
            .
          </p>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
            <a
              href="https://developmentseed.org/deck.gl-raster/"
              target="_blank"
              rel="noopener noreferrer"
            >
              deck.gl-raster Documentation ↗
            </a>
          </p>

          <div>
            <label
              htmlFor="render-mode"
              style={{ fontSize: "14px", fontWeight: 500 }}
            >
              Render Mode
            </label>
            <select
              id="render-mode"
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value as RenderMode)}
              style={{
                width: "100%",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: "1px solid #ccc",
              }}
            >
              {RENDER_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {renderMode === "ndvi" && (
            <div style={{ marginTop: "16px" }}>
              <span style={{ fontSize: "14px", fontWeight: 500 }}>
                NDVI Range
              </span>
              <Slider.Root
                min={-1}
                max={1}
                step={0.01}
                value={ndviRange}
                onValueChange={(v) => setNdviRange(v as [number, number])}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  userSelect: "none",
                  touchAction: "none",
                  height: "20px",
                  marginTop: "12px",
                }}
              >
                <Slider.Track
                  style={{
                    position: "relative",
                    flexGrow: 1,
                    height: "4px",
                    background: "#ddd",
                    borderRadius: "2px",
                  }}
                >
                  <Slider.Range
                    style={{
                      position: "absolute",
                      height: "100%",
                      background: "#4a7c59",
                      borderRadius: "2px",
                    }}
                  />
                </Slider.Track>
                {(["min", "max"] as const).map((key) => (
                  <Slider.Thumb
                    key={key}
                    style={{
                      display: "block",
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      background: "#4a7c59",
                      border: "2px solid white",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                      cursor: "pointer",
                      outline: "none",
                    }}
                  />
                ))}
              </Slider.Root>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "6px",
                  fontSize: "12px",
                  color: "#666",
                }}
              >
                <span>-1</span>
                <span>
                  {ndviRange[0].toFixed(2)} – {ndviRange[1].toFixed(2)}
                </span>
                <span>+1</span>
              </div>
            </div>
          )}
          </>}
        </div>
      </div>
    </div>
  );
}
