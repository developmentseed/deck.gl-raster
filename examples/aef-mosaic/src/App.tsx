import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import * as zarr from "zarrita";
import { fetchBandLabels } from "./aef/band-labels.js";
import { MIN_ZOOM, VARIABLE, ZARR_URL } from "./aef/constants.js";
import type { AefTileData } from "./aef/get-tile-data.js";
import { getTileData } from "./aef/get-tile-data.js";
import type { Location } from "./aef/locations.js";
import { LOCATIONS } from "./aef/locations.js";
import { makeRenderTile } from "./aef/render-tile.js";
import { buildSelection } from "./aef/selection.js";
import { ControlPanel } from "./ui/control-panel.js";

const DEFAULT_LOCATION = LOCATIONS[0]!;
const DEFAULT_YEAR_IDX = 8; // 2025
const DEFAULT_R_BAND = 0;
const DEFAULT_G_BAND = 16;
const DEFAULT_B_BAND = 32;
const DEFAULT_RESCALE_MIN = -0.3;
const DEFAULT_RESCALE_MAX = 0.3;

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [arr, setArr] = useState<zarr.Array<"int8", zarr.Readable> | null>(
    null,
  );
  const [rootAttrs, setRootAttrs] = useState<unknown>(null);
  const [bandLabels, setBandLabels] = useState<string[] | null>(null);

  const [locationId, setLocationId] = useState(DEFAULT_LOCATION.id);
  const [yearIdx, setYearIdx] = useState(DEFAULT_YEAR_IDX);
  const [rBandIdx, setRBandIdx] = useState(DEFAULT_R_BAND);
  const [gBandIdx, setGBandIdx] = useState(DEFAULT_G_BAND);
  const [bBandIdx, setBBandIdx] = useState(DEFAULT_B_BAND);
  const [rescaleMin, setRescaleMin] = useState(DEFAULT_RESCALE_MIN);
  const [rescaleMax, setRescaleMax] = useState(DEFAULT_RESCALE_MAX);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = new zarr.FetchStore(ZARR_URL);
      const root = await zarr.open.v3(store, { kind: "group" });
      const opened = await zarr.open.v3(root.resolve(VARIABLE), {
        kind: "array",
      });
      if (!opened.is("int8")) {
        throw new Error(
          `Expected AEF embeddings to be int8, got ${opened.dtype}`,
        );
      }
      const labels = await fetchBandLabels(root);
      if (cancelled) {
        return;
      }
      setArr(opened);
      setRootAttrs(root.attrs);
      setBandLabels(labels);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selection = useMemo(() => buildSelection({ yearIdx }), [yearIdx]);
  const renderTile = useCallback(
    (data: AefTileData) =>
      makeRenderTile({
        rBandIdx,
        gBandIdx,
        bBandIdx,
        rescaleMin,
        rescaleMax,
      })(data),
    [rBandIdx, gBandIdx, bBandIdx, rescaleMin, rescaleMax],
  );

  const handleLocationChange = useCallback((location: Location) => {
    setLocationId(location.id);
    mapRef.current?.flyTo({
      center: [location.longitude, location.latitude],
      zoom: location.zoom,
    });
  }, []);

  const layers =
    arr && rootAttrs
      ? [
          new ZarrLayer<zarr.Readable, "int8", AefTileData>({
            id: `aef-zarr-layer-${yearIdx}`,
            node: arr,
            metadata: rootAttrs,
            selection,
            getTileData,
            renderTile,
            minZoom: MIN_ZOOM,
            // source.coop supports HTTP/2 multiplexing, so increase concurrent
            // requests beyond browser limit of 6 per HTTP/1.1 domain
            maxRequests: 20,
            // Tiles are heavy, so limit GPU pressure with small cache size
            maxCacheSize: 10,
            updateTriggers: {
              renderTile: [
                rBandIdx,
                gBandIdx,
                bBandIdx,
                rescaleMin,
                rescaleMax,
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
        initialViewState={{
          longitude: DEFAULT_LOCATION.longitude,
          latitude: DEFAULT_LOCATION.latitude,
          zoom: DEFAULT_LOCATION.zoom,
        }}
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
          locationId={locationId}
          yearIdx={yearIdx}
          bandLabels={bandLabels}
          rBandIdx={rBandIdx}
          gBandIdx={gBandIdx}
          bBandIdx={bBandIdx}
          rescaleMin={rescaleMin}
          rescaleMax={rescaleMax}
          onLocationChange={handleLocationChange}
          onYearIdxChange={setYearIdx}
          onRBandIdxChange={setRBandIdx}
          onGBandIdxChange={setGBandIdx}
          onBBandIdxChange={setBBandIdx}
          onRescaleMinChange={setRescaleMin}
          onRescaleMaxChange={setRescaleMax}
        />
      </div>
    </div>
  );
}
