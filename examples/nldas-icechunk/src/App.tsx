import { NativeSelect, Text } from "@chakra-ui/react";
import {
  COLORMAP_INDEX,
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import {
  ColormapPreview,
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
  Field,
  RangeSlider,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type * as zarr from "zarrita";
import type { ColormapId } from "./nldas/colormap-choices.js";
import {
  COLORMAP_CHOICES,
  DEFAULT_COLORMAP_ID,
} from "./nldas/colormap-choices.js";
import type { NldasTileData } from "./nldas/get-tile-data.js";
import { getTileData } from "./nldas/get-tile-data.js";
import {
  NLDAS_GEOZARR_ATTRS,
  NODATA_VALUE,
  RESCALE_MAX,
  RESCALE_MIN,
  RESCALE_SLIDER_MAX,
  RESCALE_SLIDER_MIN,
  RESCALE_SLIDER_STEP,
  TIME_DIM,
  TIME_INDEX,
} from "./nldas/metadata.js";
import { makeRenderTile } from "./nldas/render-tile.js";
import { openSurfaceTemp } from "./nldas/store.js";

// Keyless CARTO basemap; light background reads well under a data overlay.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// [[Min longitude, min latitude], [max longitude, max latitude]]
const DATA_BOUNDS: [[number, number], [number, number]] = [
  [-180, -20],
  [-20, 80],
];

/** Total number of rows in the shipped colormap sprite. */
const COLORMAP_ROW_COUNT = Object.keys(COLORMAP_INDEX).length;

/**
 * Convert a Kelvin value to an integer °C for display. The slider operates in
 * Kelvin (the data's native unit, which the rescale shader expects); only the
 * label is shown in the friendlier °C, with Kelvin in parentheses.
 */
const kelvinToCelsius = (k: number) => Math.round(k - 273.15);

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  const [colormapId, setColormapId] = useState<ColormapId>(DEFAULT_COLORMAP_ID);
  const [rescaleMin, setRescaleMin] = useState(RESCALE_MIN);
  const [rescaleMax, setRescaleMax] = useState(RESCALE_MAX);

  const colormapChoice = useMemo(
    () =>
      COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0],
    [colormapId],
  );

  // Open the icechunk store + surface temperature array once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await openSurfaceTemp();
      if (!cancelled) {
        setArr(opened);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decode the shipped colormap sprite once (no GPU device needed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await fetch(colormapsPngUrl);
      const bytes = await resp.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (!cancelled) {
        setColormapImage(image);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the colormap sprite once both the Device and the decoded image exist.
  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

  const layers =
    arr && colormapTexture
      ? [
          new ZarrLayer<zarr.Readable, "float32", NldasTileData>({
            id: "nldas-surface-temp",
            node: arr,
            metadata: NLDAS_GEOZARR_ATTRS,
            selection: { [TIME_DIM]: TIME_INDEX },
            getTileData,
            renderTile: makeRenderTile({
              colormapTexture,
              colormapIndex: colormapChoice.colormapIndex,
              colormapReversed: colormapChoice.reversed,
              noDataValue: NODATA_VALUE,
              rescaleMin,
              rescaleMax,
            }),
            // Re-run renderTile on cached tiles when the colormap or rescale
            // range changes.
            updateTriggers: {
              renderTile: [colormapId, rescaleMin, rescaleMax],
            },
            // source bucket supports HTTP/2 multiplexing
            maxRequests: 20,
            maxCacheSize: 20,
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: -98, latitude: 39, zoom: 3.5 }}
        mapStyle={BASEMAP_STYLE}
        maxBounds={DATA_BOUNDS}
      >
        <DeckGlOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
      <ControlPanel
        title="NLDAS-3 + icechunk"
        sourcePath="examples/nldas-icechunk"
      >
        <Text mb="3" color="gray.600">
          Reads NASA's NLDAS-3 daily near-surface air temperature directly from
          a public{" "}
          <ExternalLink href="https://icechunk.io">icechunk</ExternalLink>{" "}
          repository in the browser — no server in between. The store is a{" "}
          <em>virtual</em> Zarr: its chunks reference NLDAS-3 source files in
          the same S3 bucket, read with{" "}
          <ExternalLink href="https://github.com/EarthyScience/icechunk-js">
            icechunk-js
          </ExternalLink>{" "}
          + zarrita and rendered by a <code>ZarrLayer</code>. Showing a single
          day (2010-07-16); ocean / no-data is left transparent.
        </Text>

        <Field label="Colormap">
          <NativeSelect.Root size="sm" mb="2">
            <NativeSelect.Field
              value={colormapId}
              onChange={(e) => setColormapId(e.target.value as ColormapId)}
            >
              {COLORMAP_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>
        <ColormapPreview
          spriteUrl={colormapsPngUrl}
          rowCount={COLORMAP_ROW_COUNT}
          rowIndex={colormapChoice.colormapIndex}
          reversed={colormapChoice.reversed}
          label={colormapChoice.label}
        />

        <Field
          label={
            <Text as="span">
              Rescale range: {kelvinToCelsius(rescaleMin)}°C ({rescaleMin} K) –{" "}
              {kelvinToCelsius(rescaleMax)}°C ({rescaleMax} K)
            </Text>
          }
        >
          <RangeSlider
            min={RESCALE_SLIDER_MIN}
            max={RESCALE_SLIDER_MAX}
            step={RESCALE_SLIDER_STEP}
            value={[rescaleMin, rescaleMax]}
            onChange={([nextMin, nextMax]) => {
              if (nextMin !== rescaleMin) {
                setRescaleMin(nextMin);
              }
              if (nextMax !== rescaleMax) {
                setRescaleMax(nextMax);
              }
            }}
            thumbLabels={["Rescale min (K)", "Rescale max (K)"]}
          />
        </Field>
      </ControlPanel>
    </div>
  );
}
