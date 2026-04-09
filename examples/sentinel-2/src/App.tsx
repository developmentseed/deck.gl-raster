import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Sentinel-2 L2A scene — New York area, 2026-01-01
// Band COGs are stored individually with different spatial resolutions:
// - B02 (Blue), B03 (Green), B04 (Red), B08 (NIR): 10m
// - B05, B06, B07, B8A, B11, B12: 20m
// - B01, B09, B10: 60m
const SCENE_BASE =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A";

type CompositePreset = {
  title: string;
  sources: Record<string, { url: string }>;
  composite: { r: string; g?: string; b?: string };
};

const PRESETS: CompositePreset[] = [
  {
    title: "True Color (B04, B03, B02) — all 10m",
    sources: {
      red: { url: `${SCENE_BASE}/B04.tif` },
      green: { url: `${SCENE_BASE}/B03.tif` },
      blue: { url: `${SCENE_BASE}/B02.tif` },
    },
    composite: { r: "red", g: "green", b: "blue" },
  },
  {
    title: "False Color NIR (B08, B04, B03) — all 10m",
    sources: {
      nir: { url: `${SCENE_BASE}/B08.tif` },
      red: { url: `${SCENE_BASE}/B04.tif` },
      green: { url: `${SCENE_BASE}/B03.tif` },
    },
    composite: { r: "nir", g: "red", b: "green" },
  },
  {
    title: "SWIR Composite (B12, B8A, B04) — 20m + 20m + 10m",
    sources: {
      swir: { url: `${SCENE_BASE}/B12.tif` },
      nir: { url: `${SCENE_BASE}/B8A.tif` },
      red: { url: `${SCENE_BASE}/B04.tif` },
    },
    composite: { r: "swir", g: "nir", b: "red" },
  },
  {
    title: "Vegetation (B08, B11, B04) — 10m + 20m + 10m",
    sources: {
      nir: { url: `${SCENE_BASE}/B08.tif` },
      swir: { url: `${SCENE_BASE}/B11.tif` },
      red: { url: `${SCENE_BASE}/B04.tif` },
    },
    composite: { r: "nir", g: "swir", b: "red" },
  },
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const preset = PRESETS[selectedIndex];

  const layer = new MultiCOGLayer({
    id: "sentinel-2-multi",
    sources: preset.sources,
    composite: preset.composite,
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -74.0,
          latitude: 40.7,
          zoom: 10,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={[layer]} interleaved />
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
            maxWidth: "350px",
            pointerEvents: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
            Sentinel-2 Multi-Band
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#666" }}>
            Renders individual band COGs at different resolutions using
            MultiCOGLayer. The GPU handles cross-resolution resampling.
          </p>
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "4px",
              cursor: "pointer",
            }}
          >
            {PRESETS.map((p, i) => (
              <option key={p.title} value={i}>
                {p.title}
              </option>
            ))}
          </select>
          <p style={{ margin: "8px 0 0 0", fontSize: "11px", color: "#999" }}>
            Bands:{" "}
            {Object.entries(preset.sources)
              .map(([name, s]) => {
                const band = s.url.split("/").pop()?.replace(".tif", "");
                return `${name}=${band}`;
              })
              .join(", ")}
          </p>
        </div>
      </div>
    </div>
  );
}
