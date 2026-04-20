import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import * as zarr from "zarrita";
import type { AnomalyTileData } from "./anomaly/get-tile-data.js";
import { getTileData } from "./anomaly/get-tile-data.js";
import {
  ANOMALY_GEOZARR_ATTRS,
  DATE_COUNT,
  VARIABLES,
  type VariableKey,
} from "./anomaly/metadata.js";
import { makeRenderTile } from "./anomaly/render-tile.js";
import { buildSelection } from "./anomaly/selection.js";
import { createAnomalyColormapTexture } from "./gpu/colormap.js";
import { ControlPanel } from "./ui/control-panel.js";

// Served locally via vite proxy → python -m http.server 8080 in weather-extremes/data/
// zarrita requires an absolute URL.
const ZARR_URL = `${window.location.origin}/anomaly.zarr`;

const FRAME_DURATION_MS = 400;

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [dateIdx, setDateIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [variable, setVariable] = useState<VariableKey>(VARIABLES[0].value);
  const [arrays, setArrays] = useState<Record<VariableKey, zarr.Array<"float32", zarr.Readable>> | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const colormapRef = useRef<Texture | null>(null);

  // Derive current array and rescale range from selected variable.
  const arr = arrays?.[variable] ?? null;
  const varConfig = VARIABLES.find((v) => v.value === variable)!;
  const { rescaleMin, rescaleMax } = varConfig;

  // Open all variable arrays and read valid_date coordinate in one pass.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await zarr.withConsolidatedMetadata(
        new zarr.FetchStore(ZARR_URL),
        { format: "v3" },
      );
      const root = await zarr.open.v3(store, { kind: "group" });

      // Open all variable arrays in parallel.
      const entries = await Promise.all(
        VARIABLES.map(async ({ value }) => [
          value,
          await zarr.open.v3(root.resolve(value), { kind: "array" }),
        ]),
      );

      // Read valid_date coordinate (int64 nanoseconds since Unix epoch).
      const dateCoord = await zarr.open.v3(root.resolve("valid_date"), { kind: "array" });
      const dateResult = await zarr.get(dateCoord, [null]);
      const parsedDates = Array.from(dateResult.data as BigInt64Array).map((ns) =>
        new Date(Number(ns) / 1_000_000).toISOString().slice(0, 10),
      );

      if (cancelled) return;
      setArrays(Object.fromEntries(entries) as Record<VariableKey, zarr.Array<"float32", zarr.Readable>>);
      setDates(parsedDates);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation loop.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last >= FRAME_DURATION_MS) {
        setDateIdx((i) => (i + 1) % DATE_COUNT);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const selection = useMemo(() => buildSelection(), []);

  const getTileDataWithColormap = useCallback(
    async (
      openedArr: zarr.Array<zarr.DataType, zarr.Readable>,
      options: GetTileDataOptions,
    ) => {
      if (!colormapRef.current) {
        colormapRef.current = createAnomalyColormapTexture(options.device);
      }
      return getTileData(openedArr, options);
    },
    [],
  );

  const renderTile = useCallback(
    (data: AnomalyTileData) => {
      const colormapTexture = colormapRef.current;
      if (!colormapTexture) return { renderPipeline: [] };
      return makeRenderTile({
        dateIdx,
        colormapTexture,
        rescaleMin,
        rescaleMax,
      })(data);
    },
    [dateIdx, rescaleMin, rescaleMax],
  );

  const layers = arr
    ? [
        new ZarrLayer<zarr.Readable, "float32", AnomalyTileData>({
          id: "temp-anomaly-layer",
          source: arr,
          metadata: ANOMALY_GEOZARR_ATTRS,
          selection,
          getTileData: getTileDataWithColormap,
          renderTile,
          updateTriggers: {
            renderTile: [dateIdx, rescaleMin, rescaleMax],
          },
          // @ts-expect-error beforeId is injected by @deck.gl/mapbox
          beforeId: "boundary_country_outline",
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2 }}
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
        <ControlPanel
          dateIdx={dateIdx}
          dates={dates}
          variable={variable}
          isPlaying={isPlaying}
          onDateIdxChange={setDateIdx}
          onVariableChange={setVariable}
          onPlayPauseToggle={() => setIsPlaying((p) => !p)}
        />
      </div>
    </div>
  );
}
