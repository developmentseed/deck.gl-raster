import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import * as zarr from "zarrita";
import type { ColormapId } from "./ecmwf/colormap-choices.js";
import {
  COLORMAP_CHOICES,
  DEFAULT_COLORMAP_ID,
} from "./ecmwf/colormap-choices.js";
import type { EcmwfTileData } from "./ecmwf/get-tile-data.js";
import { getTileData } from "./ecmwf/get-tile-data.js";
import {
  ECMWF_GEOZARR_ATTRS,
  ECMWF_LEAD_TIME_COUNT,
  ECMWF_LEAD_TIME_STEP_HOURS,
} from "./ecmwf/metadata.js";

/** Base step (hours) that `frameDurationMs` applies to. 3-hour steps dwell
 *  for `frameDurationMs`; 6-hour steps dwell for 2× that. */
const BASE_STEP_HOURS = 3;

import { makeRenderTile } from "./ecmwf/render-tile.js";
import { buildSelection } from "./ecmwf/selection.js";
import { ControlPanel } from "./ui/control-panel.js";

// Set to the actual ECMWF IFS ENS zarr store URL from Dynamical.org.
// Inspect the store's consolidated metadata to confirm init_time length
// before setting INIT_TIME_IDX below.
// Direct S3 link is faster than dynamical.org proxy
const ZARR_URL =
  "https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/dynamical/ecmwf-ifs-ens-forecast-15-day-0-25-degree/v0.1.0.zarr";

const VARIABLE = "temperature_2m";
const ENSEMBLE_MEMBER_IDX = 0; // control run
const INITIAL_RESCALE_MIN = -40; // °C
const INITIAL_RESCALE_MAX = 50; // °C
const INITIAL_FRAME_DURATION_MS = 100;

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [leadTimeIdx, setLeadTimeIdx] = useState(0);
  const [initTimeIdx, setInitTimeIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );
  // Number of init_time values in the dataset (= first dim of the array),
  // known once the zarr array is opened.
  const initTimeCount = arr ? arr.shape[0]! : 0;
  const [colormapId, setColormapId] = useState<ColormapId>(DEFAULT_COLORMAP_ID);
  const [rescaleMin, setRescaleMin] = useState(INITIAL_RESCALE_MIN);
  const [rescaleMax, setRescaleMax] = useState(INITIAL_RESCALE_MAX);
  // Filter range — independent of rescale. Starts wide open so nothing is
  // filtered until the user narrows it.
  const [filterMin, setFilterMin] = useState(INITIAL_RESCALE_MIN);
  const [filterMax, setFilterMax] = useState(INITIAL_RESCALE_MAX);
  const [frameDurationMs, setFrameDurationMs] = useState(
    INITIAL_FRAME_DURATION_MS,
  );
  const colormapChoice = useMemo(
    () =>
      COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0]!,
    [colormapId],
  );

  // Decode the shipped colormap sprite once at mount. This returns ImageData
  // and doesn't need a GPU device, so it can run in parallel with zarr
  // opening.
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await fetch(colormapsPngUrl);
      const bytes = await resp.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (cancelled) {
        return;
      }
      setColormapImage(image);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the colormap sprite once the luma.gl Device is available. The
  // Device arrives via the overlay's `onDeviceInitialized` callback; the
  // sprite was decoded asynchronously above.
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

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
      if (!opened.is("float32")) {
        throw new Error(
          `Expected ${VARIABLE} to be float32, got ${opened.dtype}`,
        );
      }
      if (cancelled) {
        return;
      }
      setArr(opened);
      // Default to the latest available forecast run.
      setInitTimeIdx(opened.shape[0]! - 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation loop: advance leadTimeIdx at a rate proportional to each
  // frame's lead-time step, so a 3 h step dwells for `frameDurationMs` and a
  // 6 h step dwells for 2× that. Keeps simulated-time pacing constant across
  // the 3 h → 6 h regime shift at t=144 h. Uses requestAnimationFrame so it
  // auto-pauses when the tab is hidden.
  //
  // Reads current leadTimeIdx from a ref so the loop doesn't need to resubscribe
  // on every tick.
  const leadTimeIdxRef = useRef(leadTimeIdx);
  useEffect(() => {
    leadTimeIdxRef.current = leadTimeIdx;
  }, [leadTimeIdx]);
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const curIdx = leadTimeIdxRef.current;
      const curStepHours =
        ECMWF_LEAD_TIME_STEP_HOURS[curIdx] ?? BASE_STEP_HOURS;
      const dwell = frameDurationMs * (curStepHours / BASE_STEP_HOURS);
      if (now - last >= dwell) {
        setLeadTimeIdx((i) => (i + 1) % ECMWF_LEAD_TIME_COUNT);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, frameDurationMs]);

  const selection = useMemo(
    () =>
      buildSelection({
        initTimeIdx,
        ensembleMemberIdx: ENSEMBLE_MEMBER_IDX,
      }),
    [initTimeIdx],
  );

  const renderTile = useCallback(
    (data: EcmwfTileData) => {
      if (!colormapTexture) {
        // Defensive: layer isn't constructed until colormapTexture is ready.
        return { renderPipeline: [] };
      }
      return makeRenderTile({
        layerIndex: leadTimeIdx,
        colormapTexture,
        colormapIndex: colormapChoice.colormapIndex,
        colormapReversed: colormapChoice.reversed,
        filterMin,
        filterMax,
        rescaleMin,
        rescaleMax,
      })(data);
    },
    [
      leadTimeIdx,
      colormapChoice,
      colormapTexture,
      filterMin,
      filterMax,
      rescaleMin,
      rescaleMax,
    ],
  );

  const layers =
    arr && colormapTexture
      ? [
          new ZarrLayer<zarr.Readable, "float32", EcmwfTileData>({
            // Include initTimeIdx in the id so switching init_time discards
            // cached tiles from the previous forecast run.
            id: `ecmwf-zarr-layer-${initTimeIdx}`,
            source: arr,
            metadata: ECMWF_GEOZARR_ATTRS,
            selection,
            getTileData,
            renderTile,
            updateTriggers: {
              renderTile: [
                leadTimeIdx,
                colormapId,
                rescaleMin,
                rescaleMax,
                filterMin,
                filterMax,
              ],
            },
            // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
            // doesn't know about it.
            beforeId: "boundary_country_outline",
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: 10, latitude: 45, zoom: 4.5 }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
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
          initTimeIdx={initTimeIdx}
          initTimeCount={initTimeCount}
          isPlaying={isPlaying}
          colormapId={colormapId}
          rescaleMin={rescaleMin}
          rescaleMax={rescaleMax}
          filterMin={filterMin}
          filterMax={filterMax}
          frameDurationMs={frameDurationMs}
          onInitTimeIdxChange={setInitTimeIdx}
          onLeadTimeIdxChange={setLeadTimeIdx}
          onPlayPauseToggle={() => setIsPlaying((p) => !p)}
          onColormapIdChange={setColormapId}
          onRescaleMinChange={setRescaleMin}
          onRescaleMaxChange={setRescaleMax}
          onFilterMinChange={setFilterMin}
          onFilterMaxChange={setFilterMax}
          onFrameDurationMsChange={setFrameDurationMs}
        />
      </div>
    </div>
  );
}
