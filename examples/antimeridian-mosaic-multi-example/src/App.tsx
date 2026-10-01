import { Text } from "@chakra-ui/react";
import { PathLayer } from "@deck.gl/layers";
import { MosaicLayer, MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import { LinearRescale } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useState } from "react";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { GeomadItem } from "./data.js";
import { fetchGeomadItems } from "./data.js";

export default function App() {
  const [geomadItems, setGeomadItems] = useState<GeomadItem[]>([]);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.5,
    debugLevel: 1,
  });

  useEffect(() => {
    fetchGeomadItems().then(setGeomadItems);
  }, []);

  const mosaicLayer = new MosaicLayer({
    id: "geomad-mosaic",
    sources: geomadItems,
    renderSource: (source) =>
      new MultiCOGLayer({
        id: `geomad-${source.id}`,
        sources: {
          red: { url: source.assets.red },
          green: { url: source.assets.green },
          blue: { url: source.assets.blue },
        },
        composite: { r: "red", g: "green", b: "blue" },
        renderPipeline: [
          {
            module: LinearRescale,
            props: { rescaleMin: 7200 / 65535, rescaleMax: 12000 / 65535 },
          },
        ],
        debug: debugState.debug,
        debugOpacity: debugState.debugOpacity,
        debugLevel: debugState.debugLevel,
      }),
  });

  // Reference line at the antimeridian (±180°).
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
        <DeckGlOverlay layers={[mosaicLayer, antimeridianLine]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="Antimeridian: Mosaic + MultiCOG"
        sourcePath="examples/antimeridian-mosaic-multi-example"
      >
        <Text mb="2" color="gray.600">
          Digital Earth Pacific GeoMAD composed through `MosaicLayer` +{" "}
          `MultiCOGLayer` (R/G/B band composite).
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
