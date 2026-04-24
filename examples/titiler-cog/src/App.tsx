import type { _TileLoadProps as TileLoadProps } from "@deck.gl/geo-layers";
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type {
  GetTileDataOptions,
  MinimalTileData,
  RasterModule,
  RenderTileResult,
  TilesetDescriptor,
} from "@developmentseed/deck.gl-raster";
import {
  RasterTileLayer,
  TileMatrixSetAdaptor,
} from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  MaskTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import type { Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import npyjs from "npyjs";
import proj4 from "proj4";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const COG_URL =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif";
const TITILER_BASE = "https://titiler.xyz";

type InfoResponse = {
  bounds: [number, number, number, number]; // WGS84 [w, s, e, n]
  band_descriptions?: [string, Record<string, unknown>][];
  dtype?: string;
  [key: string]: unknown;
};

function buildDescriptor(tms: TileMatrixSet): TilesetDescriptor {
  const converter = proj4("EPSG:3857", "EPSG:4326");
  const projectTo4326 = (x: number, y: number) =>
    converter.forward<[number, number]>([x, y], false);
  const projectFrom4326 = (x: number, y: number) =>
    converter.inverse<[number, number]>([x, y], false);
  const identity = (x: number, y: number): [number, number] => [x, y];
  return new TileMatrixSetAdaptor(tms, {
    projectTo3857: identity,
    projectFrom3857: identity,
    projectTo4326,
    projectFrom4326,
  });
}

type TileData = MinimalTileData & {
  texture: Texture;
  mask?: Texture;
};

/**
 * Repack a band-separate uint8 buffer of shape [B, H, W] into an
 * interleaved RGBA uint8 buffer of length H*W*4. Bands 0-2 go to R/G/B;
 * alpha is always 255 (the 4th titiler band is a mask, handled separately).
 */
function repackToRGBA(
  bandSeparate: Uint8Array,
  height: number,
  width: number,
): Uint8Array {
  const pixelCount = height * width;
  const rgba = new Uint8Array(pixelCount * 4);
  const bandOffset0 = 0;
  const bandOffset1 = pixelCount;
  const bandOffset2 = 2 * pixelCount;
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = bandSeparate[bandOffset0 + i]!;
    rgba[i * 4 + 1] = bandSeparate[bandOffset1 + i]!;
    rgba[i * 4 + 2] = bandSeparate[bandOffset2 + i]!;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function tileNpyUrl(x: number, y: number, z: number): string {
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/${z}/${x}/${y}.npy?url=${encodeURIComponent(COG_URL)}`;
}

async function getTileData(
  tile: TileLoadProps,
  options: GetTileDataOptions,
): Promise<TileData> {
  const { device, signal } = options;
  const { x, y, z } = tile.index;
  const response = await fetch(tileNpyUrl(x, y, z), { signal });
  if (!response.ok) {
    throw new Error(
      `titiler tile ${z}/${x}/${y} ${response.status}: ${await response.text()}`,
    );
  }
  const buffer = await response.arrayBuffer();
  const parsed = await new npyjs().load(buffer);
  if (parsed.dtype !== "u1") {
    throw new Error(`Expected uint8 (u1) npy, got dtype=${parsed.dtype}`);
  }
  if (parsed.shape.length !== 3) {
    throw new Error(
      `Expected shape [B, H, W], got [${parsed.shape.join(", ")}]`,
    );
  }
  const [bands, height, width] = parsed.shape as [number, number, number];
  if (bands !== 3 && bands !== 4) {
    throw new Error(`Expected 3 or 4 bands, got ${bands}`);
  }
  const data = parsed.data as Uint8Array;
  const rgba = repackToRGBA(data, height, width);
  const texture = device.createTexture({
    data: rgba,
    format: "rgba8unorm",
    width,
    height,
    sampler: { minFilter: "linear", magFilter: "linear" },
  });
  let mask: Texture | undefined;
  let byteLength = rgba.byteLength;
  if (bands === 4) {
    const maskBand = data.subarray(3 * height * width, 4 * height * width);
    mask = device.createTexture({
      data: maskBand,
      format: "r8unorm",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    byteLength += maskBand.byteLength;
  }
  return { width, height, byteLength, texture, mask };
}

function renderTile(data: TileData): RenderTileResult {
  const pipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: data.texture } },
  ];
  if (data.mask) {
    pipeline.push({
      module: MaskTexture,
      props: { maskTexture: data.mask },
    });
  }
  return { renderPipeline: pipeline };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [panelOpen, setPanelOpen] = useState(true);
  const [descriptor, setDescriptor] = useState<TilesetDescriptor | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [infoRes, tmsRes] = await Promise.all([
          fetch(`${TITILER_BASE}/cog/info?url=${encodeURIComponent(COG_URL)}`, {
            signal: controller.signal,
          }),
          fetch(`${TITILER_BASE}/tileMatrixSets/WebMercatorQuad`, {
            signal: controller.signal,
          }),
        ]);
        if (!infoRes.ok) {
          throw new Error(
            `cog/info ${infoRes.status}: ${await infoRes.text()}`,
          );
        }
        if (!tmsRes.ok) {
          throw new Error(
            `tileMatrixSets ${tmsRes.status}: ${await tmsRes.text()}`,
          );
        }
        const info = (await infoRes.json()) as InfoResponse;
        const tms = (await tmsRes.json()) as TileMatrixSet;
        setDescriptor(buildDescriptor(tms));
        const [w, s, e, n] = info.bounds;
        mapRef.current?.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 40, duration: 1000 },
        );
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          return;
        }
        setError((err as Error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  const layers = descriptor
    ? [
        new RasterTileLayer<TileData>({
          id: "titiler-raster",
          tilesetDescriptor: descriptor,
          getTileData,
          renderTile,
          debug,
          debugOpacity,
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 2,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={layers} interleaved />
      </MaplibreMap>

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
            width: "320px",
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
            Titiler + RasterTileLayer
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
          {panelOpen && (
            <>
              {error ? (
                <p
                  style={{
                    margin: "8px 0 12px 0",
                    fontSize: "13px",
                    color: "#b00020",
                  }}
                >
                  Error: {error}
                </p>
              ) : (
                <p
                  style={{
                    margin: "8px 0 12px 0",
                    fontSize: "13px",
                    color: "#666",
                  }}
                >
                  Tiles are fetched as numpy <code>.npy</code> arrays from{" "}
                  <code>titiler.xyz</code>, parsed and uploaded as textures
                  client-side, then rendered via <code>RasterTileLayer</code>.
                </p>
              )}
              <p style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
                <a
                  href="https://developmentseed.org/titiler/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Titiler Documentation ↗
                </a>
              </p>

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
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={debugOpacity}
                        onChange={(e) =>
                          setDebugOpacity(parseFloat(e.target.value))
                        }
                        style={{ width: "100%", cursor: "pointer" }}
                      />
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
