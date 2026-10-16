import { chakra, NativeSelect, Stack, Text } from "@chakra-ui/react";
import type { MapViewState } from "@deck.gl/core";
import { MapView } from "@deck.gl/core";
import type { TerrainExtensionProps } from "@deck.gl/extensions";
import { _TerrainExtension as TerrainExtension } from "@deck.gl/extensions";
import type { TerrainLayerProps } from "@deck.gl/geo-layers";
import { TerrainLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { LoadingWidget } from "@deck.gl/widgets";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import {
  ControlPanel,
  ExternalLink,
  Field,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

/**
 * Elevation from the Terrain Tiles open dataset on AWS: Terrarium-encoded
 * PNGs in the Web Mercator XYZ grid, which has nothing to do with either COG's
 * own tile grid.
 */
const TERRAIN_TILES_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Terrarium encoding: meters = R * 256 + G + B / 256 - 32768. */
const TERRARIUM_DECODER: TerrainLayerProps["elevationDecoder"] = {
  rScaler: 256,
  gScaler: 1,
  bScaler: 1 / 256,
  offset: -32768,
};

/** Deepest zoom level in the Terrain Tiles dataset. */
const TERRAIN_MAX_ZOOM = 15;

/** Color of the terrain where there's no COG to drape. */
const TERRAIN_COLOR: [number, number, number] = [190, 190, 190];

/**
 * deck.gl's default `MapController` keeps the camera's target at sea level,
 * so the camera gets closer to the ground as you zoom in or tilt, and over
 * high terrain it can end up inside a mountain. Each map caps zoom and pitch
 * to make that rare: zoomed and tilted all the way in over either map's
 * starting point, the camera stays at least 650 m above the ground facing
 * north, east, south or west, in windows 600 to 1100 px tall. Over higher
 * ground it can still end up inside the terrain.
 */
const MAX_PITCH = 65;

const MAP_VIEW = new MapView({ id: "map", controller: true });

/** A COG to drape over the terrain, and a camera that frames it. */
type Dataset = {
  id: string;
  title: string;
  url: string;
  /** Shown under the dataset picker. */
  description: ReactNode;
  /**
   * Lowest and highest terrain elevation under the COG, in meters. The COG
   * selects its tiles for this range of heights instead of for sea level.
   */
  zRange: [number, number];
  initialViewState: MapViewState;
};

const DATASETS: Dataset[] = [
  {
    id: "swiss-map",
    title: "Swiss National Map 1:1 million",
    url: "https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk1000.noscale/swiss-map-raster1000_1000/swiss-map-raster1000_1000_krel_50_2056.tif",
    description: (
      <>
        swisstopo's{" "}
        <ExternalLink href="https://www.swisstopo.admin.ch/en/national-map-1-1-million">
          national map
        </ExternalLink>{" "}
        at 50 m per pixel, in the Swiss LV95 grid (EPSG:2056). © swisstopo
      </>
    ),
    // Sea level to Mont Blanc (4,808 m).
    zRange: [0, 4810],
    initialViewState: {
      longitude: 7.95,
      latitude: 46.6,
      zoom: 10.3,
      pitch: 65,
      bearing: 0,
      maxPitch: MAX_PITCH,
      // See MAX_PITCH. Past this, the 50 m pixels are only magnified anyway.
      maxZoom: 12,
    },
  },
  {
    id: "kanab-point",
    title: "USGS topographic map, Grand Canyon (1962)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    description: (
      <>
        The 1962 Kanab Point, AZ 1:62,500 quadrangle from the USGS{" "}
        <ExternalLink href="https://www.usgs.gov/programs/national-geospatial-program/historical-topographic-maps-preserving-past">
          Historical Topographic Map Collection
        </ExternalLink>
        , at 5.3 m per pixel in a NAD27 polyconic projection.
      </>
    ),
    // The terrain under this quad ranges from about 540 m to 2,060 m.
    zRange: [500, 2100],
    initialViewState: {
      longitude: -112.62,
      latitude: 36.37,
      zoom: 11.8,
      pitch: 60,
      bearing: 20,
      maxPitch: MAX_PITCH,
      // See MAX_PITCH. About where the map's 5.3 m pixels fill screen pixels.
      maxZoom: 13.5,
    },
  },
];

export default function App() {
  const [datasetId, setDatasetId] = useState(DATASETS[0]!.id);
  const dataset = DATASETS.find((d) => d.id === datasetId)!;

  const layers = useMemo(() => {
    const terrain = new TerrainLayer({
      id: "terrain",
      elevationData: TERRAIN_TILES_URL,
      elevationDecoder: TERRARIUM_DECODER,
      maxZoom: TERRAIN_MAX_ZOOM,
      color: TERRAIN_COLOR,
      // Makes this layer the surface that layers with the TerrainExtension
      // are draped over. TerrainLayer doesn't set it by default.
      operation: "terrain+draw",
    });

    // COGLayerProps doesn't include extension props, so these go through a
    // typed variable: an inline object literal fails TypeScript's excess
    // property check on `terrainDrawMode`.
    const cogProps: COGLayerProps & TerrainExtensionProps = {
      id: `cog-${dataset.id}`,
      geotiff: dataset.url,
      extensions: [new TerrainExtension()],
      // Required. Left unset, the extension picks "offset" for
      // deck.gl-raster's mesh layer, which lifts only the reprojection mesh's
      // few vertices onto the terrain, so ridges cut through the image.
      terrainDrawMode: "drape",
      // Without it, tiles are culled as if the ground were at sea level, so
      // tiles the terrain lifts into view near the camera never load.
      zRange: dataset.zRange,
    };

    return [terrain, new COGLayer(cogProps)];
  }, [dataset]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "linear-gradient(#8db6dc, #e3edf6)",
      }}
    >
      <DeckGL
        views={MAP_VIEW}
        initialViewState={dataset.initialViewState}
        layers={layers}
        widgets={[new LoadingWidget(loadingWidgetProps)]}
        // Nothing here is pickable, but deck.gl still picks on every pointer
        // down, and in deck.gl 9.4 its picking pass draws a `terrain+draw`
        // layer that isn't pickable with colors that decode to no layer,
        // logging "Picked non-existent layer". Turn picking off entirely.
        _pickable={false}
      />

      <ControlPanel
        title={
          <>
            COG on Terrain{" "}
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
        sourcePath="examples/experimental/cog-terrain"
      >
        <Stack gap="3">
          <Text color="gray.600">
            A Cloud-Optimized GeoTIFF draped over 3D terrain with deck.gl's
            experimental{" "}
            <ExternalLink href="https://deck.gl/docs/api-reference/extensions/terrain-extension">
              TerrainExtension
            </ExternalLink>
            .
          </Text>

          <Text fontSize="sm" color="gray.600">
            The COG keeps its own projection and tile grid, while the elevation
            comes from Web Mercator terrain tiles. For each terrain tile,
            deck.gl renders the COG into a texture, then drapes that texture
            over the terrain mesh.
          </Text>

          <Field label="COG">
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={dataset.id}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                {DATASETS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>
          <Text fontSize="xs" color="gray.600" mt="-1">
            {dataset.description}
          </Text>

          <Text fontSize="xs" color="gray.600">
            Right-drag, or drag with Shift held, to tilt and rotate the view.
          </Text>

          <Text fontSize="xs" color="gray.600">
            Elevation:{" "}
            <ExternalLink href="https://registry.opendata.aws/terrain-tiles/">
              Terrain Tiles
            </ExternalLink>{" "}
            on AWS (
            <ExternalLink href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">
              attribution
            </ExternalLink>
            ).
          </Text>
        </Stack>
      </ControlPanel>
    </div>
  );
}
