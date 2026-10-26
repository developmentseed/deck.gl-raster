import { chakra, NativeSelect, Slider, Stack, Text } from "@chakra-ui/react";
import type { MapViewState } from "@deck.gl/core";
import { MapView, TerrainController, WebMercatorViewport } from "@deck.gl/core";
import type { TerrainExtensionProps } from "@deck.gl/extensions";
import {
  ClipExtension,
  _TerrainExtension as TerrainExtension,
} from "@deck.gl/extensions";
import type { TerrainLayerProps } from "@deck.gl/geo-layers";
import { TerrainLayer } from "@deck.gl/geo-layers";
import DeckGL from "@deck.gl/react";
import { LoadingWidget } from "@deck.gl/widgets";
import type { COGLayerProps } from "@developmentseed/deck.gl-geotiff";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { lngLatToWorld, worldToLngLat } from "@math.gl/web-mercator";
import {
  ControlPanel,
  ExternalLink,
  Field,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { NaipTileData } from "./naip.js";
import {
  NAIP_FALSE_COLOR_TILE_PROPS,
  NAIP_PIKES_PEAK_URLS,
  NAIP_TILE_PROPS,
} from "./naip.js";

/**
 * Elevation from the Terrain Tiles open dataset on AWS: Terrarium-encoded
 * PNGs in the Web Mercator XYZ grid, which has nothing to do with the COGs'
 * own tile grids.
 */
const TERRAIN_TILES_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Deepest zoom level in the Terrain Tiles dataset. */
const TERRAIN_MAX_ZOOM = 15;

/** Color of the terrain where there's no COG to drape. */
const TERRAIN_COLOR: [number, number, number] = [190, 190, 190];

/**
 * Terrarium decoding, meters = R * 256 + G + B / 256 - 32768, with elevations
 * multiplied by `exaggeration`.
 */
function terrariumDecoder(
  exaggeration: number,
): TerrainLayerProps["elevationDecoder"] {
  return {
    rScaler: 256 * exaggeration,
    gScaler: exaggeration,
    bScaler: exaggeration / 256,
    offset: -32768 * exaggeration,
  };
}

/** Vertical exaggeration at startup. */
const DEFAULT_EXAGGERATION = 1.5;

/**
 * `TerrainController` moves the camera's target toward the ground under the
 * center of the view as you move, so the camera rises and falls with the
 * terrain. A steep pitch can still put it inside a nearby ridge, so pitch
 * stops at 70 degrees. That's above deck.gl's default of 60, which would clamp
 * the Swiss view's 65-degree start.
 */
const MAX_PITCH = 70;

/** One or more COGs to drape over the terrain, and where to start the camera. */
type RasterDataset = {
  id: string;
  title: string;
  /** The COGs, each drawn by its own COGLayer. */
  urls: string[];
  /** Shown under the dataset picker. */
  description: ReactNode;
  initialViewState: MapViewState;
  /**
   * Tile loading and rendering for COGs that COGLayer's default pipeline
   * draws wrong, like NAIP's four bands.
   */
  tileProps?: typeof NAIP_TILE_PROPS;
};

/** The camera for both NAIP options. */
const NAIP_INITIAL_VIEW_STATE: MapViewState = {
  // Looking west at Pikes Peak's east face. TerrainController's first pick
  // moves the target up to the ground and zooms in to keep the camera in
  // place. At the default exaggeration, this start keeps that zoom under
  // maxZoom, past which the camera would jump back, in windows at least
  // 630 px tall, and keeps the whole view inside the images in windows up to
  // 1760x1100.
  longitude: -105.08,
  latitude: 38.84,
  zoom: 12.4,
  pitch: 35,
  bearing: -90,
  // COGLayer picks every tile's resolution for the zoom at the center of the
  // view, however far away the tile is, so a tilted view loads tiles at the
  // center's resolution out to the horizon. Each zoom level past 15 about
  // triples the number of NAIP tiles it loads (over 2,000 at zoom 17), and a
  // device pixel ratio of 2 asks for one level finer still. These caps keep
  // it to a few hundred tiles.
  maxPitch: 60,
  maxZoom: 14,
};

const RASTER_DATASETS: RasterDataset[] = [
  {
    id: "naip-pikes-peak",
    title: "NAIP aerial imagery, Pikes Peak (2023)",
    urls: NAIP_PIKES_PEAK_URLS,
    tileProps: NAIP_TILE_PROPS,
    description: (
      <>
        Nine 30 cm{" "}
        <ExternalLink href="https://planetarycomputer.microsoft.com/dataset/naip">
          NAIP
        </ExternalLink>{" "}
        COGs in UTM zone 13N, one COGLayer each. The{" "}
        <ExternalLink href="https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/">
          NAIP mosaic example
        </ExternalLink>{" "}
        streams 924 of this survey's COGs.
      </>
    ),
    initialViewState: NAIP_INITIAL_VIEW_STATE,
  },
  {
    id: "naip-pikes-peak-false-color",
    title: "NAIP false-color infrared, Pikes Peak (2023)",
    urls: NAIP_PIKES_PEAK_URLS,
    tileProps: NAIP_FALSE_COLOR_TILE_PROPS,
    description: (
      <>
        The same NAIP COGs with near-infrared shown as red, red as green and
        green as blue, so healthy vegetation is bright red.
      </>
    ),
    initialViewState: NAIP_INITIAL_VIEW_STATE,
  },
  {
    id: "swiss-map",
    title: "Swiss National Map 1:1 million",
    urls: [
      "https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk1000.noscale/swiss-map-raster1000_1000/swiss-map-raster1000_1000_krel_50_2056.tif",
    ],
    description: (
      <>
        swisstopo's{" "}
        <ExternalLink href="https://www.swisstopo.admin.ch/en/national-map-1-1-million">
          national map
        </ExternalLink>{" "}
        at 50 m per pixel, in the Swiss LV95 grid (EPSG:2056). © swisstopo
      </>
    ),
    initialViewState: {
      longitude: 7.95,
      latitude: 46.6,
      zoom: 10.3,
      pitch: 65,
      bearing: 0,
      maxPitch: MAX_PITCH,
      // Past this, the 50 m pixels are only magnified.
      maxZoom: 13,
    },
  },
  {
    id: "kanab-point",
    title: "USGS topographic map, Grand Canyon (1962)",
    urls: [
      "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    ],
    description: (
      <>
        The 1962 Kanab Point, AZ 1:62,500 quadrangle from the USGS{" "}
        <ExternalLink href="https://www.usgs.gov/programs/national-geospatial-program/historical-topographic-maps-preserving-past">
          Historical Topographic Map Collection
        </ExternalLink>
        , at 5.3 m per pixel in a NAD27 polyconic projection.
      </>
    ),
    initialViewState: {
      longitude: -112.62,
      latitude: 36.37,
      zoom: 11.8,
      pitch: 60,
      bearing: 20,
      maxPitch: MAX_PITCH,
      // Past this, the 5.3 m pixels are only magnified.
      maxZoom: 15,
    },
  },
];

/** Widen `range` to include `[minZ, maxZ]`, rounded outward to 100 m. */
function widenZRange(
  range: [number, number] | null,
  minZ: number,
  maxZ: number,
): [number, number] {
  // Rounding means most tiles change nothing, so the COGs aren't updated on
  // every terrain tile that loads.
  const low = Math.floor(minZ / 100) * 100;
  const high = Math.ceil(maxZ / 100) * 100;
  if (range && range[0] <= low && range[1] >= high) {
    return range;
  }
  return range
    ? [Math.min(range[0], low), Math.max(range[1], high)]
    : [low, high];
}

/** `[west, south, east, north]`, in degrees. */
type Bounds = [number, number, number, number];

/** The smallest box containing all of `boxes`, or `null` if there are none. */
function unionBounds(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) {
    return null;
  }
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** `bounds` in Web Mercator common space, as `[minX, minY, maxX, maxY]`. */
function toCommonSpace([west, south, east, north]: Bounds): [
  number,
  number,
  number,
  number,
] {
  const [minX, minY] = lngLatToWorld([west, south]);
  const [maxX, maxY] = lngLatToWorld([east, north]);
  return [minX!, minY!, maxX!, maxY!];
}

/**
 * `viewState` with the camera's height above sea level multiplied by `ratio`,
 * looking the same way, as a view whose target is at sea level. A new
 * `TerrainController` then moves the target to the ground it first picks,
 * without moving the camera.
 */
function scaleCameraHeight(
  viewState: MapViewState,
  ratio: number,
): MapViewState {
  // The example's canvas fills the window. The controller's view states carry
  // a size too, but it's stale after a resize until you next move the map.
  const width = window.innerWidth;
  const height = window.innerHeight;
  const viewport = new WebMercatorViewport({ ...viewState, width, height });
  const [x, y, z] = viewport.cameraPosition;
  const pitch = ((viewState.pitch ?? 0) * Math.PI) / 180;
  const bearing = ((viewState.bearing ?? 0) * Math.PI) / 180;
  // From the moved camera to sea level along the center of the view, in Web
  // Mercator common units.
  const distance = (z! * ratio) / Math.cos(pitch);
  const [longitude, latitude] = worldToLngLat([
    x! + Math.sin(bearing) * Math.sin(pitch) * distance,
    y! + Math.cos(bearing) * Math.sin(pitch) * distance,
  ]);
  return {
    ...viewState,
    longitude: longitude!,
    latitude: latitude!,
    // The camera is `altitude` canvas heights from its target, in pixels.
    zoom: Math.log2((viewport.altitude * height) / distance),
    position: [0, 0, 0],
  };
}

export default function App() {
  const [datasetId, setDatasetId] = useState(RASTER_DATASETS[0]!.id);
  const dataset = RASTER_DATASETS.find((d) => d.id === datasetId)!;

  // Options that draw the same COGs, like NAIP in true and false color, share
  // a scene: the same camera and terrain.
  const scene = dataset.urls[0]!;

  // Where the camera starts: a scene's start view, or after an exaggeration
  // change, the current camera, raised if the terrain rose. Each start gets a
  // new view, and so a new TerrainController. The controller moves its target
  // to the ground in one step only on its first pick, and eases it after that,
  // so a reused one would keep the last ground height.
  const [camera, setCamera] = useState({
    key: 0,
    viewState: RASTER_DATASETS[0]!.initialViewState,
  });
  const view = useMemo(
    () =>
      new MapView({
        id: `map-${camera.key}`,
        controller: { type: TerrainController },
      }),
    [camera.key],
  );
  // The camera as it is now, to scale when the exaggeration changes.
  const viewStateRef = useRef<MapViewState>(camera.viewState);
  const startCamera = (viewState: MapViewState) => {
    viewStateRef.current = viewState;
    setCamera((c) => ({ key: c.key + 1, viewState }));
  };

  // The slider position, and the exaggeration applied to the terrain. Each
  // change reloads the terrain tiles, so it's applied when the slider is
  // released.
  const [exaggerationInput, setExaggerationInput] =
    useState(DEFAULT_EXAGGERATION);
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);

  // The lowest and highest elevation in the terrain tiles loaded so far. The
  // COGs select their tiles for this range of heights instead of for sea
  // level. It starts over for a new scene, whose terrain all loads again, and
  // is rescaled for a new exaggeration.
  const [terrainZRange, setTerrainZRange] = useState<[number, number] | null>(
    null,
  );
  const onTerrainTileLoad = useCallback<
    NonNullable<TerrainLayerProps["onTileLoad"]>
  >((tile) => {
    const mesh = tile.content?.[0] as {
      header?: { boundingBox?: [number[], number[]] };
    } | null;
    const boundingBox = mesh?.header?.boundingBox;
    if (boundingBox) {
      const [[, , minZ], [, , maxZ]] = boundingBox;
      setTerrainZRange((range) => widenZRange(range, minZ!, maxZ!));
    }
  }, []);

  // Each COG's WGS84 bounds, reported once its header loads. The terrain only
  // loads tiles that overlap the current dataset's bounds, since there's
  // nothing to drape anywhere else.
  const [cogBounds, setCogBounds] = useState<Record<string, Bounds>>({});
  const terrainExtent = useMemo(
    () =>
      unionBounds(
        dataset.urls.flatMap((url) => (cogBounds[url] ? [cogBounds[url]] : [])),
      ),
    [dataset.urls, cogBounds],
  );

  // TerrainLayer compares these by reference, so make new ones only when they
  // change: a new decoder reloads every terrain tile, and a new clip box
  // re-renders them all. TerrainLayer's meshes are in Web Mercator common
  // space, so the clip box is too.
  const elevationDecoder = useMemo(
    () => terrariumDecoder(exaggeration),
    [exaggeration],
  );
  const clipBounds = useMemo(
    () => terrainExtent && toCommonSpace(terrainExtent),
    [terrainExtent],
  );

  const layers = useMemo(() => {
    // Until a COG reports its bounds, there's no extent to limit the terrain
    // to, so it waits rather than load tiles everywhere in view.
    const terrain =
      terrainExtent &&
      clipBounds &&
      new TerrainLayer({
        // A new layer per scene, so its tiles all load (and report their
        // elevations) again.
        id: `terrain-${scene}`,
        elevationData: TERRAIN_TILES_URL,
        elevationDecoder,
        maxZoom: TERRAIN_MAX_ZOOM,
        extent: terrainExtent,
        // Tiles load whole, so also stop drawing terrain outside the COGs'
        // bounds, by pixel rather than by each tile mesh's anchor.
        extensions: [new ClipExtension()],
        clipBounds,
        clipByInstance: false,
        color: TERRAIN_COLOR,
        // Makes this layer the surface that layers with the TerrainExtension
        // are draped over. TerrainLayer doesn't set it by default.
        operation: "terrain+draw",
        // TerrainController picks the terrain to find the ground's height.
        pickable: true,
        onTileLoad: onTerrainTileLoad,
      });

    const cogs = dataset.urls.map((url) => {
      // COGLayerProps doesn't include extension props, so an inline object
      // literal fails TypeScript's excess property check on
      // `terrainDrawMode`. Build the props separately.
      const props = {
        id: `cog-${url}`,
        geotiff: url,
        extensions: [new TerrainExtension()],
        // Required. Left unset, the extension picks "offset" for
        // deck.gl-raster's mesh layer, which lifts only the reprojection
        // mesh's few vertices onto the terrain, so ridges cut through the
        // image.
        terrainDrawMode: "drape",
        // Without it, tiles are culled as if the ground were at sea level, so
        // tiles the terrain lifts into view near the camera never load.
        zRange: terrainZRange,
        // Re-render the tiles when only their colors change, as between the
        // two NAIP options.
        updateTriggers: { renderTile: dataset.id },
        onSourceLoad: ({ geographicBounds: { west, south, east, north } }) =>
          setCogBounds((bounds) =>
            bounds[url]
              ? bounds
              : { ...bounds, [url]: [west, south, east, north] },
          ),
      } satisfies COGLayerProps & TerrainExtensionProps;
      return dataset.tileProps
        ? new COGLayer<NaipTileData>({ ...props, ...dataset.tileProps })
        : new COGLayer(props);
    });

    return [terrain, ...cogs];
  }, [
    dataset,
    scene,
    elevationDecoder,
    terrainZRange,
    terrainExtent,
    clipBounds,
    onTerrainTileLoad,
  ]);

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
        views={view}
        initialViewState={camera.viewState}
        layers={layers}
        widgets={[new LoadingWidget(loadingWidgetProps)]}
        onViewStateChange={({ viewState }) => {
          viewStateRef.current = viewState as MapViewState;
        }}
      />

      <ControlPanel
        title={
          <>
            Rasters over Terrain{" "}
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
                onChange={(e) => {
                  const next = RASTER_DATASETS.find(
                    (d) => d.id === e.target.value,
                  )!;
                  setDatasetId(next.id);
                  // A new scene starts its camera over, and its terrain loads
                  // again, reporting its elevations as it does. The start
                  // views are set for the default exaggeration.
                  if (next.urls[0] !== scene) {
                    startCamera(next.initialViewState);
                    setTerrainZRange(null);
                    setExaggeration(DEFAULT_EXAGGERATION);
                    setExaggerationInput(DEFAULT_EXAGGERATION);
                  }
                }}
              >
                {RASTER_DATASETS.map((d) => (
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

          <Field label={`Vertical exaggeration: ${exaggerationInput}x`}>
            <Slider.Root
              size="sm"
              width="full"
              min={1}
              max={3}
              step={0.5}
              value={[exaggerationInput]}
              onValueChange={(details) =>
                setExaggerationInput(details.value[0]!)
              }
              onValueChangeEnd={(details) => {
                const value = details.value[0]!;
                if (value !== exaggeration) {
                  const ratio = value / exaggeration;
                  setExaggeration(value);
                  // Every decoded height scales with the exaggeration, so the
                  // measured range does too. Measuring it again would select
                  // tiles for sea level until the terrain reloads.
                  setTerrainZRange(
                    (range) => range && [range[0] * ratio, range[1] * ratio],
                  );
                  // TerrainController moves the camera only as you interact,
                  // so raise the camera with a higher terrain, or the terrain
                  // would rise around it. A lower terrain leaves the camera
                  // where it is: lowered too, the camera would be nearer the
                  // ground, and the new controller could zoom past maxZoom.
                  startCamera(
                    scaleCameraHeight(viewStateRef.current, Math.max(1, ratio)),
                  );
                }
              }}
            >
              <Slider.Control>
                <Slider.Track>
                  <Slider.Range />
                </Slider.Track>
                <Slider.Thumb index={0}>
                  <Slider.HiddenInput />
                </Slider.Thumb>
              </Slider.Control>
            </Slider.Root>
          </Field>

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
