import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Device, Texture } from "@luma.gl/core";
import { ShaderModule } from "@luma.gl/shadertools";
import {
  COGLayer,
  parseColormap,
  proj,
} from "@developmentseed/deck.gl-geotiff";
import type {
  GeoTIFF,
  GeoTIFFImage,
  TypedArrayArrayWithDimensions,
} from "geotiff";
import { RasterLayerProps } from "@developmentseed/deck.gl-raster";
import { fromUrl, Pool } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import "maplibre-gl/dist/maplibre-gl.css";
import proj4 from "proj4";
import { useEffect, useRef, useState } from "react";
import { Map, useControl, type MapRef } from "react-map-gl/maplibre";

window.proj4 = proj4;

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

async function geoKeysParser(
  geoKeys: Record<string, any>,
): Promise<proj.ProjectionInfo> {
  const projDefinition = toProj4(geoKeys as any);
  (window as any).projDefinition = projDefinition;

  return {
    def: projDefinition.proj4,
    parsed: proj.parseCrs(projDefinition.proj4),
    coordinatesUnits: projDefinition.coordinatesUnits as proj.SupportedCrsUnit,
  };
}

const COG_URL =
  "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif";

export type LandCoverProps = {
  colormap_texture: Texture;
};

const landCoverModule = {
  name: "landCover",
} as const satisfies ShaderModule<LandCoverProps>;

async function getTileData(
  image: GeoTIFFImage,
  options: {
    device: Device;
    window: [number, number, number, number];
    signal?: AbortSignal;
    pool: Pool;
  },
): Promise<TileDataT> {
  const { device, window, signal, pool } = options;

  const {
    [0]: data,
    width,
    height,
  } = (await image.readRasters({
    window,
    samples: [0],
    pool,
    signal,
  })) as TypedArrayArrayWithDimensions;

  const texture = device.createTexture({
    format: "r8unorm",
    dimension: "2d",
    width,
    height,
    data,
  });

  return {
    texture,
    height,
    width,
  };
}

type TileDataT = {
  texture: Texture;
  height: number;
  width: number;
};

function renderTile(
  tileData: TileDataT,
  colormapTexture: Texture,
): {
  texture: RasterLayerProps["texture"];
  shaders?: RasterLayerProps["shaders"];
} {
  const { texture } = tileData;

  // Hard coded NoData value but this ideally would be fetched from COG metadata
  const nodataVal = 250;
  // Since values are 0-1 for unorm textures,
  const noDataScaled = nodataVal / 255.0;

  return {
    texture,
    // For colormap rendering:
    shaders: {
      inject: {
        "fs:#decl": `
          uniform sampler2D colormap_texture;
        `,
        "fs:DECKGL_FILTER_COLOR": `
          float value = color.r;
          vec3 pickingval = vec3(value, 0., 0.);
          if (value == ${noDataScaled}) {
              discard;
            } else {
              vec4 color_val = texture(colormap_texture, vec2(value, 0.));
              color = color_val;
            }
        `,
      },
      modules: [landCoverModule],
      shaderProps: {
        landCover: {
          colormap_texture: colormapTexture,
        },
      },
    },
  };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [pool] = useState<Pool>(new Pool());
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadGeoTIFF() {
      try {
        setLoading(true);
        setError(null);

        const tiff = await fromUrl(COG_URL);
        (window as any).tiff = tiff;

        if (mounted) {
          setGeotiff(tiff);

          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load GeoTIFF",
          );
          setLoading(false);
        }
      }
    }

    loadGeoTIFF();

    return () => {
      mounted = false;
    };
  }, []);

  // Once device exists, create global colormap texture
  useEffect(() => {
    async function createColormapTexture() {
      if (device && geotiff) {
        const image = await geotiff.getImage();
        const { data, width, height } = parseColormap(
          image.fileDirectory.ColorMap,
        );
        const colorMapTexture = device.createTexture({
          data,
          format: "rgba8unorm",
          width,
          height,
          sampler: {
            minFilter: "nearest",
            magFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
          },
        });

        setColormapTexture(colorMapTexture);
      }
    }

    createColormapTexture();
  }, [geotiff, device]);

  const layers =
    geotiff && colormapTexture
      ? [
          new COGLayer<TileDataT>({
            id: "cog-layer",
            geotiff,
            maxError: 0.125,
            debug,
            debugOpacity,
            geoKeysParser,
            pool,
            getTileData,
            renderTile: (tileData) => renderTile(tileData, colormapTexture),
            onGeoTIFFLoad: (_tiff, options) => {
              const { west, south, east, north } = options.geographicBounds;
              mapRef.current?.fitBounds(
                [
                  [west, south],
                  [east, north],
                ],
                {
                  padding: 40,
                  duration: 1000,
                },
              );
            },
            beforeId: "aeroway-runway",
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={(device) => setDevice(device)}
        />
      </Map>

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
        {loading && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              pointerEvents: "auto",
            }}
          >
            Loading GeoTIFF...
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#ff4444",
              color: "white",
              padding: "12px 24px",
              borderRadius: "4px",
              maxWidth: "80%",
              pointerEvents: "auto",
            }}
          >
            Error: {error}
          </div>
        )}

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
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
            COGLayer Example
          </h3>
          {/* <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
            Displaying RGB imagery from New Zealand (NZTM2000 projection)
          </p> */}

          {/* Debug Controls */}
          <div
            style={{
              padding: "12px 0",
              borderTop: "1px solid #eee",
              marginTop: "12px",
            }}
          >
            {/* <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                cursor: "pointer",
                marginBottom: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={renderAsTiled}
                onChange={(e) => setRenderAsTiled(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <span>Render as tiled</span>
            </label> */}

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                cursor: "pointer",
                marginBottom: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <span>Show Debug Mesh</span>
            </label>

            {debug && (
              <div style={{ marginTop: "8px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#666",
                    marginBottom: "4px",
                  }}
                >
                  Debug Opacity: {debugOpacity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={debugOpacity}
                  onChange={(e) => setDebugOpacity(parseFloat(e.target.value))}
                  style={{ width: "100%", cursor: "pointer" }}
                />
              </div>
            )}
          </div>

          {/* <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #eee",
              fontSize: "12px",
              color: "#999",
            }}
          >
            <div>Max Error: 0.125 pixels</div>
            <div>Source: LINZ</div>
          </div> */}
        </div>
      </div>
    </div>
  );
}
