import { Box, chakra, Flex, Stack, Text } from "@chakra-ui/react";
import type { PickingInfo } from "@deck.gl/core";
import type { DataFilterExtensionProps } from "@deck.gl/extensions";
import { DataFilterExtension } from "@deck.gl/extensions";
import { LoadingWidget } from "@deck.gl/widgets";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { GeoArrowScatterplotLayerProps } from "@geoarrow/deck.gl-geoarrow";
import { GeoArrowScatterplotLayer } from "@geoarrow/deck.gl-geoarrow";
import type * as arrow from "apache-arrow";
import {
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
  Field,
  loadingWidgetProps,
  RangeSlider,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { OoklaFileInfo, SpeedBatch } from "./ookla.js";
import { loadOokla, OOKLA_URL } from "./ookla.js";
import { SPEED_COLOR_DOMAIN_MBPS, SPEED_GRADIENT_CSS } from "./speed-colors.js";

const EOX_CLOUDLESS_URL =
  "https://s3.us-east-1.amazonaws.com/ds-deck.gl-raster-public/cog/viewing-basic_s2cloudless-2024_geodetic-zoom-3_3bands_8bit.tif";

/**
 * The download speed slider works in log10(Mbps), from 1 Mbps to 1000 Mbps,
 * because speeds have a long tail: the median is ~70 Mbps but the top 1% are
 * over 850 Mbps. Both ends are open: the bottom position includes everything
 * slower and the top position everything faster.
 */
const SLIDER_LOG_MIN = 0;
const SLIDER_LOG_MAX = 3;
const SLIDER_LOG_STEP = 0.01;

/** Download speed (Mbps) at a slider position, or `null` at an open end. */
function sliderMbps(position: number): number | null {
  if (position <= SLIDER_LOG_MIN || position >= SLIDER_LOG_MAX) {
    return null;
  }
  return 10 ** position;
}

function formatMbps(mbps: number): string {
  return mbps < 10 ? mbps.toFixed(1) : String(Math.round(mbps));
}

/** MapLibre layer that the deck.gl layers are inserted beneath. */
const BEFORE_ID = "boundary_country_outline";

/** Shared by every point layer, so the filter shader is compiled once. */
const DATA_FILTER = new DataFilterExtension({ filterSize: 1 });

/** Extra props on the point layers for the download speed filter. */
type FilterProps = Pick<DataFilterExtensionProps, "filterRange"> & {
  getFilterValue: arrow.Data<arrow.Float32>;
};

const numberFormat = new Intl.NumberFormat("en-US");

function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

/**
 * Parquet file to load. A `?url=` query parameter overrides Ookla's S3 URL,
 * e.g. to serve a local copy of the same file when the network is slow.
 */
const PARQUET_URL =
  new URLSearchParams(window.location.search).get("url") ?? OOKLA_URL;

function getTooltip({ object }: PickingInfo) {
  if (!object) {
    return null;
  }
  const download = Number(object.avg_d_kbps) / 1000;
  return { text: `Download: ${download.toFixed(1)} Mbps` };
}

export default function App() {
  const [fileInfo, setFileInfo] = useState<OoklaFileInfo | null>(null);
  const [batches, setBatches] = useState<SpeedBatch[]>([]);
  const [loadSeconds, setLoadSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speedSlider, setSpeedSlider] = useState<[number, number]>([
    SLIDER_LOG_MIN,
    SLIDER_LOG_MAX,
  ]);
  const minMbps = sliderMbps(speedSlider[0]);
  const maxMbps = sliderMbps(speedSlider[1]);

  useEffect(() => {
    const controller = new AbortController();
    const start = performance.now();
    setBatches([]);
    setLoadSeconds(null);
    loadOokla({
      url: PARQUET_URL,
      signal: controller.signal,
      onFileInfo: setFileInfo,
      onBatch: (batch) => setBatches((prev) => [...prev, batch]),
    })
      .then(() => {
        if (!controller.signal.aborted) {
          setLoadSeconds((performance.now() - start) / 1000);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setError(String(err));
        }
      });
    return () => controller.abort();
  }, []);

  const cogLayer = new COGLayer({
    id: "eox-cloudless",
    geotiff: EOX_CLOUDLESS_URL,
    // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
    // doesn't know about it.
    beforeId: BEFORE_ID,
  });

  const filterRange: [number, number] = [
    minMbps ?? 0,
    // Number.MAX_VALUE would overflow the float32 GPU uniform.
    maxMbps ?? 1e9,
  ];

  const pointLayers = batches.map(
    ({ batch, positions, colors, downloadMbps }, i) =>
      new GeoArrowScatterplotLayer<FilterProps>({
        id: `ookla-points-${i}`,
        data: batch,
        // geoarrow-js's types only model interleaved coordinates, but its
        // `isPointData` (and so this layer) also accepts separated ones.
        getPosition:
          positions as unknown as GeoArrowScatterplotLayerProps["getPosition"],
        getFillColor: colors,
        getFilterValue: downloadMbps,
        filterRange,
        extensions: [DATA_FILTER],
        // Ookla tiles are zoom-16 web mercator tiles, ~600 m across.
        getRadius: 300,
        radiusUnits: "meters",
        radiusMinPixels: 1,
        pickable: true,
        // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
        // doesn't know about it.
        beforeId: BEFORE_ID,
      }),
  );

  const numLoaded = batches.reduce((sum, { batch }) => sum + batch.numRows, 0);
  const isLoading = loadSeconds === null && error === null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        initialViewState={{
          longitude: 10,
          latitude: 25,
          zoom: 1.8,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={[cogLayer, ...pointLayers]}
          widgets={[new LoadingWidget(loadingWidgetProps)]}
          getTooltip={getTooltip}
          interleaved
        />
      </MaplibreMap>

      <ControlPanel
        title={
          <>
            GeoArrow Overlay{" "}
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
        sourcePath="examples/experimental/geoarrow-overlay"
      >
        <Stack gap="3">
          <Text color="gray.600">
            Global mobile network speeds as millions of{" "}
            <ExternalLink href="https://github.com/geoarrow/deck.gl-geoarrow">
              deck.gl-geoarrow
            </ExternalLink>{" "}
            points, over a{" "}
            <ExternalLink href="https://cogeo.org">
              Cloud-Optimized GeoTIFF
            </ExternalLink>{" "}
            of global imagery rendered by deck.gl-raster.
          </Text>

          <Text fontSize="sm" color="gray.600">
            The points stream straight from Ookla's own Parquet file (
            {PARQUET_URL === OOKLA_URL ? "on S3" : "a local copy"}) with{" "}
            <ExternalLink href="https://github.com/kylebarron/parquet-wasm">
              parquet-wasm
            </ExternalLink>
            {fileInfo
              ? `, which reads only ${fileInfo.numColumnsRead} of its ${fileInfo.numColumns} columns: ${formatMegabytes(fileInfo.bytesToRead)} of the ${formatMegabytes(fileInfo.totalBytes)} file.`
              : "."}
          </Text>

          <Text fontSize="sm" fontWeight="medium">
            {error
              ? `Failed to load points: ${error}`
              : fileInfo
                ? `${numberFormat.format(numLoaded)} of ${numberFormat.format(fileInfo.numRows)} points loaded${
                    loadSeconds === null
                      ? "…"
                      : ` in ${loadSeconds.toFixed(1)} s`
                  }`
                : "Opening Parquet file…"}
          </Text>

          {fileInfo ? (
            // Highlighted while the points download, since that's when the
            // file layout is felt.
            <Box
              p="2"
              fontSize="xs"
              borderLeftWidth="3px"
              borderRadius="sm"
              color={isLoading ? "orange.900" : "gray.700"}
              bg={isLoading ? "orange.50" : "gray.50"}
              borderColor={isLoading ? "orange.400" : "gray.300"}
            >
              Ookla's file isn't chunked for visualization: its{" "}
              {numberFormat.format(fileInfo.numRows)} rows sit in just{" "}
              {fileInfo.numRowGroups} row groups of up to{" "}
              {numberFormat.format(fileInfo.maxRowGroupRows)} rows, each
              covering a large part of the world. Nothing can be drawn until a
              whole row group (up to{" "}
              {formatMegabytes(fileInfo.maxRowGroupBytesToRead)}) has
              downloaded, and there's no way to fetch only the area in view.
              Smaller, spatially sorted row groups would let points stream in
              progressively.
            </Box>
          ) : null}

          <Field
            label={`Download speed: ${minMbps === null ? "0" : formatMbps(minMbps)}–${
              maxMbps === null
                ? `${10 ** SLIDER_LOG_MAX}+`
                : formatMbps(maxMbps)
            } Mbps`}
            helperText="Log scale. Filtered on the GPU with DataFilterExtension."
          >
            <RangeSlider
              min={SLIDER_LOG_MIN}
              max={SLIDER_LOG_MAX}
              step={SLIDER_LOG_STEP}
              value={speedSlider}
              onChange={setSpeedSlider}
              thumbLabels={["Minimum speed", "Maximum speed"]}
            />
          </Field>

          <Box>
            <Box
              h="3"
              borderRadius="sm"
              style={{ background: SPEED_GRADIENT_CSS }}
            />
            <Flex justify="space-between" fontSize="xs" color="gray.600" mt="1">
              <span>≤{SPEED_COLOR_DOMAIN_MBPS[0]} Mbps</span>
              <span>Download speed (log scale)</span>
              <span>{SPEED_COLOR_DOMAIN_MBPS[1]}+ Mbps</span>
            </Flex>
          </Box>

          <Text fontSize="xs" color="gray.600">
            <ExternalLink href="https://github.com/teamookla/ookla-open-data">
              Speedtest® by Ookla® Global Mobile Network Performance Maps
            </ExternalLink>
            , Q2 2026, licensed under{" "}
            <ExternalLink href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              CC BY-NC-SA 4.0
            </ExternalLink>
            .{" "}
            <ExternalLink href="https://cloudless.eox.at">
              EOxCloudless 2024
            </ExternalLink>{" "}
            by EOX IT Services GmbH (contains modified Copernicus Sentinel data
            2024), licensed under{" "}
            <ExternalLink href="https://creativecommons.org/licenses/by-nc-sa/4.0/">
              CC BY-NC-SA 4.0
            </ExternalLink>
            .
          </Text>
        </Stack>
      </ControlPanel>
    </div>
  );
}
