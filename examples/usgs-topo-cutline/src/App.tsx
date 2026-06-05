import { Checkbox, Code, NativeSelect, Text } from "@chakra-ui/react";
import { WebMercatorViewport } from "@deck.gl/core";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type {
  RasterModule,
  RenderTileResult,
} from "@developmentseed/deck.gl-raster";
import {
  CreateTexture,
  CutlineBbox,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Texture } from "@luma.gl/core";
import {
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
  Field,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { GetTileDataOptions } from "../../../packages/deck.gl-geotiff/dist/cog-layer.js";

// A viewport is only needed for its (zoom-independent) lng/lat → common-space
// projection; any instance works. CutlineBbox expects its bbox in common
// space, and `getUniforms` runs every frame — so we project the static quad
// bboxes once here at module load, not per render.
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
 * it to common space once at module load so the per-frame shader uniform
 * update is a trivial pass-through.
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

type TextureDataT = {
  height: number;
  width: number;
  texture: Texture;
};

/**
 * Pad an RGB Uint8 buffer to RGBA by filling alpha with 255. WebGL2 has no
 * rgb8unorm format, so we have to inflate.
 */
function rgbToRgba(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Minimal tile loader for a 3-band uint8 RGB JPEG-compressed COG (the shape
 * USGS HTMC GeoTIFFs use). Decoder converts YCbCr JPEG → RGB bytes via the
 * browser's image decoder; we pad to RGBA here for WebGL2.
 */
async function getTileData(
  image: GeoTIFF | Overview,
  options: GetTileDataOptions,
): Promise<TextureDataT> {
  const { device, x, y, signal, pool } = options;
  const tile = await image.fetchTile(x, y, { signal, pool, boundless: false });
  const { array } = tile;

  if (array.layout === "band-separate") {
    throw new Error("USGS topo tiles are pixel interleaved");
  }

  const { width, height, data } = array;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    throw new Error("USGS topo tiles should decode to uint8");
  }

  const rgba =
    data.length === width * height * 3
      ? rgbToRgba(data, width, height)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const texture = device.createTexture({
    data: rgba,
    format: "rgba8unorm",
    width,
    height,
  });

  return { texture, width, height };
}

/**
 * Explicit two-module render pipeline: upload the tile texture, then
 * (optionally) discard fragments outside the USGS quad's WGS84 bbox.
 */
function renderTile(
  tileData: TextureDataT,
  cutlineEnabled: boolean,
  bbox: [number, number, number, number],
): RenderTileResult {
  const { texture } = tileData;
  const renderPipeline: RasterModule[] = [
    { module: CreateTexture, props: { textureName: texture } },
  ];
  if (cutlineEnabled) {
    renderPipeline.push({
      module: CutlineBbox,
      props: { bbox },
    });
  }
  return { renderPipeline };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [cutlineEnabled, setCutlineEnabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = TOPO_OPTIONS[selectedIndex]!;

  const layer = new COGLayer<TextureDataT>({
    id: `usgs-topo-${selectedIndex}`,
    geotiff: selected.url,
    getTileData,
    renderTile: (data) => renderTile(data, cutlineEnabled, selected.bbox),
    onTileUnload: (tile) => tile.content?.texture.destroy(),
    onGeoTIFFLoad: (_tiff, options) => {
      const { west, south, east, north } = options.geographicBounds;
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
        <DeckGlOverlay layers={[layer]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="USGS Topographic Maps"
        sourcePath="examples/usgs-topo-cutline"
      >
        <Text mb="3" color="gray.600">
          Uses the{" "}
          <ExternalLink href="https://developmentseed.org/deck.gl-raster/api/deck-gl-raster-gpu-modules/variables/CutlineBbox/">
            <Code>CutlineBbox</Code>
          </ExternalLink>{" "}
          shader module to avoid rendering pixels containing the map collar.
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
