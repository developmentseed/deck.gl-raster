import { Text } from "@chakra-ui/react";
import { PathLayer } from "@deck.gl/layers";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
  fetchStacGeoparquetItems,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import { getTileDataGray, renderGray } from "./render-gray.js";

// Every item in the DEP Landsat GeoMAD test catalog (EPSG:3832 / PDC
// Mercator), shown together as they are — no reprojection-hiding fitBounds.
// The 3 items at column `066` cross the antimeridian (GeoJSON-flipped corner
// lngs: xmin 179.97 → xmax −179.17); the other 9 don't, for comparison.
const PARQUET_URL =
  "https://s3.us-west-2.amazonaws.com/dep-public-staging/dep_ls_geomad/0-3-1-test/dep_ls_geomad.parquet";

export default function App() {
  const [redBandUrls, setRedBandUrls] = useState<string[]>([]);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: true,
    debugOpacity: 0.25,
  });

  useEffect(() => {
    fetchStacGeoparquetItems(PARQUET_URL).then((items) =>
      setRedBandUrls(items.map((item) => item.assets.red!.href)),
    );
  }, []);

  const layers = redBandUrls.map(
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

  // Reference line at the true antimeridian (±180°), for eyeballing whether
  // the split pieces line up with it.
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
          All {redBandUrls.length || 12}{" "}
          <ExternalLink href="https://cogeo.org">COGs</ExternalLink> in the test
          catalog: 3 cross the ±180° antimeridian, the other 9 don't — see{" "}
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
