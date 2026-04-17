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
import type { EcmwfTileData } from "./ecmwf/get-tile-data.js";
import { getTileData } from "./ecmwf/get-tile-data.js";
import {
  ECMWF_GEOZARR_ATTRS,
  ECMWF_LEAD_TIME_COUNT,
} from "./ecmwf/metadata.js";
import { makeRenderTile } from "./ecmwf/render-tile.js";
import { buildSelection } from "./ecmwf/selection.js";
import { createTemperatureColormapTexture } from "./gpu/colormap.js";
import { ControlPanel } from "./ui/control-panel.js";

// Set to the actual ECMWF IFS ENS zarr store URL from Dynamical.org.
// Inspect the store's consolidated metadata to confirm init_time length
// before setting INIT_TIME_IDX below.
const ZARR_URL =
  "https://data.dynamical.org/ecmwf/ifs-ens/forecast-15-day-0-25-degree/latest.zarr";
const VARIABLE = "temperature_2m";
const INIT_TIME_IDX = 746; // most recent (adjust for actual dataset length)
const ENSEMBLE_MEMBER_IDX = 0; // control run
const RESCALE_MIN = -40; // °C
const RESCALE_MAX = 50; // °C
const FRAME_DURATION_MS = 200;

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [leadTimeIdx, setLeadTimeIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );

  // The colormap texture is created lazily on the first tile load (when a
  // luma.gl Device first becomes available via options.device). We store it
  // in a ref, not state, because the first renderTile call for the first
  // tile happens synchronously after its getTileData resolves, and deck.gl
  // guarantees getTileData → renderTile ordering for a given tile. No React
  // re-render needed between the two.
  const colormapRef = useRef<Texture | null>(null);

  // Open the Zarr store + variable once. The Dynamical.org ECMWF store uses
  // Zarr v3 with consolidated metadata (the full hierarchy is inlined in the
  // root `zarr.json`). Both are forced explicitly so auto-detection doesn't
  // silently fall back to v2.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await zarr.withConsolidatedMetadata(
        new zarr.FetchStore(ZARR_URL),
        { format: "v3" },
      );
      const root = await zarr.open.v3(store, { kind: "group" });
      const opened = await zarr.open.v3(root.resolve(VARIABLE), {
        kind: "array",
      });
      if (cancelled) return;
      setArr(opened as zarr.Array<"float32", zarr.Readable>);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation loop: advance leadTimeIdx every FRAME_DURATION_MS while playing.
  // Uses requestAnimationFrame so it auto-pauses when the tab is hidden.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last >= FRAME_DURATION_MS) {
        setLeadTimeIdx((i) => (i + 1) % ECMWF_LEAD_TIME_COUNT);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  const selection = useMemo(
    () =>
      buildSelection({
        initTimeIdx: INIT_TIME_IDX,
        ensembleMemberIdx: ENSEMBLE_MEMBER_IDX,
      }),
    [],
  );

  // getTileData wrapper: lazily creates the shared colormap texture on the
  // first tile load (options.device is the luma.gl Device owned by deck.gl).
  const getTileDataWithColormap = useCallback(
    async (
      openedArr: zarr.Array<zarr.DataType, zarr.Readable>,
      options: GetTileDataOptions,
    ) => {
      if (!colormapRef.current) {
        colormapRef.current = createTemperatureColormapTexture(options.device);
      }
      return getTileData(openedArr, options);
    },
    [],
  );

  // renderTile reads colormap from the ref. Safe because deck.gl always runs
  // getTileData before renderTile for the same tile, so the ref is populated
  // by the time this fires on real data.
  const renderTile = useCallback(
    (data: EcmwfTileData) => {
      const colormapTexture = colormapRef.current;
      if (!colormapTexture) {
        // Defensive: shouldn't occur per the ordering guarantee above.
        return { renderPipeline: [] };
      }
      return makeRenderTile({
        layerIndex: leadTimeIdx,
        colormapTexture,
        rescaleMin: RESCALE_MIN,
        rescaleMax: RESCALE_MAX,
      })(data);
    },
    [leadTimeIdx],
  );

  const layers = arr
    ? [
        new ZarrLayer<zarr.Readable, "float32", EcmwfTileData>({
          id: "ecmwf-zarr-layer",
          source: arr,
          metadata: ECMWF_GEOZARR_ATTRS,
          selection,
          getTileData: getTileDataWithColormap,
          renderTile,
          updateTriggers: {
            renderTile: [leadTimeIdx],
          },
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.5 }}
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
          leadTimeIdx={leadTimeIdx}
          isPlaying={isPlaying}
          onLeadTimeIdxChange={setLeadTimeIdx}
          onPlayPauseToggle={() => setIsPlaying((p) => !p)}
        />
      </div>
    </div>
  );
}
