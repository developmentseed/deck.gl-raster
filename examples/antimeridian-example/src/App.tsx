import { Text } from "@chakra-ui/react";
import { PathLayer } from "@deck.gl/layers";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  BlackIsZero,
  CreateTexture,
  LinearRescale,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

// 2 items from the DEP Landsat GeoMAD test catalog (EPSG:3832 / PDC
// Mercator): one crosses the antimeridian (GeoJSON-flipped corner lngs:
// xmin 179.97 → xmax −179.17), the other doesn't, for comparison.
const GEOMAD_BASE_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test";
const CROSSING_RED_URL = `${GEOMAD_BASE_URL}/066/022/2025/dep_ls_geomad_066_022_2025_red.tif`;
const NORMAL_RED_URL = `${GEOMAD_BASE_URL}/065/021/2025/dep_ls_geomad_065_021_2025_red.tif`;

type GrayTileData = {
  texture: Texture;
  width: number;
  height: number;
};

async function getTileDataGray(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<GrayTileData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const { array } = tile;
  if (array.layout === "band-separate") {
    throw new Error("Expected a pixel-interleaved (1-band) COG");
  }
  const { width, height, data } = array;
  const texture = device.createTexture({
    data,
    format: "r16unorm",
    width,
    height,
  });
  return { texture, width, height };
}

function renderGray(data: GrayTileData): RenderTileResult {
  return {
    renderPipeline: [
      { module: CreateTexture, props: { textureName: data.texture } },
      {
        module: LinearRescale,
        props: { rescaleMin: 7200 / 65535, rescaleMax: 12000 / 65535 },
      },
      { module: BlackIsZero },
    ],
  };
}

export default function App() {
  const [debugState, setDebugState] = useState<DebugState>({
    debug: true,
    debugOpacity: 0.25,
  });

  const layers = [CROSSING_RED_URL, NORMAL_RED_URL].map(
    (url) =>
      new COGLayer({
        id: `cog-layer-${url}`,
        geotiff: url,
        getTileData: getTileDataGray,
        renderTile: renderGray,
        debug: debugState.debug,
        debugOpacity: debugState.debugOpacity,
        // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
        // doesn't know about it.
        beforeId: "boundary_country_outline",
      }),
  );

  // Reference line at the true antimeridian (±180°)
  const antimeridianLine = new PathLayer({
    id: "antimeridian-line",
    data: [
      [
        [180, 85],
        [180, -85],
      ],
    ],
    getPath: (d: [number, number][]) => d,
    getColor: [255, 0, 200, 255],
    getWidth: 2,
    widthUnits: "pixels",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        initialViewState={{
          longitude: 180,
          latitude: -16,
          zoom: 5,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay layers={[...layers, antimeridianLine]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="Antimeridian Crossing Example"
        sourcePath="examples/antimeridian-example"
      >
        <Text mb="2" color="gray.600">
          2 <ExternalLink href="https://cogeo.org">COGs</ExternalLink> from the
          DEP Landsat GeoMAD test catalog: one crosses the ±180° antimeridian,
          the other doesn't — see{" "}
          <ExternalLink href="https://github.com/developmentseed/deck.gl-raster/issues/575">
            #575
          </ExternalLink>
          .
        </Text>
        <Text mb="3" fontSize="xs" color="gray.600">
          <ExternalLink href="https://digitalearthpacific.org">
            Digital Earth Pacific
          </ExternalLink>{" "}
          Landsat GeoMAD mosaic.
        </Text>
        <DebugControls value={debugState} onChange={setDebugState} />
      </ControlPanel>
    </div>
  );
}
