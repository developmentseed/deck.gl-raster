import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer, loadRgbImage, proj } from "@developmentseed/deck.gl-geotiff";
import { Device, Texture } from "@luma.gl/core";
import type { GeoTIFFImage } from "geotiff";
import { Pool } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import "maplibre-gl/dist/maplibre-gl.css";
import proj4 from "proj4";
import { useRef, useState } from "react";
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

// const COG_URL =
//   "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff";

const COG_URL =
  "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif";

type DataT = {
  texture: Texture;
  height: number;
  width: number;
};

async function getTileData(
  image: GeoTIFFImage,
  options: {
    device: Device;
    window: [number, number, number, number];
    signal?: AbortSignal;
    pool: Pool;
  },
): Promise<DataT> {
  const { device } = options;
  const { texture: data, height, width } = await loadRgbImage(image, options);

  // Note: if we set this format to r8unorm it'll only fill the red channel of
  // the texture, making it red.
  const texture = device.createTexture({
    format: "rgba8unorm",
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

function renderTile(data: DataT) {
  const { texture } = data;
  return {
    texture: data.texture,
    shaders: {
      shaderProps: {
        moduleName: {
          textureName: texture,
        },
      },
    },
  };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [pool] = useState<Pool>(new Pool());

  const layers = true
    ? [
        new COGLayer({
          id: "cog-layer",
          geotiff: COG_URL,
          maxError: 0.125,
          debug,
          debugOpacity,
          geoKeysParser,
          pool,
          getTileData,
          renderTile,
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
          beforeId: "boundary_country_outline",
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
        <DeckGLOverlay layers={layers} interleaved />
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
        </div>
      </div>
    </div>
  );
}
