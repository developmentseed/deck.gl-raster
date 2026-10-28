import { chakra, NativeSelect, Stack, Text } from "@chakra-ui/react";
import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { PerOriginSemaphore, RangeReader } from "@developmentseed/range-reader";
import type { Device, Texture } from "@luma.gl/core";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
  Field,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { PlaceId } from "./places.js";
import { DEFAULT_PLACE_ID, PLACES } from "./places.js";
import { CountingFetchSource } from "./pmtiles/counting-fetch-source.js";
import { PMTilesSource } from "./pmtiles/pmtiles-source.js";
import { RangeReaderSource } from "./pmtiles/range-reader-source.js";
import type { ReadStats } from "./pmtiles/read-stats.js";
import { PMTilesTerrainLayer } from "./pmtiles-terrain-layer.js";
import { BorderCache } from "./terrain/border-cache.js";
import {
  loadTerrariumElevation,
  makeGetTileData,
} from "./terrain/get-tile-data.js";
import type { RenderMode } from "./terrain/render-tile.js";
import { makeRenderTile, RENDER_MODES } from "./terrain/render-tile.js";
import { StatsReadout } from "./ui/stats-readout.js";
import { ValueSlider } from "./ui/value-slider.js";

/** Mapterhorn's global terrain: z0-12 of Terrarium-encoded 512 px WebP tiles. */
const ARCHIVE_URL = "https://download.mapterhorn.com/planet.pmtiles";

/** Mapterhorn's tile size; the PMTiles header doesn't record it. */
const TILE_SIZE = 512;

/** Settled tile borders to keep, at 8 KiB each. */
const BORDER_CACHE_CAPACITY = 2048;

/**
 * One limiter for the page: it caps concurrent requests per origin. Each
 * opened archive gets its own reader (byte cache and batching window), so the
 * merge switch compares two cold starts.
 */
const LIMITER = new PerOriginSemaphore({ maxRequests: 6 });

/** Slope, in degrees, spans a fixed range wherever you look. */
const SLOPE_RANGE: [number, number] = [0, 70];

/** How often the stats readout refreshes, in milliseconds. */
const STATS_INTERVAL = 250;

/** No reads yet. */
const NO_STATS: ReadStats = { requests: 0, bytesReceived: 0, sharedReads: 0 };

/** Required by Mapterhorn's terms. */
const ATTRIBUTION =
  '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>';

const DEFAULT_PLACE = PLACES.find((place) => place.id === DEFAULT_PLACE_ID)!;

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [placeId, setPlaceId] = useState<PlaceId>(DEFAULT_PLACE_ID);
  const [mode, setMode] = useState<RenderMode>("tinted-relief");
  const [sunAzimuth, setSunAzimuth] = useState(315);
  const [sunAltitude, setSunAltitude] = useState(45);
  const [zFactor, setZFactor] = useState(1);
  const [shadeStrength, setShadeStrength] = useState(1);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });

  const place = PLACES.find((p) => p.id === placeId) ?? DEFAULT_PLACE;
  const [rescaleMin, rescaleMax] =
    mode === "slope" ? SLOPE_RANGE : place.elevationRange;

  // Open the archive: read its header and describe its tile grid. With
  // merging on, bytes come through the range reader; off, through pmtiles'
  // own FetchSource, one request per read. Flipping the switch opens the
  // archive anew, so the layer remounts and the counts start over.
  const [merge, setMerge] = useState(true);
  const [source, setSource] = useState<PMTilesSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    const byteSource = merge
      ? new RangeReaderSource({
          reader: new RangeReader(),
          url: ARCHIVE_URL,
          limiter: LIMITER,
        })
      : new CountingFetchSource({ url: ARCHIVE_URL });
    PMTilesSource.open({ byteSource, tileSize: TILE_SIZE }).then(
      (opened) => {
        if (!cancelled) {
          setSource(opened);
        }
      },
      (reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [merge]);

  // One border cache per archive. Neighbors fetched for one tile's halo are
  // mostly the tiles drawn next to it, so they share one load per tile.
  const cache = useMemo(
    () =>
      source
        ? new BorderCache({
            load: (tile, signal) =>
              loadTerrariumElevation({ source, tile, signal }),
            tileSize: TILE_SIZE,
            capacity: BORDER_CACHE_CAPACITY,
          })
        : null,
    [source],
  );

  // A tile's halo ring is rewritten in place when late neighbors arrive.
  // No prop changes, so ask the map, which draws deck.gl, to repaint.
  const onTileRefined = useCallback(() => {
    mapRef.current?.triggerRepaint();
  }, []);

  const getTileData = useMemo(
    () =>
      cache
        ? makeGetTileData({ cache, tileSize: TILE_SIZE, onTileRefined })
        : null,
    [cache, onTileRefined],
  );

  // Counts for the readout, polled rather than set per read or per tile.
  const tilesDrawn = useRef(0);
  const [readout, setReadout] = useState({
    stats: NO_STATS,
    tilesDrawn: 0,
    tilesDecoded: 0,
  });
  useEffect(() => {
    tilesDrawn.current = 0;
    if (!source || !cache) {
      setReadout({ stats: NO_STATS, tilesDrawn: 0, tilesDecoded: 0 });
      return;
    }
    const timer = setInterval(() => {
      const next = {
        stats: source.byteSource.readStats(),
        tilesDrawn: tilesDrawn.current,
        tilesDecoded: cache.stats.loads,
      };
      setReadout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    }, STATS_INTERVAL);
    return () => clearInterval(timer);
  }, [source, cache]);

  // Decode the shipped colormap sprite once, then upload it when the luma.gl
  // device arrives from the overlay.
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(colormapsPngUrl);
      const image = await decodeColormapSprite(await response.arrayBuffer());
      if (!cancelled) {
        setColormapImage(image);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  useEffect(() => {
    if (device && colormapImage) {
      setColormapTexture(createColormapTexture(device, colormapImage));
    }
  }, [device, colormapImage]);

  const colormapIndex =
    mode === "slope" ? COLORMAP_INDEX.magma : COLORMAP_INDEX.terrain;
  const renderTile = makeRenderTile({
    mode,
    sunAzimuth,
    sunAltitude,
    zFactor,
    colormapTexture,
    colormapIndex,
    colormapReversed: false,
    rescaleMin,
    rescaleMax,
    shadeStrength,
  });

  const layer =
    source && getTileData
      ? new PMTilesTerrainLayer({
          id: "terrain",
          tilesetDescriptor: source.tilesetDescriptor,
          getTileData,
          renderTile,
          // The range reader merges a view's reads into a few requests, so
          // deck.gl's six-at-a-time limit only gets in the way. Without it,
          // keep deck.gl's defaults: one request per tile, six at a time.
          maxRequests: merge ? 256 : 6,
          debounceTime: merge ? 50 : 0,
          onTileLoad: () => {
            tilesDrawn.current += 1;
          },
          onTileUnload: (tile) => {
            tile.content?.texture.destroy();
          },
          updateTriggers: {
            renderTile: [
              mode,
              sunAzimuth,
              sunAltitude,
              zFactor,
              colormapTexture,
              colormapIndex,
              rescaleMin,
              rescaleMax,
              shadeStrength,
            ],
          },
          debug: debugState.debug,
          debugOpacity: debugState.debugOpacity,
          // Draw below the basemap's boundaries and labels.
          // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
          // doesn't know about it.
          beforeId: "boundary_country_outline",
        })
      : null;

  const choosePlace = (id: PlaceId) => {
    setPlaceId(id);
    const next = PLACES.find((p) => p.id === id);
    if (next) {
      mapRef.current?.flyTo({
        center: [next.longitude, next.latitude],
        zoom: next.zoom,
        duration: 1500,
      });
    }
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: DEFAULT_PLACE.longitude,
          latitude: DEFAULT_PLACE.latitude,
          zoom: DEFAULT_PLACE.zoom,
        }}
        maxZoom={14}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        attributionControl={{ customAttribution: ATTRIBUTION }}
      >
        <DeckGlOverlay
          layers={layer ? [layer] : []}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      <ControlPanel
        title={
          <>
            GPU Hillshade from PMTiles{" "}
            <chakra.span
              fontSize="2xs"
              fontWeight="bold"
              letterSpacing="wide"
              textTransform="uppercase"
              color="orange.800"
              bg="orange.100"
              borderWidth="1px"
              borderColor="orange.300"
              borderRadius="sm"
              px="1.5"
              py="0.5"
              verticalAlign="middle"
            >
              Experimental
            </chakra.span>
          </>
        }
        sourcePath="examples/experimental/pmtiles-terrain"
      >
        <Stack gap="3">
          <Text color="gray.600">
            Relief shading computed on the GPU from{" "}
            <ExternalLink href="https://mapterhorn.com/">
              Mapterhorn
            </ExternalLink>
            's global terrain, read straight from one PMTiles archive. A tile
            server bakes hillshade in at a fixed sun angle; here the sun moves.
          </Text>

          {error ? (
            <Text fontSize="sm" color="red.600">
              Failed to open the archive: {error}
            </Text>
          ) : null}

          <Field label="Place">
            <NativeSelect.Root>
              <NativeSelect.Field
                value={placeId}
                onChange={(e) => choosePlace(e.target.value as PlaceId)}
              >
                {PLACES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>

          <Field label="Visualization">
            <NativeSelect.Root>
              <NativeSelect.Field
                value={mode}
                onChange={(e) => setMode(e.target.value as RenderMode)}
              >
                {RENDER_MODES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>

          <Field label={`Sun azimuth: ${sunAzimuth}°`}>
            <ValueSlider
              min={0}
              max={360}
              step={1}
              value={sunAzimuth}
              onChange={setSunAzimuth}
              label="Sun azimuth"
            />
          </Field>

          <Field label={`Sun altitude: ${sunAltitude}°`}>
            <ValueSlider
              min={0}
              max={90}
              step={1}
              value={sunAltitude}
              onChange={setSunAltitude}
              label="Sun altitude"
            />
          </Field>

          <Field label={`Vertical exaggeration: ${zFactor.toFixed(1)}x`}>
            <ValueSlider
              min={0.5}
              max={8}
              step={0.5}
              value={zFactor}
              onChange={setZFactor}
              label="Vertical exaggeration"
            />
          </Field>

          {mode === "tinted-relief" ? (
            <Field label={`Shading strength: ${shadeStrength.toFixed(2)}`}>
              <ValueSlider
                min={0}
                max={1}
                step={0.05}
                value={shadeStrength}
                onChange={setShadeStrength}
                label="Shading strength"
              />
            </Field>
          ) : null}

          <StatsReadout
            stats={readout.stats}
            tilesDrawn={readout.tilesDrawn}
            tilesDecoded={readout.tilesDecoded}
            merge={merge}
            onMergeChange={setMerge}
          />

          <Text fontSize="xs" color="gray.600">
            Elevation data ©{" "}
            <ExternalLink href="https://mapterhorn.com/attribution">
              Mapterhorn
            </ExternalLink>
            .
          </Text>

          <DebugControls value={debugState} onChange={setDebugState} />
        </Stack>
      </ControlPanel>
    </div>
  );
}
