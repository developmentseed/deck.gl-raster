import { Text } from "@chakra-ui/react";
import { PathLayer } from "@deck.gl/layers";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
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
import { getTileDataGray, renderGrayWhiteToBlack } from "./render-gray.js";

// Two items from the same DEP Landsat GeoMAD catalog (EPSG:3832 / PDC
// Mercator), shown together as they are — no reprojection-hiding fitBounds.
// `066_022` crosses the antimeridian (GeoJSON-flipped corner lngs: xmin
// 179.97 → xmax −179.17); `064_020` doesn't, for comparison.
const CROSSING_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/066/022/2025/dep_ls_geomad_066_022_2025_red.tif";
const NON_CROSSING_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/064/020/2025/dep_ls_geomad_064_020_2025_red.tif";

export default function App() {
  const [debugState, setDebugState] = useState<DebugState>({
    debug: true,
    debugOpacity: 0.25,
  });

  const layers = [CROSSING_URL, NON_CROSSING_URL].map(
    (url) =>
      new COGLayer({
        id: `cog-layer-${url}`,
        geotiff: url,
        getTileData: getTileDataGray,
        renderTile: renderGrayWhiteToBlack,
        debug: debugState.debug,
        debugOpacity: debugState.debugOpacity,
        // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
        // doesn't know about it.
        beforeId: "boundary_country_outline",
      }),
  );

  // Reference line at the true antimeridian (±180°), for eyeballing whether
  // the split pieces line up with it.
  const antimeridianLine = new PathLayer({
    id: "antimeridian-line",
    data: [
      [
        [180, 80],
        [180, -80],
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
          Two <ExternalLink href="https://cogeo.org">COGs</ExternalLink> from
          the same catalog: one crosses the ±180° antimeridian, one doesn't —
          see{" "}
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
