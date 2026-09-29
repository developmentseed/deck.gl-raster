import { Text } from "@chakra-ui/react";
import { PathLayer } from "@deck.gl/layers";
import { MosaicLayer, MultiCOGLayer } from "@developmentseed/deck.gl-geotiff";
import { LinearRescale } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import { GEOMAD_ITEMS } from "./data.js";

// DEP GeoMAD reflectance stretch — uint16 sampled as r16unorm (shader sees
// rawDN / 65535), so the display range needs the same division. This
// item's own STAC raster:bands stats put the red band in [7014, 16807]
// (mean 7682); 7200–12000 matches the reference app's own tuned stretch for
// the same product line.
const RESCALE_MIN = 7200 / 65535;
const RESCALE_MAX = 12000 / 65535;

export default function App() {
  const mosaicLayer = new MosaicLayer({
    id: "geomad-mosaic",
    sources: GEOMAD_ITEMS,
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
            props: { rescaleMin: RESCALE_MIN, rescaleMax: RESCALE_MAX },
          },
        ],
      }),
  });

  // Reference line at the true antimeridian (±180°).
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
        <DeckGlOverlay layers={[mosaicLayer, antimeridianLine]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="Antimeridian: Mosaic + MultiCOG"
        sourcePath="examples/antimeridian-mosaic-multi-example"
      >
        <Text mb="2" color="gray.600">
          Same two DEP GeoMAD items as{" "}
          <ExternalLink href="https://github.com/developmentseed/deck.gl-raster/tree/main/examples/antimeridian-example">
            antimeridian-example
          </ExternalLink>
          , but composed as R/G/B through <code>MosaicLayer</code> +{" "}
          <code>MultiCOGLayer</code> — the shape real usage actually needs,
          not just a single-band <code>COGLayer</code>. See{" "}
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
      </ControlPanel>
    </div>
  );
}
