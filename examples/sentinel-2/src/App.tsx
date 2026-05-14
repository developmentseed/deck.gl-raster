import { Code, NativeSelect, Text } from "@chakra-ui/react";
import { MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
  Field,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

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
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
    debugLevel: 1,
  });

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
    debug: debugState.debug,
    debugOpacity: debugState.debugOpacity,
    debugLevel: debugState.debugLevel,
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
        <DeckGlOverlay layers={[layer]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="Sentinel-2 Multi-Band"
        sourcePath="examples/sentinel-2"
      >
        <Text mb="3" color="gray.600">
          These images are loaded directly from the{" "}
          <ExternalLink href="https://registry.opendata.aws/sentinel-2-l2a-cogs/">
            Sentinel-2 AWS Open Data bucket
          </ExternalLink>{" "}
          — no server involved. Separate{" "}
          <ExternalLink href="https://gisgeography.com/sentinel-2-bands-combinations/">
            bands
          </ExternalLink>{" "}
          are rendered as true-color or false-color composites, where the{" "}
          <ExternalLink href="https://developmentseed.org/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/">
            <Code>MultiCOGLayer</Code>
          </ExternalLink>{" "}
          automatically handles GPU-based cross-resolution resampling.
        </Text>
        <Field label="Scene">
          <NativeSelect.Root>
            <NativeSelect.Field
              value={sceneIndex}
              onChange={(e) => setSceneIndex(Number(e.target.value))}
            >
              {SCENES.map((s, i) => (
                <option key={s.baseUrl} value={i}>
                  {s.title}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>
        <Field label="Composite">
          <NativeSelect.Root>
            <NativeSelect.Field
              value={presetIndex}
              onChange={(e) => setPresetIndex(Number(e.target.value))}
            >
              {PRESETS.map((p, i) => (
                <option key={p.title} value={i}>
                  {p.title}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>
        <DebugControls value={debugState} onChange={setDebugState} />
      </ControlPanel>
    </div>
  );
}
