import { ScatterplotLayer } from "@deck.gl/layers";
import { LoadingWidget } from "@deck.gl/widgets";
import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import { ZarrLayer, ZarrSource } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import {
  DeckGlOverlay,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import * as zarr from "zarrita";
import { fetchBandLabels } from "./aef/band-labels.js";
import { MIN_ZOOM, NUM_BANDS, VARIABLE, ZARR_URL } from "./aef/constants.js";
import { readPixelVector } from "./aef/dequantize.js";
import type { AefTileData } from "./aef/get-tile-data.js";
import { loadTile } from "./aef/get-tile-data.js";
import { locatePixel } from "./aef/locate-pixel.js";
import type { Location } from "./aef/locations.js";
import { LOCATIONS } from "./aef/locations.js";
import type { RgbSettings, TileView } from "./aef/render-tile.js";
import { makeRenderTile } from "./aef/render-tile.js";
import { buildSelection } from "./aef/selection.js";
import { sphericalKMeans } from "./analysis/kmeans.js";
import { fitLogistic } from "./analysis/logistic.js";
import { samplePixels } from "./analysis/sample-pixels.js";
import type { AnalysisStatus } from "./analysis/tile-analysis.js";
import { TileAnalysis } from "./analysis/tile-analysis.js";
import type { AnalysisTask, InputPath } from "./onnx/model-runner.js";
import type { ClusterFit, LabeledPoint, Mode } from "./ui/control-panel.js";
import { ControlPanel } from "./ui/control-panel.js";
import { ZoomNotice } from "./ui/zoom-notice.js";

const DEFAULT_LOCATION = LOCATIONS[0]!;
const DEFAULT_YEAR_IDX = 8; // 2025
const DEFAULT_RGB: RgbSettings = {
  rBandIdx: 0,
  gBandIdx: 16,
  bBandIdx: 32,
  rescaleMin: -0.3,
  rescaleMax: 0.3,
};
const DEFAULT_INPUT_PATH: InputPath = "int8";
/** Pixels sampled from the loaded tiles to fit k-means. */
const KMEANS_SAMPLES = 20_000;
const KMEANS_ITERATIONS = 25;
const KMEANS_SEED = 7;

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [source, setSource] = useState<ZarrSource<"int8"> | null>(null);
  const [bandLabels, setBandLabels] = useState<string[] | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  const [locationId, setLocationId] = useState(DEFAULT_LOCATION.id);
  const [yearIdx, setYearIdx] = useState(DEFAULT_YEAR_IDX);
  const [rgb, setRgb] = useState<RgbSettings>(DEFAULT_RGB);
  const [belowMinZoom, setBelowMinZoom] = useState(
    DEFAULT_LOCATION.zoom < MIN_ZOOM,
  );

  const [mode, setMode] = useState<Mode>("similarity");
  const [inputPath, setInputPath] = useState<InputPath>(DEFAULT_INPUT_PATH);
  const [colormapName, setColormapName] =
    useState<keyof typeof COLORMAP_INDEX>("magma");
  const [opacity, setOpacity] = useState(0.85);
  const [notice, setNotice] = useState<string | null>(null);

  const [query, setQuery] = useState<LabeledPoint | null>(null);
  const [similarityRange, setSimilarityRange] = useState<[number, number]>([
    0.5, 1,
  ]);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);

  const [clusterCount, setClusterCount] = useState(6);
  const [clusterFit, setClusterFit] = useState<ClusterFit | null>(null);

  const [points, setPoints] = useState<LabeledPoint[]>([]);
  const [nextLabel, setNextLabel] = useState<0 | 1>(1);
  const [probabilityThreshold, setProbabilityThreshold] = useState(0.5);

  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [analysis] = useState(
    () => new TileAnalysis(DEFAULT_INPUT_PATH, setStatus),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const source = await ZarrSource.open(new zarr.FetchStore(ZARR_URL), {
        path: VARIABLE,
      });
      if (!source.is("int8")) {
        throw new Error(
          `Expected AEF embeddings to be int8, got ${source.levels[0]!.dtype}`,
        );
      }
      const labels = await fetchBandLabels(zarr.root(source.node.store));
      if (cancelled) {
        return;
      }
      setSource(source);
      setBandLabels(labels);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decode the colormap sprite, then upload it once the device exists.
  useEffect(() => {
    if (!device) {
      return;
    }
    let cancelled = false;
    (async () => {
      const response = await fetch(colormapsPngUrl);
      const image = await decodeColormapSprite(await response.arrayBuffer());
      if (!cancelled) {
        setColormapTexture(createColormapTexture(device, image));
      }
    })().catch((error) => console.error("Failed to load colormaps", error));
    return () => {
      cancelled = true;
    };
  }, [device]);

  useEffect(() => {
    analysis.setInputPath(inputPath);
  }, [analysis, inputPath]);

  // Load ONNX Runtime and the mode's model as soon as the mode is picked
  useEffect(() => {
    if (mode !== "rgb") {
      void analysis.prepare(mode);
    }
  }, [analysis, mode]);

  const classifier = useMemo(() => {
    const labels = Uint8Array.from(points, (point) => point.label);
    const positives = labels.reduce((sum, label) => sum + label, 0);
    if (positives === 0 || positives === labels.length) {
      return null;
    }
    const samples = new Float32Array(points.length * NUM_BANDS);
    for (const [i, point] of points.entries()) {
      samples.set(point.vector, i * NUM_BANDS);
    }
    return fitLogistic(samples, labels, NUM_BANDS);
  }, [points]);

  const task = useMemo<AnalysisTask | null>(() => {
    switch (mode) {
      case "similarity":
        return query ? { model: "similarity", query: query.vector } : null;
      case "clusters":
        return clusterFit
          ? {
              model: "clusters",
              centroids: clusterFit.centroids,
              k: clusterFit.k,
            }
          : null;
      case "classifier":
        return classifier
          ? {
              model: "classifier",
              weights: classifier.weights,
              bias: classifier.bias,
            }
          : null;
      case "rgb":
        return null;
    }
  }, [mode, query, clusterFit, classifier]);

  useEffect(() => {
    analysis.setTask(task);
  }, [analysis, task]);

  const fitClusters = useCallback(() => {
    const start = performance.now();
    const samples = samplePixels(analysis.residentTiles(), KMEANS_SAMPLES);
    const sampleCount = samples.length / NUM_BANDS;
    if (sampleCount < clusterCount) {
      setNotice("Wait for tiles to load, then fit the clusters again.");
      return;
    }
    const centroids = sphericalKMeans(samples, NUM_BANDS, {
      k: clusterCount,
      iterations: KMEANS_ITERATIONS,
      seed: KMEANS_SEED,
    });
    setClusterFit({
      centroids,
      k: clusterCount,
      sampleCount,
      ms: performance.now() - start,
    });
  }, [analysis, clusterCount]);

  // Fit clusters on entering the mode or changing k, once tiles are loaded
  const tileCount = status?.tileCount ?? 0;
  useEffect(() => {
    if (
      mode === "clusters" &&
      tileCount > 0 &&
      clusterFit?.k !== clusterCount
    ) {
      fitClusters();
    }
  }, [mode, tileCount, clusterFit, clusterCount, fitClusters]);

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      if (!source || (mode !== "similarity" && mode !== "classifier")) {
        return;
      }
      const { lng: longitude, lat: latitude } = event.lngLat;
      const location = locatePixel(source, longitude, latitude);
      const tile = location ? analysis.getTile(location.key) : undefined;
      if (!location || !tile) {
        setNotice("No data loaded there yet.");
        return;
      }
      const vector = readPixelVector(
        tile.embeddings,
        tile.width,
        tile.height,
        location.col,
        location.row,
      );
      if (!vector) {
        setNotice("That pixel has no data.");
        return;
      }
      setNotice(null);
      if (mode === "similarity") {
        setQuery({ longitude, latitude, vector, label: 1 });
        return;
      }
      const label = event.originalEvent.shiftKey ? 0 : nextLabel;
      setPoints((previous) => [
        ...previous,
        { longitude, latitude, vector, label },
      ]);
    },
    [analysis, mode, nextLabel, source],
  );

  const selection = useMemo(() => buildSelection({ yearIdx }), [yearIdx]);

  const getTileData = useCallback(
    async (
      arr: zarr.Array<"int8", zarr.Readable>,
      options: GetTileDataOptions,
    ): Promise<AefTileData> => {
      const tile = await loadTile(arr, options);
      await analysis.addTile(tile, options.signal);
      return tile;
    },
    [analysis],
  );

  const view = useMemo<TileView>(() => {
    if (mode === "rgb") {
      return { kind: "rgb" };
    }
    // Nothing to draw until the mode has a query, a fit or a classifier
    if (!task) {
      return { kind: "none" };
    }
    if (mode === "clusters") {
      return { kind: "clusters", opacity };
    }
    if (!colormapTexture) {
      return { kind: "none" };
    }
    const [rangeMin, rangeMax] =
      mode === "similarity" ? similarityRange : [probabilityThreshold, 1];
    return {
      kind: "value",
      model: mode,
      colormapTexture,
      colormapIndex: COLORMAP_INDEX[colormapName],
      rangeMin,
      rangeMax,
      threshold:
        mode === "similarity" ? similarityThreshold : probabilityThreshold,
      opacity,
    };
  }, [
    mode,
    task,
    opacity,
    colormapTexture,
    colormapName,
    similarityRange,
    similarityThreshold,
    probabilityThreshold,
  ]);

  const renderTile = useMemo(() => makeRenderTile(rgb, view), [rgb, view]);

  const handleLocationChange = useCallback((location: Location) => {
    setLocationId(location.id);
    mapRef.current?.flyTo({
      center: [location.longitude, location.latitude],
      zoom: location.zoom,
    });
  }, []);

  const markers: LabeledPoint[] =
    mode === "similarity" && query
      ? [query]
      : mode === "classifier"
        ? points
        : [];

  const layers = source
    ? [
        new ZarrLayer<AefTileData, "int8">({
          id: "aef-zarr-layer",
          source,
          selection,
          getTileData,
          renderTile,
          onTileUnload: (tile) => {
            if (tile.content) {
              analysis.removeTile(tile.content);
            }
          },
          minZoom: MIN_ZOOM,
          // Tiles are heavy, so limit memory with a small cache
          maxCacheSize: 10,
          updateTriggers: {
            renderTile: [rgb, view, status?.renderVersion],
          },
          // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
          // doesn't know about it.
          beforeId: "boundary_country_outline",
        }),
        new ScatterplotLayer<LabeledPoint>({
          id: "markers",
          data: markers,
          getPosition: (point) => [point.longitude, point.latitude],
          getFillColor: (point) =>
            mode === "similarity"
              ? [255, 255, 255]
              : point.label === 1
                ? [34, 197, 94]
                : [239, 68, 68],
          getLineColor: [0, 0, 0],
          lineWidthMinPixels: 1.5,
          stroked: true,
          radiusUnits: "pixels",
          getRadius: 6,
          updateTriggers: { getFillColor: [mode] },
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: DEFAULT_LOCATION.longitude,
          latitude: DEFAULT_LOCATION.latitude,
          zoom: DEFAULT_LOCATION.zoom,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        onZoom={(e) => setBelowMinZoom(e.viewState.zoom < MIN_ZOOM)}
        onClick={handleClick}
        // Shift-click labels a negative example rather than starting a box zoom
        boxZoom={false}
        cursor={
          mode === "similarity" || mode === "classifier" ? "crosshair" : "grab"
        }
      >
        <DeckGlOverlay
          layers={layers}
          widgets={[new LoadingWidget(loadingWidgetProps)]}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
      {belowMinZoom && <ZoomNotice />}
      <ControlPanel
        locationId={locationId}
        yearIdx={yearIdx}
        bandLabels={bandLabels}
        rgb={rgb}
        mode={mode}
        inputPath={inputPath}
        colormapName={colormapName}
        opacity={opacity}
        notice={notice}
        query={query}
        similarityRange={similarityRange}
        similarityThreshold={similarityThreshold}
        clusterCount={clusterCount}
        clusterFit={clusterFit}
        points={points}
        nextLabel={nextLabel}
        probabilityThreshold={probabilityThreshold}
        status={status}
        onLocationChange={handleLocationChange}
        onYearIdxChange={setYearIdx}
        onRgbChange={setRgb}
        onModeChange={setMode}
        onInputPathChange={setInputPath}
        onColormapNameChange={setColormapName}
        onOpacityChange={setOpacity}
        onSimilarityRangeChange={setSimilarityRange}
        onSimilarityThresholdChange={setSimilarityThreshold}
        onClusterCountChange={setClusterCount}
        onRefitClusters={fitClusters}
        onNextLabelChange={setNextLabel}
        onClearPoints={() => setPoints([])}
        onProbabilityThresholdChange={setProbabilityThreshold}
      />
    </div>
  );
}
