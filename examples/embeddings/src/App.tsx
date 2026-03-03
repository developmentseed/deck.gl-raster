import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import { CreateTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Device } from "@luma.gl/core";
import { useCallback, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

const NUM_BANDS = 64;
const DEFAULT_COG_URL =
  // "https://data.source.coop/tge-labs/aef/v1/annual/2024/13N/xjejfvrbm1fbu1ecw-0000000000-0000008192.tiff";
  "http://devseed-gadomski-demo.s3-website-us-east-1.amazonaws.com/xjejfvrbm1fbu1ecw-0000000000-0000008192.flipped.tif";

type TileData = {
  device: Device;
  data: Uint8Array;
  height: number;
  width: number;
};

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

type FetchedTile = Awaited<ReturnType<GeoTIFF["fetchTile"]>>;
const bandCache = new Map<string, FetchedTile>();

function makeTileDataFetcher(bands: [number, number, number]) {
  return async function getTileData(
    image: GeoTIFF | Overview,
    options: GetTileDataOptions,
  ): Promise<TileData> {
    const { device, x, y, signal } = options;
    const tiles = await Promise.all(
      bands.map((b) => {
        const key = `${x}-${y}-${b}`;
        const cached = bandCache.get(key);
        if (cached) return cached;
        const result = image
          .fetchTile(x, y, { signal, boundless: false, band: b })
          .then((tile) => {
            bandCache.set(key, tile);
            return tile;
          });
        return result;
      }),
    );

    const { width, height } = tiles[0]!.array;
    const pixelCount = width * height;
    const uint8Data = new Uint8Array(pixelCount * 4);

    for (let i = 0; i < pixelCount; i++) {
      const outBase = i * 4;
      for (let c = 0; c < 3; c++) {
        const tile = tiles[c]!;
        const value =
          tile.array.layout === "pixel-interleaved"
            ? (tile.array.data[i] as number)
            : (tile.array.bands[0]![i] as number);
        uint8Data[outBase + c] = value + 128;
      }
      uint8Data[outBase + 3] = 255;
    }

    return { device, data: uint8Data, height, width };
  };
}

function renderTile(data: TileData): RasterModule[] {
  const { device, data: uint8Data, height, width } = data;
  const texture = device.createTexture({
    data: uint8Data,
    format: "rgba8unorm",
    width,
    height,
    sampler: { magFilter: "nearest", minFilter: "nearest" },
  });
  return [{ module: CreateTexture, props: { textureName: texture } }];
}

function BandSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 14, fontWeight: 600 }}>{label}</span>
      <input
        type="number"
        min={0}
        max={NUM_BANDS - 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 52 }}
      />
      <input
        type="range"
        min={0}
        max={NUM_BANDS - 1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function App() {
  const [cogUrl, setCogUrl] = useState(DEFAULT_COG_URL);
  const [r, setR] = useState(0);
  const [g, setG] = useState(1);
  const [b, setB] = useState(2);

  const getTileData = useCallback(
    () => makeTileDataFetcher([r, g, b]),
    [r, g, b],
  );

  const layer = new COGLayer<TileData>({
    id: `embeddings-layer-${cogUrl}-${r}-${g}-${b}`,
    geotiff: cogUrl,
    getTileData: getTileData(),
    renderTile,
  });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <MaplibreMap
        initialViewState={{
          longitude: -105.1,
          latitude: 40.17,
          zoom: 10,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={[layer]} />
      </MaplibreMap>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          background: "rgba(0,0,0,0.8)",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: 6,
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <input
          type="text"
          value={cogUrl}
          onChange={(e) => setCogUrl(e.target.value)}
          placeholder="COG URL"
          style={{
            width: 360,
            padding: "4px 6px",
            fontSize: 13,
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 4,
          }}
        />
        <BandSelector label="R" value={r} onChange={setR} />
        <BandSelector label="G" value={g} onChange={setG} />
        <BandSelector label="B" value={b} onChange={setB} />
      </div>
    </div>
  );
}
