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
import { ANOMALY_GEOZARR_ATTRS, DATE_COUNT } from "./anomaly/metadata.js";
import { makeRenderTile } from "./anomaly/render-tile.js";
import { buildSelection } from "./anomaly/selection.js";
import { createAnomalyColormapTexture } from "./gpu/colormap.js";
import { ControlPanel } from "./ui/control-panel.js";

// Served locally via vite proxy → python -m http.server 8080 in weather-extremes/data/
// zarrita requires an absolute URL.
const ZARR_URL = `${window.location.origin}/anomaly.zarr`;

// Which anomaly variable to display. Options:
//   temp_mean_anom, temp_min_anom, temp_max_anom  (°C, use RESCALE below)
//   temp_mean_std, temp_min_std, temp_max_std      (σ, set rescale to -3/3)
const VARIABLE = "temp_mean_anom";

// Rescale range: maps data values to [0, 1] for the colormap.
// ±10 °C captures most anomalies; white (centre) = 0 = no anomaly.
const RESCALE_MIN = -10;
const RESCALE_MAX = 10;

const FRAME_DURATION_MS = 400;

// Derive display dates from today. The daily pipeline always produces
// today + 7 days, so this matches the zarr without needing to read coordinates.
const DATES: string[] = Array.from({ length: DATE_COUNT }, (_, i) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [dateIdx, setDateIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );
  const colormapRef = useRef<Texture | null>(null);

  // Open the zarr v2 store and variable array.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await zarr.withConsolidatedMetadata(
        new zarr.FetchStore(ZARR_URL),
        { format: "v3" },
      );
      const root = await zarr.open.v3(store, { kind: "group" });
      const opened = await zarr.open.v3(root.resolve(VARIABLE), { kind: "array" });
      if (cancelled) return;
      setArr(opened as zarr.Array<"float32", zarr.Readable>);
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
        rescaleMin: RESCALE_MIN,
        rescaleMax: RESCALE_MAX,
      })(data);
    },
    [dateIdx],
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
            renderTile: [dateIdx],
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
          dates={DATES}
          isPlaying={isPlaying}
          onDateIdxChange={setDateIdx}
          onPlayPauseToggle={() => setIsPlaying((p) => !p)}
        />
      </div>
    </div>
  );
}
