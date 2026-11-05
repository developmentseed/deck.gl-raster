import { LoadingWidget } from "@deck.gl/widgets";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { ZarrLayer, ZarrSource } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import {
  DeckGlOverlay,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
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
} from "./ecmwf/metadata.js";
import { makeRenderTile } from "./ecmwf/render-tile.js";
import { buildSelection } from "./ecmwf/selection.js";
import { ControlPanel } from "./ui/control-panel.js";

// Fetched straight from the source.coop S3 bucket, which allows CORS, via the
// path-style S3 endpoint. Path-style is required because the bucket name
// contains dots, which break the TLS wildcard cert used by virtual-hosted-style
// URLs.
//
// Each chunk of this store holds 61 lead times for 60° x 60°, so the whole
// globe is 18 requests.
const ZARR_URL =
  "https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/dynamical/ecmwf-aifs-single-forecast/v0.1.0.zarr";

const VARIABLE = "temperature_2m";
const INITIAL_RESCALE_MIN = -40; // °C
const INITIAL_RESCALE_MAX = 50; // °C
const INITIAL_FRAME_DURATION_MS = 200;

export default function App() {
  const [leadTimeIdx, setLeadTimeIdx] = useState(0);
  const [initTimeIdx, setInitTimeIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [source, setSource] = useState<ZarrSource<"float32"> | null>(null);
  // Number of init_time values in the dataset (= first dim of the array),
  // known once the zarr array is opened.
  const initTimeCount = source ? source.arrays[0]!.shape[0]! : 0;
  const [colormapId, setColormapId] = useState<ColormapId>(DEFAULT_COLORMAP_ID);
  const [rescaleMin, setRescaleMin] = useState(INITIAL_RESCALE_MIN);
  const [rescaleMax, setRescaleMax] = useState(INITIAL_RESCALE_MAX);
  // Filter range - independent of rescale. Starts wide open so nothing is
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
      const source = await ZarrSource.open(opened, {
        geoZarrMetadata: ECMWF_GEOZARR_ATTRS,
      });
      if (cancelled) {
        return;
      }
      setSource(source);
      // Default to the latest available forecast run.
      setInitTimeIdx(opened.shape[0]! - 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Animation loop: advance leadTimeIdx every `frameDurationMs`. Uses
  // requestAnimationFrame so it auto-pauses when the tab is hidden.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last >= frameDurationMs) {
        setLeadTimeIdx((i) => (i + 1) % ECMWF_LEAD_TIME_COUNT);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, frameDurationMs]);

  const selection = useMemo(
    () => buildSelection({ initTimeIdx }),
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
    source && colormapTexture
      ? [
          new ZarrLayer<EcmwfTileData, "float32">({
            id: "ecmwf-zarr-layer",
            source,
            selection,
            getTileData,
            renderTile,
            onTileUnload: (tile) => tile.content?.texture.destroy(),
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
            // On a globe the raster mesh is coplanar with MapLibre's basemap
            // sphere and they share the interleaved depth buffer, which
            // z-fights. A depth bias does not help with maplibre's globe depth
            // encoding; instead skip the depth comparison. The far hemisphere
            // is still hidden because the GlobeView created by the overlay
            // culls back faces by default (deck.gl >= 9.4).
            // See visgl/deck.gl#9592.
            parameters: { depthCompare: "always" },
            // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
            // doesn't know about it.
            beforeId: "boundary_country_outline",
          }),
        ]
      : [];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        // Space around the globe; MapLibre leaves it transparent.
        background: "#000",
      }}
    >
      <MaplibreMap
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.5 }}
        projection="globe"
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={layers}
          widgets={[new LoadingWidget(loadingWidgetProps)]}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
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
  );
}
