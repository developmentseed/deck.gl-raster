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
  lngLatToMercator,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer.js";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

/**
 * Project a WGS84 lng/lat bbox `[west, south, east, north]` to an EPSG:3857
 * mercator bbox `[minX, minY, maxX, maxY]`. USGS quads always have
 * `east > west` and `north > south`, so we can pack the two corner points
 * directly without `Math.min` / `Math.max` guards.
 */
function mercatorBbox(
  west: number,
  south: number,
  east: number,
  north: number,
): [number, number, number, number] {
  const [minX, minY] = lngLatToMercator(west, south);
  const [maxX, maxY] = lngLatToMercator(east, north);
  return [minX, minY, maxX, maxY];
}

/**
 * One USGS historical topo quad to render. The WGS84 data area comes from
 * the HTMC metadata CSV (`westbc`, `southbc`, `eastbc`, `northbc`); we
 * project it to EPSG:3857 meters once at module load so the per-frame
 * shader uniform update is a trivial pass-through.
 */
type TopoOption = {
  title: string;
  url: string;
  /** EPSG:3857 meters, packed as `[minX, minY, maxX, maxY]`. */
  bbox: [number, number, number, number];
};

const TOPO_OPTIONS: TopoOption[] = [
  {
    title: "Emigrant Gap, CA (1955, 1:62,500)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CA/CA_Emigrant%20Gap_297419_1955_62500_geo.tif",
    bbox: mercatorBbox(-120.75, 39.25, -120.5, 39.5),
  },
  {
    title: "Moab, UT (1885, 1:250,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/UT/UT_La%20Sal_250205_1885_250000_geo.tif",
    bbox: mercatorBbox(-110.0, 38.0, -109.0, 39.0),
  },
  {
    title: "Mount St Helens, WA (1919, 1:125,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/WA/WA_Mount%20St%20Helens_242547_1919_125000_geo.tif",
    bbox: mercatorBbox(-122.5, 46.0, -122.0, 46.5),
  },
  {
    title: "Estes Park, CO (1961, 1:24,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CO/CO_Estes%20Park_466919_1961_24000_geo.tif",
    bbox: mercatorBbox(-105.625, 40.375, -105.5, 40.5),
  },
  {
    title: "Kanab Point, AZ (1962, 1:62,500)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    bbox: mercatorBbox(-112.75, 36.25, -112.5, 36.5),
  },
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
  bbox: [number, number, number, number],
): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
  ];
  if (cutlineEnabled) {
    renderPipeline.push({
      module: CutlineBbox,
      props: { bbox },
    });
  }
  return { renderPipeline };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [cutlineEnabled, setCutlineEnabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const selected = TOPO_OPTIONS[selectedIndex]!;

  const layer = new COGLayer<TextureDataT>({
    id: `usgs-topo-${selectedIndex}`,
    geotiff: selected.url,
    getTileData,
    renderTile: (data) => renderTile(data, cutlineEnabled, selected.bbox),
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
          width: "290px",
          zIndex: 1000,
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
          USGS Topographic Maps
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
            <p
              style={{
                margin: "8px 0 12px 0",
                fontSize: "13px",
                color: "#444",
              }}
            >
              This uses the <code>CutlineBbox</code> shader module to avoid
              rendering pixels containing the map collar.
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
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "6px",
                fontSize: "13px",
                marginBottom: "12px",
                cursor: "pointer",
              }}
            >
              {TOPO_OPTIONS.map((opt, i) => (
                <option key={opt.url} value={i}>
                  {opt.title}
                </option>
              ))}
            </select>
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
              <span>Discard map collar</span>
            </label>
          </>
        )}
      </div>
    </div>
  );
}
