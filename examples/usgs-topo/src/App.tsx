import { Checkbox, Code, NativeSelect, Text } from "@chakra-ui/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { ClipExtension } from "@deck.gl/extensions";
import { LoadingWidget } from "@deck.gl/widgets";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
  Field,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

// A viewport is only needed for its (zoom-independent) lng/lat → common-space
// projection; any instance works. ClipExtension expects `clipBounds` in common
// space for this layer, so we project the static quad bboxes once here at
// module load, not per render.
const PROJECTION_VIEWPORT = new WebMercatorViewport({ width: 1, height: 1 });

/**
 * Project a WGS84 lng/lat bbox `[west, south, east, north]` to a deck.gl
 * common-space bbox `[minX, minY, maxX, maxY]`. USGS quads always have
 * `east > west` and `north > south`, and Mercator is monotonic in both axes,
 * so we can pack the two corner points directly.
 */
function commonSpaceBbox(
  west: number,
  south: number,
  east: number,
  north: number,
): [number, number, number, number] {
  const [minX, minY] = PROJECTION_VIEWPORT.projectPosition([west, south]);
  const [maxX, maxY] = PROJECTION_VIEWPORT.projectPosition([east, north]);
  return [minX, minY, maxX, maxY];
}

/**
 * One USGS historical topo quad to render. The WGS84 data area comes from
 * the HTMC metadata CSV (`westbc`, `southbc`, `eastbc`, `northbc`); we project
 * it to common space once at module load so the layer's `clipBounds` prop
 * stays the same across renders.
 */
type TopoOption = {
  title: string;
  url: string;
  /** deck.gl common-space bbox, packed as `[minX, minY, maxX, maxY]`. */
  bbox: [number, number, number, number];
};

const TOPO_OPTIONS: TopoOption[] = [
  {
    title: "Emigrant Gap, CA (1955, 1:62,500)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CA/CA_Emigrant%20Gap_297419_1955_62500_geo.tif",
    bbox: commonSpaceBbox(-120.75, 39.25, -120.5, 39.5),
  },
  {
    title: "Moab, UT (1885, 1:250,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/UT/UT_La%20Sal_250205_1885_250000_geo.tif",
    bbox: commonSpaceBbox(-110.0, 38.0, -109.0, 39.0),
  },
  {
    title: "Mount St Helens, WA (1919, 1:125,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/WA/WA_Mount%20St%20Helens_242547_1919_125000_geo.tif",
    bbox: commonSpaceBbox(-122.5, 46.0, -122.0, 46.5),
  },
  {
    title: "Estes Park, CO (1961, 1:24,000)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CO/CO_Estes%20Park_466919_1961_24000_geo.tif",
    bbox: commonSpaceBbox(-105.625, 40.375, -105.5, 40.5),
  },
  {
    title: "Kanab Point, AZ (1962, 1:62,500)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    bbox: commonSpaceBbox(-112.75, 36.25, -112.5, 36.5),
  },
];

/** One shared instance, so re-rendering doesn't swap in a new extension. */
const CLIP_EXTENSION = new ClipExtension();

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [cutlineEnabled, setCutlineEnabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = TOPO_OPTIONS[selectedIndex]!;

  const layer = new COGLayer({
    id: `usgs-topo-${selectedIndex}`,
    geotiff: selected.url,
    // Discard fragments outside the USGS quad's data area.
    extensions: cutlineEnabled ? [CLIP_EXTENSION] : [],
    // @ts-expect-error clipBounds + clipByInstance are injected by
    // ClipExtension; LayerProps doesn't know about extension-injected props.
    clipBounds: selected.bbox,
    // Force per-pixel clipping. ClipExtension's auto-detect sees
    // `instancePositions` on the underlying SimpleMeshLayer and defaults to
    // vertex-shader mode, which cuts along a coarse per-triangle isoline.
    clipByInstance: false,
    onSourceLoad: (source) => {
      const { west, south, east, north } = source.geographicBounds;
      mapRef.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 1000 },
      );
    },
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -120.625,
          latitude: 39.375,
          zoom: 11,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={[layer]}
          widgets={[new LoadingWidget(loadingWidgetProps)]}
          interleaved
        />
      </MaplibreMap>

      <ControlPanel
        title="USGS Topographic Maps"
        sourcePath="examples/usgs-topo"
      >
        <Text mb="3" color="gray.600">
          Uses the deck.gl{" "}
          <ExternalLink href="https://deck.gl/docs/api-reference/extensions/clip-extension">
            <Code>ClipExtension</Code>
          </ExternalLink>{" "}
          to avoid rendering the map collar.
        </Text>
        <Field label="Topographic map">
          <NativeSelect.Root>
            <NativeSelect.Field
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {TOPO_OPTIONS.map((opt, i) => (
                <option key={opt.url} value={i}>
                  {opt.title}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>
        <Checkbox.Root
          mt="3"
          checked={cutlineEnabled}
          onCheckedChange={(details) =>
            setCutlineEnabled(details.checked === true)
          }
        >
          <Checkbox.HiddenInput />
          <Checkbox.Control />
          <Checkbox.Label>Discard map collar</Checkbox.Label>
        </Checkbox.Root>
      </ControlPanel>
    </div>
  );
}
