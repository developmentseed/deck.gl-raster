import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Sentinel-2 L2A scenes. Each entry points at a scene folder; individual band
// COGs are loaded as `${baseUrl}/${band}.tif`. Band resolutions:
// - B02 (Blue), B03 (Green), B04 (Red), B08 (NIR): 10m
// - B05, B06, B07, B8A, B11, B12: 20m
// - B01, B09, B10: 60m
type Scene = {
  title: string;
  baseUrl: string;
};

const SCENES: Scene[] = [
  {
    title: "Torres del Paine, Chile — 2026-04-06",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/F/XJ/2026/4/S2C_18FXJ_20260406_0_L2A",
  },
  {
    title: "Salar de Uyuni, Bolivia — 2026-04-14",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/19/K/EU/2026/4/S2A_19KEU_20260414_0_L2A",
  },
  {
    title: "Okavango Delta, Botswana — 2025-07-30",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/34/K/FD/2025/7/S2A_34KFD_20250730_0_L2A",
  },
  {
    title: "Sossusvlei, Namibia — 2026-04-13",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/33/J/WN/2026/4/S2C_33JWN_20260413_0_L2A",
  },
  {
    title: "Grand Junction, Colorado — 2026-04-08",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/12/S/YJ/2026/4/S2C_12SYJ_20260408_0_L2A",
  },
  {
    title: "Central California — 2026-04-03",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/10/T/FK/2026/4/S2C_10TFK_20260403_0_L2A",
  },
  {
    title: "Nile Delta, Egypt — 2026-04-12",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/R/TV/2026/4/S2A_36RTV_20260412_1_L2A",
  },
  {
    title: "Kamchatka Peninsula, Russia — 2024-07-22",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/58/V/CH/2024/7/S2A_58VCH_20240722_0_L2A",
  },
  {
    title: "Mount Etna, Italy — 2024-07-25",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/33/S/VB/2024/7/S2B_33SVB_20240725_0_L2A",
  },
  {
    title: "New York — 2026-01-01",
    baseUrl:
      "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A",
  },
];

type CompositePreset = {
  title: string;
  sources: Record<string, string>;
  composite: { r: string; g?: string; b?: string };
};

const PRESETS: CompositePreset[] = [
  {
    title: "True Color (Red, Green, Blue) — all 10m",
    sources: { red: "B04", green: "B03", blue: "B02" },
    composite: { r: "red", g: "green", b: "blue" },
  },
  {
    title: "Infrared False Color (NIR, Red, Green) — all 10m",
    sources: { nir: "B08", red: "B04", green: "B03" },
    composite: { r: "nir", g: "red", b: "green" },
  },
  {
    title: "SWIR Composite (SWIR, NIR B8A, Red) — 20m + 20m + 10m",
    sources: { swir: "B12", nir: "B8A", red: "B04" },
    composite: { r: "swir", g: "nir", b: "red" },
  },
  {
    title: "Vegetation (NIR, SWIR, Red) — 10m + 20m + 10m",
    sources: { nir: "B08", swir: "B11", red: "B04" },
    composite: { r: "nir", g: "swir", b: "red" },
  },
  {
    title: "Agriculture (SWIR, NIR, Blue) — 20m + 10m + 10m",
    sources: { swir: "B11", nir: "B08", blue: "B02" },
    composite: { r: "swir", g: "nir", b: "blue" },
  },
  {
    title: "Geology (SWIR2, SWIR1, Blue) — 20m + 20m + 10m",
    sources: { swir2: "B12", swir1: "B11", blue: "B02" },
    composite: { r: "swir2", g: "swir1", b: "blue" },
  },
  {
    title: "Healthy Vegetation (NIR, SWIR, Blue) — 10m + 20m + 10m",
    sources: { nir: "B08", swir: "B11", blue: "B02" },
    composite: { r: "nir", g: "swir", b: "blue" },
  },
  {
    title: "Burned Area (SWIR2, SWIR1, NIR) — 20m + 20m + 10m",
    sources: { swir2: "B12", swir1: "B11", nir: "B08" },
    composite: { r: "swir2", g: "swir1", b: "nir" },
  },
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const centeredSceneRef = useRef<number | null>(null);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [presetIndex, setPresetIndex] = useState(0);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [debugLevel, setDebugLevel] = useState<1 | 2 | 3>(1);
  const [panelOpen, setPanelOpen] = useState(true);

  const scene = SCENES[sceneIndex];
  const preset = PRESETS[presetIndex];

  const sources = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(preset.sources).map(([slot, band]) => [
          slot,
          { url: `${scene.baseUrl}/${band}.tif` },
        ]),
      ),
    [scene, preset],
  );

  const layer = new MultiCOGLayer({
    id: `sentinel-2-multi-${sceneIndex}`,
    sources,
    composite: preset.composite,
    debug,
    debugOpacity,
    debugLevel,
    renderPipeline: [
      { module: FilterNoDataVal, props: { noDataValue: 0 } },
      { module: LinearRescale, props: { rescaleMin: 0, rescaleMax: 0.05 } },
    ],
    onGeoTIFFLoad: (_sources, { geographicBounds }) => {
      // Only fly to the scene on the initial load, not on subsequent band changes
      if (centeredSceneRef.current === sceneIndex) {
        return;
      }
      centeredSceneRef.current = sceneIndex;

      const { west, south, east, north } = geographicBounds;
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
        initialViewState={{ longitude: 0, latitude: 0, zoom: 1 }}
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
            width: "350px",
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
            Sentinel-2 Multi-Band
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
                  color: "#666",
                }}
              >
                These images are loaded directly from the{" "}
                <a
                  href="https://registry.opendata.aws/sentinel-2-l2a-cogs/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Sentinel-2 AWS Open Data bucket
                </a>{" "}
                — no server involved. Separate{" "}
                <a
                  href="https://gisgeography.com/sentinel-2-bands-combinations/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  bands
                </a>{" "}
                are rendered as true-color or false-color composites, where the{" "}
                <a
                  href="https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <code>MultiCOGLayer</code>
                </a>{" "}
                automatically handles GPU-based cross-resolution resampling.
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
              <label
                style={{ fontSize: "12px", color: "#666", display: "block" }}
              >
                Scene
                <select
                  value={sceneIndex}
                  onChange={(e) => setSceneIndex(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "4px",
                    cursor: "pointer",
                    marginTop: "2px",
                  }}
                >
                  {SCENES.map((s, i) => (
                    <option key={s.baseUrl} value={i}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  fontSize: "12px",
                  color: "#666",
                  display: "block",
                  marginTop: "8px",
                }}
              >
                Composite
                <select
                  value={presetIndex}
                  onChange={(e) => setPresetIndex(Number(e.target.value))}
                  style={{
                    width: "100%",
                    padding: "4px",
                    cursor: "pointer",
                    marginTop: "2px",
                  }}
                >
                  {PRESETS.map((p, i) => (
                    <option key={p.title} value={i}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: "8px" }}>
                <label style={{ fontSize: "13px", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={debug}
                    onChange={(e) => setDebug(e.target.checked)}
                    style={{ marginRight: "6px" }}
                  />
                  Debug overlay
                </label>
              </div>
              {debug && (
                <>
                  <div style={{ marginTop: "4px" }}>
                    <label style={{ fontSize: "12px", color: "#666" }}>
                      Detail level:{" "}
                      <select
                        value={debugLevel}
                        onChange={(e) =>
                          setDebugLevel(Number(e.target.value) as 1 | 2 | 3)
                        }
                        style={{ padding: "2px", cursor: "pointer" }}
                      >
                        <option value={1}>1 — Compact</option>
                        <option value={2}>2 — Detailed</option>
                        <option value={3}>3 — Verbose</option>
                      </select>
                    </label>
                  </div>
                  <div style={{ marginTop: "4px" }}>
                    <label
                      style={{
                        fontSize: "12px",
                        color: "#666",
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
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
