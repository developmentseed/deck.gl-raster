import type { PickingInfo } from "@deck.gl/core";
import { PolygonLayer } from "@deck.gl/layers";
import { LoadingWidget } from "@deck.gl/widgets";
import type { COGSourceOptions } from "@developmentseed/deck.gl-geotiff";
import {
  COGLayer,
  COGSource,
  MosaicLayer,
} from "@developmentseed/deck.gl-geotiff";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { Device, Texture } from "@luma.gl/core";
import {
  DeckGlOverlay,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { ColormapId } from "./colormap-choices.js";
import { COLORMAP_CHOICES } from "./colormap-choices.js";
import type { VrtLoadStats } from "./control-panel.js";
import { ControlPanel } from "./control-panel.js";
import type { ElevationTileData } from "./elevation.js";
import { getTileData, renderElevation } from "./elevation.js";
import type { VrtItem } from "./vrt.js";
import { parseVrt } from "./vrt.js";

/** The USGS 3DEP 1 arc-second seamless elevation VRT. */
const VRT_URL =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1/TIFF/USGS_Seamless_DEM_1.vrt";

/**
 * The map's minimum zoom. Each file is a 1° tile, so further out a view would
 * open hundreds of files at once.
 */
const MIN_ZOOM = 7;

/** The Grand Canyon. */
const INITIAL_VIEW_STATE = {
  longitude: -112.1,
  latitude: 36.15,
  zoom: 8,
  pitch: 0,
  bearing: 0,
};

/**
 * Opened COG sources, by URL.
 *
 * The MosaicLayer's own cache is off (`maxCacheSize: 0`), since each cached
 * item would keep its whole COGLayer and textures alive. Only the cheap opened
 * sources are kept, here. See
 * https://github.com/developmentseed/deck.gl-raster/issues/803.
 *
 * A failed or aborted open is evicted, so the next visit retries it.
 */
const sourceCache = new Map<string, Promise<COGSource>>();

function getCachedSource(
  url: string,
  options: COGSourceOptions,
): Promise<COGSource> {
  let promise = sourceCache.get(url);
  if (!promise) {
    promise = COGSource.open(url, options).catch((err) => {
      sourceCache.delete(url);
      throw err;
    });
    sourceCache.set(url, promise);
  }
  return promise;
}

/** Fetch and parse a VRT, timing each step. */
async function loadVrt(
  url: string,
  signal: AbortSignal,
): Promise<{ items: VrtItem[]; stats: VrtLoadStats }> {
  const start = performance.now();
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Fetching the VRT failed: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const fetched = performance.now();
  const items = parseVrt(new TextDecoder().decode(buffer), url);
  const parsed = performance.now();
  return {
    items,
    stats: {
      fileCount: items.length,
      byteLength: buffer.byteLength,
      fetchMs: fetched - start,
      parseMs: parsed - fetched,
    },
  };
}

/** The outline of an item's bbox. */
function footprint({ bbox }: VrtItem): [number, number][] {
  const [west, south, east, north] = bbox;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** The hovered footprint's file name. */
function getTooltip({ object }: PickingInfo<VrtItem>) {
  return object ? { text: object.url.split("/").pop()! } : null;
}

export default function App() {
  const [items, setItems] = useState<VrtItem[]>([]);
  const [stats, setStats] = useState<VrtLoadStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFootprints, setShowFootprints] = useState(true);
  const [colormapId, setColormapId] = useState<ColormapId>("terrain");
  const [elevationRange, setElevationRange] = useState<[number, number]>([
    0, 3000,
  ]);
  const [opacity, setOpacity] = useState(1);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  const colormapChoice = useMemo(
    () =>
      COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0],
    [colormapId],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadVrt(VRT_URL, controller.signal).then(
      ({ items, stats }) => {
        setItems(items);
        setStats(stats);
      },
      (err) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Error loading the VRT:", err);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => controller.abort();
  }, []);

  // Decode the shipped colormap sprite once. It doesn't need a GPU device, so
  // it can run while the VRT loads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(colormapsPngUrl);
        const image = await decodeColormapSprite(await response.arrayBuffer());
        if (!cancelled) {
          setColormapImage(image);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load colormap sprite:", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

  const layers = [];

  if (items.length > 0 && colormapTexture) {
    const style = {
      colormapTexture,
      colormapIndex: colormapChoice.colormapIndex,
      range: elevationRange,
    };
    layers.push(
      new MosaicLayer<VrtItem, COGSource>({
        id: "vrt-mosaic",
        data: items,
        getSource: (item, options) => getCachedSource(item.url, options),
        opacity,
        renderSource: (_item, { source, subLayerProps }) =>
          new COGLayer<ElevationTileData>({
            ...subLayerProps,
            source,
            getTileData,
            renderTile: (data) => renderElevation(data, style),
            onTileUnload: (tile) => tile.content?.texture.destroy(),
          }),
        maxCacheSize: 0,
        // Draw under the basemap's water, boundaries, roads and labels.
        // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
        // doesn't know about it.
        beforeId: "waterway",
      }),
    );
  }

  if (items.length > 0) {
    layers.push(
      new PolygonLayer<VrtItem>({
        id: "vrt-footprints",
        data: items,
        visible: showFootprints,
        getPolygon: footprint,
        // A nearly transparent fill, so the whole footprint is hoverable
        filled: true,
        getFillColor: [255, 255, 255, 1],
        stroked: true,
        getLineColor: [255, 255, 255, 80],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 40],
      }),
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        initialViewState={INITIAL_VIEW_STATE}
        minZoom={MIN_ZOOM}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={layers}
          getTooltip={getTooltip}
          // With no layers, deck never redraws, so the widget would keep its
          // initial loading state forever. Drop it once the VRT fails to load.
          widgets={error ? [] : [new LoadingWidget(loadingWidgetProps)]}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      <ControlPanel
        stats={stats}
        error={error}
        showFootprints={showFootprints}
        onShowFootprintsChange={setShowFootprints}
        colormapId={colormapId}
        onColormapIdChange={setColormapId}
        colormapChoice={colormapChoice}
        elevationRange={elevationRange}
        onElevationRangeChange={setElevationRange}
        opacity={opacity}
        onOpacityChange={setOpacity}
      />
    </div>
  );
}
