import { MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  FilterNoDataVal,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import { DeckGlOverlay } from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, Popup } from "react-map-gl/maplibre";
import { COMPOSITE_PRESETS } from "./composites.js";
import { ControlPanel } from "./control-panel.js";
import type { DisasterEvent } from "./events.js";
import { DEFAULT_EVENT } from "./events.js";
import type { Inspection } from "./inspect.js";
import { inspectPoint } from "./inspect.js";
import type { Collection, Scene } from "./stac.js";
import { searchScenes } from "./stac.js";

/** Milliseconds each frame dwells during playback. */
const FRAME_DURATION_MS = 1000;

export default function App() {
  const mapRef = useRef<MapRef>(null);

  // --- Search form state (initialized from the default preset event) ---
  const [collection, setCollection] = useState<Collection>(DEFAULT_EVENT.collection);
  const [startDate, setStartDate] = useState(DEFAULT_EVENT.startDate);
  const [endDate, setEndDate] = useState(DEFAULT_EVENT.endDate);
  const [cloudCoverMax, setCloudCoverMax] = useState(DEFAULT_EVENT.cloudCoverMax);
  const [presetId, setPresetId] = useState(DEFAULT_EVENT.presetId);

  // --- Search results + playback state ---
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [timeIdx, setTimeIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the selected scene's COGs fail to open (CORS, 404, bad projection);
  // otherwise a failed load just leaves the map blank. Reset per scene/preset.
  const [layerError, setLayerError] = useState<string | null>(null);

  // --- Point inspector: classify the pixel under a click via spectral indices ---
  const [pin, setPin] = useState<{ longitude: number; latitude: number } | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);

  const preset = useMemo(
    () => COMPOSITE_PRESETS.find((p) => p.id === presetId) ?? COMPOSITE_PRESETS[0],
    [presetId],
  );

  // Cancel an in-flight search if a newer one starts (or the component unmounts).
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Run a STAC search over the map's *current* visible bounds. Search filters
   * (collection/dates/cloud) come from form state unless `overrides` are passed
   * (used by presets, whose values may not be in state yet on the same tick).
   */
  const doSearch = useCallback(
    async (overrides?: {
      collection: Collection;
      startDate: string;
      endDate: string;
      cloudCoverMax: number;
    }) => {
      const map = mapRef.current?.getMap();
      if (!map) {
        return;
      }
      const b = map.getBounds();
      const bbox: [number, number, number, number] = [
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ];

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setIsPlaying(false);
      try {
        const found = await searchScenes(
          {
            bbox,
            collection: overrides?.collection ?? collection,
            startDate: overrides?.startDate ?? startDate,
            endDate: overrides?.endDate ?? endDate,
            cloudCoverMax: overrides?.cloudCoverMax ?? cloudCoverMax,
          },
          controller.signal,
        );
        setScenes(found);
        setTimeIdx(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
        setError((err as Error).message);
        setScenes([]);
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [collection, startDate, endDate, cloudCoverMax],
  );

  /** Apply a preset: sync the form, fly the map, then search once it settles. */
  const applyEvent = useCallback(
    (event: DisasterEvent) => {
      setCollection(event.collection);
      setStartDate(event.startDate);
      setEndDate(event.endDate);
      setCloudCoverMax(event.cloudCoverMax);
      setPresetId(event.presetId);

      const map = mapRef.current?.getMap();
      if (!map) {
        return;
      }
      // flyTo emits a single `moveend` when the animation finishes; search then,
      // so the bbox reflects the event's region rather than the old view.
      map.once("moveend", () => {
        doSearch({
          collection: event.collection,
          startDate: event.startDate,
          endDate: event.endDate,
          cloudCoverMax: event.cloudCoverMax,
        });
      });
      map.flyTo({
        center: [event.center.longitude, event.center.latitude],
        zoom: event.center.zoom,
        duration: 1500,
      });
    },
    [doSearch],
  );

  /** Fly to a typed lat/lon ("zoom to location"); the user then hits Search. */
  const zoomToLocation = useCallback((longitude: number, latitude: number) => {
    mapRef.current
      ?.getMap()
      .flyTo({ center: [longitude, latitude], zoom: 9, duration: 1200 });
  }, []);

  // The click handler reads the *current* scene without resubscribing each
  // time playback advances the index, so mirror it into a ref.
  const sceneRef = useRef<Scene | undefined>(undefined);

  const inspectAt = useCallback((lng: number, lat: number) => {
    const activeScene = sceneRef.current;
    inspectAbortRef.current?.abort();
    const controller = new AbortController();
    inspectAbortRef.current = controller;

    if (!activeScene) return;
    setInspection(null);
    setInspectError(null);
    setInspectLoading(true);
    inspectPoint(activeScene, lng, lat, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setInspection(result);
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError" && !controller.signal.aborted) {
          setInspectError(err.message);
        }
      })
      .finally(() => {
        if (inspectAbortRef.current === controller) {
          setInspectLoading(false);
        }
      });
  }, []);
  /**
   * Inspect the pixel under a click: read its raw band values from this scene's
   * COGs and classify it (water / vegetation / burn-like / bare). Drops a pin
   * and opens a popup; a newer click aborts the previous in-flight read.
   */
  const handleMapClick = useCallback((event: MapLayerMouseEvent) => {
    const activeScene = sceneRef.current;
    if (!activeScene) {
      return;
    }
    const { lng, lat } = event.lngLat;
    setPin({ longitude: lng, latitude: lat });
    inspectAt(lng, lat);
  }, []);

  // Kick off the default search once the map has loaded. The map already starts
  // at the default event's center (initialViewState), so we search the current
  // bounds directly rather than via applyEvent's flyTo — a no-op flyTo to the
  // same position may not emit `moveend`, which would skip the search.
  const handleMapLoad = useCallback(() => {
    doSearch();
  }, [doSearch]);

  // Abort any in-flight search or point inspection on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      inspectAbortRef.current?.abort();
    },
    [],
  );

  // Playback loop: advance timeIdx with wrap-around while playing. Uses
  // requestAnimationFrame so it auto-pauses when the tab is hidden. Reads the
  // current index from a ref so the effect doesn't resubscribe every tick.
  const timeIdxRef = useRef(timeIdx);
  useEffect(() => {
    timeIdxRef.current = timeIdx;
  }, [timeIdx]);
  useEffect(() => {
    if (!isPlaying || scenes.length === 0) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last >= FRAME_DURATION_MS) {
        setTimeIdx((i) => (i + 1) % scenes.length);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, scenes.length]);

  // Build the layer for the currently selected scene. Each composite preset
  // maps slot names -> Sentinel-2 bands; we resolve those to this scene's COG
  // URLs. MultiCOGLayer opens each band COG, reprojects from its UTM zone, and
  // composites the bands into RGB on the GPU.
  const scene = scenes[timeIdx];
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  const pinRef = useRef(pin);
  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);
  // Clear any prior load error and popup when the scene or composite changes; the new
  // layer reports its own failure (if any) via onGeoTIFFError.
  useEffect(() => {
    setLayerError(null);
    const p = pinRef.current;
    if (isPlaying) {
      setPin(null);
    } else if (p) {
      inspectAt(p.longitude, p.latitude);
    }
  }, [scene?.id, preset.id, isPlaying]);

  const layers = useMemo(() => {
    if (!scene) {
      return [];
    }
    const sources = Object.fromEntries(
      Object.entries(preset.sources).map(([slot, band]) => [
        slot,
        { url: scene.bandUrls[band] },
      ]),
    );
    return [
      new MultiCOGLayer({
        // Keyed by scene + preset: stepping time swaps the layer, which reloads
        // that date's COGs (V1 reloads on each step; see README for the
        // smoother prefetch approach).
        id: `s2-${scene.id}-${preset.id}`,
        sources,
        composite: preset.composite,
        // Sentinel-2 L2A stores 0 as no-data; rescale reflectance to a bright
        // display range (same tuning as the `sentinel-2` example).
        renderPipeline: [
          { module: FilterNoDataVal, props: { noDataValue: 0 } },
          { module: LinearRescale, props: { rescaleMin: 0, rescaleMax: 0.05 } },
        ],
        // Surface COG open failures (CORS, 404, projection) instead of a silent
        // blank map. The id changes per scene/preset, so each layer reports its
        // own load.
        onGeoTIFFError: (err) => setLayerError(err.message),
      }),
    ];
  }, [scene, preset]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: DEFAULT_EVENT.center.longitude,
          latitude: DEFAULT_EVENT.center.latitude,
          zoom: DEFAULT_EVENT.center.zoom,
        }}
        onLoad={handleMapLoad}
        onClick={handleMapClick}
        // Show the crosshair only when a scene is loaded and clicking will read.
        cursor={scene ? "crosshair" : "grab"}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay layers={layers} interleaved />
        {pin && (
          <Popup
            longitude={pin.longitude}
            latitude={pin.latitude}
            anchor="bottom"
            closeOnClick={false}
            onClose={() => setPin(null)}
            maxWidth="260px"
          >
            <InspectPopup
              loading={inspectLoading}
              error={inspectError}
              inspection={inspection}
            />
          </Popup>
        )}
      </MaplibreMap>

      <ControlPanel
        collection={collection}
        onCollectionChange={setCollection}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        cloudCoverMax={cloudCoverMax}
        onCloudCoverMaxChange={setCloudCoverMax}
        presetId={presetId}
        onPresetIdChange={setPresetId}
        onApplyEvent={applyEvent}
        onZoomToLocation={zoomToLocation}
        onSearch={() => doSearch()}
        loading={loading}
        error={error}
        layerError={layerError}
        scenes={scenes}
        timeIdx={timeIdx}
        onTimeIdxChange={setTimeIdx}
        isPlaying={isPlaying}
        onPlayPauseToggle={() => setIsPlaying((p) => !p)}
      />
    </div>
  );
}

/** Popup body for the point inspector: category + the indices behind it. */
function InspectPopup({
  loading,
  error,
  inspection,
}: {
  loading: boolean;
  error: string | null;
  inspection: Inspection | null;
}) {
  if (loading) {
    return <div style={{ color: "#111" }}>Reading pixel…</div>;
  }
  if (error) {
    return <div style={{ color: "#b5482a" }}>Couldn’t read pixel: {error}</div>;
  }
  if (!inspection) {
    return null;
  }
  const fmt = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  return (
    <div style={{ color: "#111", fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{inspection.category}</div>
      <div>NDWI (water): {fmt(inspection.ndwi)}</div>
      <div>NDVI (vegetation): {fmt(inspection.ndvi)}</div>
      <div>NBR (burn): {fmt(inspection.nbr)}</div>
    </div>
  );
}
