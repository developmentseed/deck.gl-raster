import { NativeSelect, Text } from "@chakra-ui/react";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
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
import { makeGetTileData } from "./get-tile-data.js";
import type { RenderMode } from "./render-tile.js";
import { makeRenderTile, RENDER_MODES } from "./render-tile.js";
import { TileCache } from "./tile-cache.js";
import { ValueSlider } from "./ui/value-slider.js";
import type { CellId } from "./usgs/cells.js";
import { CELLS, DEFAULT_CELL_ID } from "./usgs/cells.js";

/**
 * Decoded tiles retained across halo assemblies. Sized well above the number
 * of tiles visible at one zoom so the neighbor ring around the viewport stays
 * resident and is not re-decoded on every pan.
 */
const TILE_CACHE_CAPACITY = 512;

/** Slope, in degrees, spans a fixed range regardless of the terrain. */
const SLOPE_RANGE: [number, number] = [0, 70];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [cellId, setCellId] = useState<CellId>(DEFAULT_CELL_ID);
  const [mode, setMode] = useState<RenderMode>("tinted-relief");
  const [sunAzimuth, setSunAzimuth] = useState(315);
  const [sunAltitude, setSunAltitude] = useState(45);
  const [zFactor, setZFactor] = useState(1);
  const [shadeStrength, setShadeStrength] = useState(1);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });

  const cell = useMemo(
    () => CELLS.find((c) => c.id === cellId) ?? CELLS[0],
    [cellId],
  );

  // Colormap range follows the mode: slope is always 0-70°, while elevation
  // (and so tinted relief) is per-cell, since these cells range from a few
  // hundred meters to well over four thousand.
  const [rescaleMin, rescaleMax] =
    mode === "slope" ? SLOPE_RANGE : cell.elevationRange;

  // One cache for the whole app. Neighbors fetched to build one tile's halo
  // are the very tiles the layer renders next, so this is what keeps the halo
  // near one decode per tile instead of nine.
  const tileCache = useMemo(
    () => new TileCache({ capacity: TILE_CACHE_CAPACITY }),
    [],
  );

  // Decode the shipped colormap sprite once at mount. This yields ImageData
  // and needs no GPU device, so it runs in parallel with opening the COG.
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(colormapsPngUrl);
      const bytes = await response.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (!cancelled) {
        setColormapImage(image);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the sprite once the luma.gl Device arrives from the overlay.
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

  // A tile's halo is refined in place once its neighbors arrive (see
  // makeGetTileData). That mutates a texture without changing any layer prop,
  // so deck.gl has to be nudged to redraw. Bumping this counter re-renders the
  // layer; the rAF coalescing keeps a burst of arriving tiles to one redraw
  // per frame rather than one per tile.
  // Only the setter is used: re-rendering rebuilds the layer, which is what
  // prompts the redraw. The counter's value is never read.
  const [, setRefinement] = useState(0);
  const refinementPending = useRef(false);
  const onTileRefined = useCallback(() => {
    if (refinementPending.current) {
      return;
    }
    refinementPending.current = true;
    requestAnimationFrame(() => {
      refinementPending.current = false;
      setRefinement((n) => n + 1);
    });
  }, []);

  const getTileData = useMemo(
    () => makeGetTileData({ cache: tileCache, onTileRefined }),
    [tileCache, onTileRefined],
  );

  const renderTile = makeRenderTile({
    mode,
    sunAzimuth,
    sunAltitude,
    zFactor,
    colormapTexture,
    colormapIndex:
      mode === "slope" ? COLORMAP_INDEX.magma : COLORMAP_INDEX.terrain,
    colormapReversed: false,
    rescaleMin,
    rescaleMax,
    shadeStrength,
  });

  const layer = new COGLayer({
    id: `terrain-${cell.id}`,
    geotiff: cell.url,
    getTileData,
    renderTile,
    debug: debugState.debug,
    debugOpacity: debugState.debugOpacity,
    onGeoTIFFLoad: (_tiff, options) => {
      const { west, south, east, north } = options.geographicBounds;
      mapRef.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 1000 },
      );
    },
    // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
    // doesn't know about it.
    beforeId: "boundary_country_outline",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -112.14,
          latitude: 36.06,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={[layer]}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>

      <ControlPanel
        title="GPU Hillshade — USGS 3DEP"
        sourcePath="examples/terrain-usgs"
      >
        <Text mb="3" color="gray.600">
          Slope and relief shading computed on the GPU from{" "}
          <ExternalLink href="https://www.usgs.gov/3d-elevation-program">
            USGS 3DEP
          </ExternalLink>{" "}
          1-meter lidar elevation, streamed straight from S3. A tile server
          bakes hillshade in at a fixed sun angle; here the sun moves.
        </Text>

        <Field label="Elevation cell">
          <NativeSelect.Root>
            <NativeSelect.Field
              value={cellId}
              onChange={(e) => setCellId(e.target.value as CellId)}
            >
              {CELLS.map((option) => (
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

        <Field label={`Vertical exaggeration: ${zFactor.toFixed(1)}×`}>
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

        <Text mt="2" fontSize="xs" color="gray.600">
          Elevation data courtesy of the{" "}
          <ExternalLink href="https://www.usgs.gov/3d-elevation-program">
            U.S. Geological Survey 3D Elevation Program
          </ExternalLink>
          .
        </Text>

        <DebugControls value={debugState} onChange={setDebugState} />
      </ControlPanel>
    </div>
  );
}
