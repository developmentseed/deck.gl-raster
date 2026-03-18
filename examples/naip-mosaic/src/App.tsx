import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer, MosaicLayer } from "@developmentseed/deck.gl-geotiff";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer";
import "./proj";
import type { Overview } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import colormap from "./cfastie";
import STAC_DATA from "./minimal_stac.json";
import { epsgResolver } from "./proj";

/** Bounding box query passed to Microsoft Planetary Computer STAC API */
const STAC_BBOX = [-106.6059, 38.7455, -104.5917, 40.4223];

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

type STACItem = {
  bbox: [number, number, number, number];
  assets: {
    image: {
      href: string;
    };
  };
};

type STACFeatureCollection = {
  features: STACItem[];
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

/** Shader module that sets alpha channel to 1.0 */
const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

/** Shader module that reorders bands to a false color infrared composite. */
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

// TODO: enable NDVI filtering
const _ndviFilter = {
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

function renderRGB(tileData: TextureDataT): RasterModule[] {
  const { texture } = tileData;
  return [
    {
      module: CreateTexture,
      props: {
        textureName: texture,
      },
    },
    {
      module: SetAlpha1,
    },
  ];
}

function renderFalseColor(tileData: TextureDataT): RasterModule[] {
  const { texture } = tileData;
  return [
    {
      module: CreateTexture,
      props: {
        textureName: texture,
      },
    },
    {
      module: setFalseColorInfrared,
    },
    {
      module: SetAlpha1,
    },
  ];
}

function renderNDVI(
  tileData: TextureDataT,
  colormapTexture: Texture,
  // ndviRange: [number, number],
): RasterModule[] {
  const { texture } = tileData;
  return [
    {
      module: CreateTexture,
      props: {
        textureName: texture,
      },
    },
    {
      module: ndvi,
    },
    // {
    //   module: ndviFilter,
    //   props: {
    //     ndviMin: ndviRange[0],
    //     ndviMax: ndviRange[1],
    //   },
    // },
    {
      module: Colormap,
      props: {
        colormapTexture,
      },
    },
    {
      module: SetAlpha1,
    },
  ];
}

type RenderMode = "trueColor" | "falseColor" | "ndvi";

const RENDER_MODE_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: "trueColor", label: "True Color" },
  { value: "falseColor", label: "False Color Infrared" },
  { value: "ndvi", label: "NDVI" },
];

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
  const [stacItems, setStacItems] = useState<STACItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("trueColor");
  const [ndviRange, setNdviRange] = useState<[number, number]>([-1, 1]);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

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
    const mosaicLayer = new MosaicLayer<STACItem, GeoTIFF>({
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
                : (tileData) => renderNDVI(tileData, colormapTexture),
          signal,
        });
      },
      // We have a max of 1000 STAC items fetched from the Microsoft STAC API;
      // this isn't so large that we can't just cache all the GeoTIFF header
      // metadata instances
      maxCacheSize: Infinity,
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
            maxWidth: "300px",
            pointerEvents: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>NAIP Mosaic</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
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

          {/* TODO: enable pixel filter */}
          {false && renderMode === "ndvi" && (
            <div style={{ marginTop: "16px" }}>
              <label
                htmlFor="ndvi-filter-min"
                style={{ fontSize: "14px", fontWeight: 500 }}
              >
                NDVI Filter
              </label>
              <div
                style={{
                  position: "relative",
                  height: "20px",
                  marginTop: "8px",
                }}
              >
                {/* Background track */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: 0,
                    right: 0,
                    height: "4px",
                    transform: "translateY(-50%)",
                    background: "#ddd",
                    borderRadius: "2px",
                  }}
                />
                {/* Selected range track */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: `${((ndviRange[0] + 1) / 2) * 100}%`,
                    width: `${((ndviRange[1] - ndviRange[0]) / 2) * 100}%`,
                    height: "4px",
                    transform: "translateY(-50%)",
                    background: "#007bff",
                    borderRadius: "2px",
                  }}
                />
                <input
                  id="ndvi-filter-min"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={ndviRange[0]}
                  onChange={(e) =>
                    setNdviRange([
                      Math.min(parseFloat(e.target.value), ndviRange[1] - 0.01),
                      ndviRange[1],
                    ])
                  }
                  style={{
                    position: "absolute",
                    width: "100%",
                    pointerEvents: "none",
                    background: "transparent",
                    zIndex: 1,
                  }}
                  className="range-thumb"
                />
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={ndviRange[1]}
                  onChange={(e) =>
                    setNdviRange([
                      ndviRange[0],
                      Math.max(parseFloat(e.target.value), ndviRange[0] + 0.01),
                    ])
                  }
                  style={{
                    position: "absolute",
                    width: "100%",
                    pointerEvents: "none",
                    background: "transparent",
                    zIndex: 2,
                  }}
                  className="range-thumb"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "8px",
                  fontSize: "12px",
                  color: "#666",
                }}
              >
                <span>-1</span>
                <span>
                  {ndviRange[0].toFixed(2)} to {ndviRange[1].toFixed(2)}
                </span>
                <span>+1</span>
              </div>
              <style>{`
                .range-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  height: 4px;
                }
                .range-thumb::-webkit-slider-thumb {
                  -webkit-appearance: none;
                  appearance: none;
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: #007bff;
                  cursor: pointer;
                  pointer-events: auto;
                  border: 2px solid white;
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                }
                .range-thumb::-moz-range-thumb {
                  width: 16px;
                  height: 16px;
                  border-radius: 50%;
                  background: #007bff;
                  cursor: pointer;
                  pointer-events: auto;
                  border: 2px solid white;
                  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                }
              `}</style>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
