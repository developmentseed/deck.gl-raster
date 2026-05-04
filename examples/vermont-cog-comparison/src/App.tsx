import { WebMercatorViewport } from "@deck.gl/core";
import { ClipExtension } from "@deck.gl/extensions";
import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef, ViewState } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { epsgResolver } from "./proj.js";
import {
  renderFalseColor,
  renderGrayscale,
  renderNDVI,
  renderRGB,
} from "./render-pipelines.js";
import { SwipeHandle } from "./swipe-handle.js";
import type { TileTextureData } from "./tile-loaders.js";
import { getTileDataGray, getTileDataRGBA } from "./tile-loaders.js";
import type { BandCount, VTFile, VTFileId } from "./vt-imagery.js";
import {
  DEFAULT_LEFT_ID,
  DEFAULT_RIGHT_ID,
  getVTFile,
  VT_FILES,
} from "./vt-imagery.js";

type Side = "left" | "right";

/** Render mode union; valid choices per side depend on the source band count. */
type RenderMode = "trueColor" | "falseColor" | "ndvi" | "grayscale";

/** Fixed colormap for NDVI; spec says no per-side colormap selector. */
const NDVI_COLORMAP_INDEX = COLORMAP_INDEX.cfastie;

/** Half the equatorial circumference of Earth in EPSG:3857 mercator meters. */
const MERCATOR_HALF_EQUATOR = 20037508.342789244;

/** CARTO dark style; first label layer is `waterway_label` so we anchor the COG just below it. */
const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const COG_BEFORE_ID = "waterway_label";

const INITIAL_VIEW_STATE = {
  longitude: -73.218,
  latitude: 44.476,
  zoom: 13,
  pitch: 0,
  bearing: 0,
};

type SideState = {
  fileId: VTFileId;
  renderMode: RenderMode;
};

/** Render modes that are valid for a given source band count, in dropdown order. */
function validRenderModes(bands: BandCount): RenderMode[] {
  if (bands === 1) {
    return ["grayscale"];
  }
  if (bands === 3) {
    return ["trueColor"];
  }
  return ["trueColor", "falseColor", "ndvi"];
}

const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  trueColor: "True Color",
  falseColor: "False Color IR",
  ndvi: "NDVI",
  grayscale: "Grayscale",
};

/**
 * Convert the swipe handle's screen-space x position to a Web Mercator x
 * coordinate in **meters** (EPSG:3857), the coordinate space `COGLayer`'s
 * sub-tile geometry is rendered in. `ClipExtension`'s `clipBounds` are
 * interpreted in the layer's pre-modelMatrix coordinate space, which for
 * COGLayer is mercator meters.
 */
function splitMercatorMeterX(
  viewport: WebMercatorViewport,
  splitFraction: number,
): number {
  const splitPx = viewport.width * splitFraction;
  const [splitLng] = viewport.unproject([splitPx, 0]);
  return (splitLng * MERCATOR_HALF_EQUATOR) / 180;
}

type CogLayerArgs = {
  side: Side;
  file: VTFile;
  geotiff: GeoTIFF;
  renderMode: RenderMode;
  clipBounds: [number, number, number, number];
  colormapTexture: Texture | null;
};

/**
 * Build the per-side COGLayer. Returns null when NDVI is selected but the
 * colormap texture has not yet been uploaded — caller skips rendering rather
 * than queuing a broken layer.
 */
function makeCOGLayer(args: CogLayerArgs): COGLayer<TileTextureData> | null {
  const { side, file, geotiff, renderMode, clipBounds, colormapTexture } = args;
  const useGrayLoader = file.bands === 1;

  let renderTile: (tileData: TileTextureData) => RenderTileResult;
  if (renderMode === "grayscale") {
    renderTile = renderGrayscale;
  } else if (renderMode === "trueColor") {
    renderTile = renderRGB;
  } else if (renderMode === "falseColor") {
    renderTile = renderFalseColor;
  } else {
    if (!colormapTexture) {
      return null;
    }
    renderTile = (tileData) =>
      renderNDVI(tileData, {
        colormapTexture,
        colormapIndex: NDVI_COLORMAP_INDEX,
      });
  }

  return new COGLayer<TileTextureData>({
    id: `cog-${side}`,
    geotiff,
    epsgResolver,
    getTileData: useGrayLoader ? getTileDataGray : getTileDataRGBA,
    renderTile,
    extensions: [new ClipExtension()],
    // @ts-expect-error clipBounds + clipByInstance + beforeId are injected
    // by ClipExtension and @deck.gl/mapbox; LayerProps doesn't know about
    // extension- or interleaved-injected props.
    clipBounds,
    // Force per-pixel clipping. ClipExtension's auto-detect sees
    // `instancePositions` on the underlying SimpleMeshLayer and defaults
    // to vertex-shader mode — which interpolates a 0/1 visibility flag
    // across each triangle and cuts at the 0.5-isoline, producing chunky
    // edges. Per-pixel mode samples the fragment's common position directly.
    clipByInstance: false,
    // Insert just below the basemap's first label layer so place names and
    // road labels render on top of the imagery.
    beforeId: COG_BEFORE_ID,
  });
}

/** Width of the inline "LEFT"/"RIGHT" caption column, in px. */
const SIDE_LABEL_WIDTH = 44;

/**
 * Year + (optional) render-mode controls for one side, laid out as
 * inline rows: a small uppercase side caption on the left, the dropdown
 * filling the remaining width.
 */
function SideControls(props: {
  side: Side;
  state: SideState;
  onChange: (next: SideState) => void;
}) {
  const { side, state, onChange } = props;
  const file = getVTFile(state.fileId);
  const modes = validRenderModes(file.bands);

  const sideLabelStyle: CSSProperties = {
    width: SIDE_LABEL_WIDTH,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 700,
    color: "#444",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
        }}
      >
        <span style={sideLabelStyle}>{side}</span>
        <select
          aria-label={`${side} year`}
          value={state.fileId}
          onChange={(e) => {
            const nextId = e.target.value as VTFileId;
            const nextBands = getVTFile(nextId).bands;
            const nextModes = validRenderModes(nextBands);
            const nextMode = nextModes.includes(state.renderMode)
              ? state.renderMode
              : nextModes[0];
            onChange({ fileId: nextId, renderMode: nextMode });
          }}
          style={{ flex: 1, padding: 4, minWidth: 0 }}
        >
          <optgroup label="Statewide composites">
            {VT_FILES.filter((f) => f.category === "statewide").map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Single-year imagery (does not span the full state)">
            {VT_FILES.filter((f) => f.category === "yearly").map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {modes.length > 1 ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
          }}
        >
          <span style={{ width: SIDE_LABEL_WIDTH, flexShrink: 0 }} />
          <select
            aria-label={`${side} render mode`}
            value={state.renderMode}
            onChange={(e) =>
              onChange({ ...state, renderMode: e.target.value as RenderMode })
            }
            style={{ flex: 1, padding: 4, minWidth: 0 }}
          >
            {modes.map((m) => (
              <option key={m} value={m}>
                {RENDER_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {file.category === "yearly" ? (
        <p
          style={{
            margin: `4px 0 0 ${SIDE_LABEL_WIDTH + 6}px`,
            fontSize: 11,
            color: "#777",
            fontStyle: "italic",
          }}
        >
          Single-year images may not have full statewide coverage.
        </p>
      ) : null}
    </>
  );
}

/**
 * Header subtitle: one-line attribution sitting under the panel title with
 * the link to the source bucket inline.
 */
function HeaderSubtitle() {
  return (
    <p
      style={{
        margin: "6px 0 0 0",
        fontSize: 12,
        color: "#666",
        lineHeight: 1.4,
      }}
    >
      From the{" "}
      <a
        href="https://registry.opendata.aws/vt-opendata/"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#555" }}
      >
        Vermont Open Geospatial bucket on AWS ↗
      </a>
      .
    </p>
  );
}

/**
 * Single floating panel anchored to the top-left corner. Always shown,
 * regardless of viewport — keeps the layout consistent and avoids the
 * per-side panels overlapping each other on narrow viewports.
 */
function ComparePanel(props: {
  left: SideState;
  right: SideState;
  onLeftChange: (s: SideState) => void;
  onRightChange: (s: SideState) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        width: 320,
        maxWidth: "calc(100vw - 24px)",
        background: "white",
        padding: 12,
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        pointerEvents: "auto",
        zIndex: 10,
        fontSize: 13,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle compare panel"
        style={{
          all: "unset",
          width: "100%",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>Vermont Aerial Imagery</span>
        <span
          style={{
            fontSize: 11,
            transition: "transform 0.2s",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        >
          ▼
        </span>
      </button>
      {open ? (
        <>
          <HeaderSubtitle />
          <SideControls
            side="left"
            state={props.left}
            onChange={props.onLeftChange}
          />
          <SideControls
            side="right"
            state={props.right}
            onChange={props.onRightChange}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Wrap MapboxOverlay in a react-map-gl control. `interleaved` mixes deck.gl
 * layers into the maplibre layer stack so vector labels can render above the
 * COG via `beforeId`.
 */
function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const [viewState, setViewState] = useState<ViewState>({
    ...INITIAL_VIEW_STATE,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const [splitFraction, setSplitFraction] = useState(0.5);
  const [left, setLeft] = useState<SideState>({
    fileId: DEFAULT_LEFT_ID,
    renderMode: "grayscale",
  });
  const [right, setRight] = useState<SideState>({
    fileId: DEFAULT_RIGHT_ID,
    renderMode: "trueColor",
  });
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  // Cache one GeoTIFF instance per URL across renders. Constructing a fresh
  // GeoTIFF.fromUrl walks the IFD chain over many small range requests; for
  // multi-hundred-GB Vermont files that adds up fast. Caching means once a
  // year is loaded, switching the dropdown back to it is instant.
  //
  // GeoTIFFs are stored in React state (not a ref) so the layers `useMemo`
  // naturally re-runs when a new file finishes loading. `inFlightRef` tracks
  // URLs currently being fetched so we don't kick off duplicate requests
  // between the resolve and the state update on the next render.
  const [geotiffs, setGeotiffs] = useState<Map<string, GeoTIFF>>(
    () => new Map(),
  );
  const inFlightRef = useRef<Set<string>>(new Set());

  const ensureGeoTIFF = useCallback(
    (file: VTFile): GeoTIFF | null => {
      const { url } = file;
      const existing = geotiffs.get(url);
      if (existing) {
        return existing;
      }
      if (inFlightRef.current.has(url)) {
        return null;
      }
      inFlightRef.current.add(url);
      void (async () => {
        try {
          // Pad each tunable to (the file's known header size) OR a
          // generic 16 MB default for files that haven't been measured.
          // Vermont COGs scale wildly (3-band 30 cm = 60 MB header,
          // 1-band yearly = ~3 MB), so a per-file value is a big win.
          // - prefetch sizes the initial Tiff read,
          // - chunkSize >= prefetch so the read fits in one source chunk
          //   (otherwise SourceChunk splits it into chunkSize-aligned pieces).
          // - cacheSize >= chunkSize to actually retain the header chunk.
          const headerBytes = file.headerByteLength ?? 16 * 1024 * 1024;
          const gt = await GeoTIFF.fromUrl(url, {
            chunkSize: headerBytes,
            cacheSize: Math.max(headerBytes, 16 * 1024 * 1024),
            prefetch: headerBytes,
          });
          setGeotiffs((prev) => new Map(prev).set(url, gt));
        } catch (err) {
          console.error(`Failed to load GeoTIFF for ${url}:`, err);
        } finally {
          inFlightRef.current.delete(url);
        }
      })();
      return null;
    },
    [geotiffs],
  );

  // Decode the colormap sprite and upload to the GPU once `device` is ready.
  useEffect(() => {
    if (!device) {
      return;
    }
    let cancelled = false;
    (async () => {
      const resp = await fetch(colormapsPngUrl);
      const bytes = await resp.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (cancelled) {
        return;
      }
      setColormapTexture(createColormapTexture(device, image));
    })();
    return () => {
      cancelled = true;
    };
  }, [device]);

  const layers = useMemo(() => {
    // Reconstruct a deck.gl viewport from the current maplibre view state so
    // we can convert the swipe handle's pixel-space x into a longitude
    // (and from there into mercator meters for ClipExtension).
    const vp = new WebMercatorViewport({
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      width: typeof window !== "undefined" ? window.innerWidth : 1024,
      height: typeof window !== "undefined" ? window.innerHeight : 768,
    });
    const splitMx = splitMercatorMeterX(vp, splitFraction);
    const leftClip: [number, number, number, number] = [
      -MERCATOR_HALF_EQUATOR,
      -MERCATOR_HALF_EQUATOR,
      splitMx,
      MERCATOR_HALF_EQUATOR,
    ];
    const rightClip: [number, number, number, number] = [
      splitMx,
      -MERCATOR_HALF_EQUATOR,
      MERCATOR_HALF_EQUATOR,
      MERCATOR_HALF_EQUATOR,
    ];

    const result: unknown[] = [];
    const leftFile = getVTFile(left.fileId);
    const leftGeoTIFF = ensureGeoTIFF(leftFile);
    if (leftGeoTIFF) {
      const leftCog = makeCOGLayer({
        side: "left",
        file: leftFile,
        geotiff: leftGeoTIFF,
        renderMode: left.renderMode,
        clipBounds: leftClip,
        colormapTexture,
      });
      if (leftCog) {
        result.push(leftCog);
      }
    }
    const rightFile = getVTFile(right.fileId);
    const rightGeoTIFF = ensureGeoTIFF(rightFile);
    if (rightGeoTIFF) {
      const rightCog = makeCOGLayer({
        side: "right",
        file: rightFile,
        geotiff: rightGeoTIFF,
        renderMode: right.renderMode,
        clipBounds: rightClip,
        colormapTexture,
      });
      if (rightCog) {
        result.push(rightCog);
      }
    }
    return result;
    // `ensureGeoTIFF` closes over `geotiffs`, so when an async load resolves
    // and we setGeotiffs(...), this useMemo re-runs and the layer that was
    // waiting on the load picks up the new instance.
  }, [viewState, splitFraction, left, right, colormapTexture, ensureGeoTIFF]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={(_ref: MapRef | null) => {}}
        mapStyle={MAP_STYLE}
        initialViewState={INITIAL_VIEW_STATE}
        onMove={(e) => setViewState(e.viewState)}
        // Lock the camera to north-up + flat. ClipExtension's clipBounds
        // are computed assuming a non-rotated mercator viewport, so rotation
        // would visually misalign the swipe handle from the imagery split.
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        maxPitch={0}
        onLoad={(e) => {
          // dragRotate covers mouse; this disables two-finger rotate on touch.
          e.target.touchZoomRotate.disableRotation();
        }}
      >
        <DeckGLOverlay
          layers={layers as []}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
      <SwipeHandle fraction={splitFraction} onChange={setSplitFraction} />
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <ComparePanel
          left={left}
          right={right}
          onLeftChange={setLeft}
          onRightChange={setRight}
        />
      </div>
    </div>
  );
}
