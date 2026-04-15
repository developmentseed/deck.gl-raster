import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  CutlineBbox,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Emigrant Gap, CA — 1955, 1:62,500 scale USGS quad.
// WGS84 bbox from the USGS HTMC metadata CSV (westbc, southbc, eastbc, northbc).
const TOPO_URL =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CA/CA_Emigrant%20Gap_297419_1955_62500_geo.tif";
const TOPO_BBOX: [number, number, number, number] = [
  -120.75, 39.25, -120.5, 39.5,
];

type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
};

/**
 * Pad an RGB Uint8 buffer to RGBA by filling alpha with 255. WebGL2 has no
 * rgb8unorm format, so we have to inflate.
 */
function rgbToRgba(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Minimal tile loader for a 3-band uint8 RGB JPEG-compressed COG (the shape
 * USGS HTMC GeoTIFFs use). Decoder converts YCbCr JPEG → RGB bytes via the
 * browser's image decoder; we pad to RGBA here for WebGL2.
 */
async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<TextureDataT> {
  const { device, x, y, signal, pool } = options;
  const tile = await image.fetchTile(x, y, { signal, pool, boundless: false });
  const { array } = tile;

  if (array.layout === "band-separate") {
    throw new Error("USGS topo tiles are pixel interleaved");
  }

  const { width, height, data } = array;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    throw new Error("USGS topo tiles should decode to uint8");
  }

  const rgba =
    data.length === width * height * 3
      ? rgbToRgba(data, width, height)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const texture = device.createTexture({
    data: rgba,
    format: "rgba8unorm",
    width,
    height,
  });

  return { texture, width, height };
}

/**
 * Explicit two-module render pipeline: upload the tile texture, then
 * (optionally) discard fragments outside the USGS quad's WGS84 bbox.
 */
function renderTile(
  tileData: TextureDataT,
  cutlineEnabled: boolean,
): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
  ];
  if (cutlineEnabled) {
    renderPipeline.push({
      module: CutlineBbox,
      props: { bbox: TOPO_BBOX },
    });
  }
  return { renderPipeline };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [cutlineEnabled, setCutlineEnabled] = useState(true);
  const [zoom, setZoom] = useState(11);

  const layer = new COGLayer<TextureDataT>({
    id: "usgs-topo",
    geotiff: TOPO_URL,
    getTileData,
    renderTile: (data) => renderTile(data, cutlineEnabled),
    onGeoTIFFLoad: (_tiff, options) => {
      const { west, south, east, north } = options.geographicBounds;
      mapRef.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 1000 },
      );
    },
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -120.625,
          latitude: 39.375,
          zoom: 11,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        onMove={(e) => setZoom(e.viewState.zoom)}
      >
        <DeckGLOverlay layers={[layer]} interleaved />
      </MaplibreMap>

      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          background: "white",
          padding: "16px",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "320px",
          zIndex: 1000,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
          USGS Topo Cutline Example
        </h3>
        <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#444" }}>
          Emigrant Gap, CA 1:62,500 quad (1955). Render pipeline is two explicit
          modules: <code>CreateTexture</code> uploads the raw RGB pixels, and{" "}
          <code>CutlineBbox</code> discards fragments outside the map's WGS84
          bbox to hide the metadata collar.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={cutlineEnabled}
            onChange={(e) => setCutlineEnabled(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span>Discard map collar (CutlineBbox)</span>
        </label>
        <div
          style={{
            marginTop: "12px",
            paddingTop: "12px",
            borderTop: "1px solid #eee",
            fontSize: "13px",
            color: "#444",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          zoom: {zoom.toFixed(2)}
        </div>
      </div>
    </div>
  );
}
