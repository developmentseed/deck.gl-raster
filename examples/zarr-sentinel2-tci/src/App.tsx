import { Text } from "@chakra-ui/react";
import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import * as zarr from "zarrita";

// Currently generated locally from
// https://github.com/developmentseed/geozarr-examples/pull/36
const ZARR_URL = "http://localhost:8080/TCI.zarr";

type SentinelTileData = MinimalTileData & {
  image: ImageData;
};

/**
 * Fetch one spatial chunk as an RGBA ImageData ready to upload as a texture.
 */
async function getTileData(
  arr: zarr.Array<zarr.DataType, zarr.Readable>,
  options: GetTileDataOptions,
): Promise<SentinelTileData> {
  const result = await zarr.get(
    arr as zarr.Array<zarr.NumberDataType, zarr.Readable>,
    options.sliceSpec,
    { signal: options.signal },
  );
  const image = toImageData(result, options.width, options.height);
  return {
    image,
    width: options.width,
    height: options.height,
    byteLength: image.data.byteLength,
  };
}

function renderTile(data: SentinelTileData) {
  return { image: data.image };
}

/**
 * Convert a band-planar zarr result to an RGBA ImageData.
 *
 * Supports:
 *  - shape `[3, H, W]` → RGB (alpha = 255)
 *  - shape `[1, H, W]` → grayscale (R=G=B, alpha = 255)
 *  - shape `[H, W]`    → grayscale (R=G=B, alpha = 255)
 */
function toImageData(
  result: zarr.Chunk<zarr.NumberDataType>,
  width: number,
  height: number,
): ImageData {
  const { data, shape } = result;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const numBands = shape.length >= 3 ? shape[shape.length - 3]! : 1;
  const pixelCount = width * height;

  if (numBands >= 3) {
    const rOffset = 0;
    const gOffset = pixelCount;
    const bOffset = pixelCount * 2;
    for (let i = 0; i < pixelCount; i++) {
      rgba[i * 4 + 0] = data[rOffset + i]!;
      rgba[i * 4 + 1] = data[gOffset + i]!;
      rgba[i * 4 + 2] = data[bOffset + i]!;
      rgba[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      const v = data[i]!;
      rgba[i * 4 + 0] = v;
      rgba[i * 4 + 1] = v;
      rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
    }
  }

  return new ImageData(rgba, width, height);
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });
  const [node, setNode] = useState<zarr.Group<zarr.Readable> | null>(null);

  // Open the store ourselves so we own version/consolidation decisions,
  // then hand the Group to the layer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = new zarr.FetchStore(ZARR_URL);
      const group = await zarr.open(store, { kind: "group" });
      if (cancelled) {
        return;
      }
      setNode(group);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const zarrLayer = node
    ? new ZarrLayer<zarr.Readable, zarr.DataType, SentinelTileData>({
        id: "zarr-layer",
        node,
        // Keep all 3 bands; `toImageData` consumes the band-planar RGB and
        // packs it into RGBA ImageData.
        selection: { band: null },
        getTileData,
        renderTile,
        debug: debugState.debug,
        debugOpacity: debugState.debugOpacity,
      })
    : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -74,
          latitude: 41,
          zoom: 8.5,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay layers={zarrLayer ? [zarrLayer] : []} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="ZarrLayer — Sentinel-2 TCI"
        sourcePath="examples/zarr-sentinel2-tci"
      >
        <Text mb="3" color="gray.600">
          GeoZarr multiscale, EPSG:32612.
        </Text>
        <DebugControls
          label="Debug mesh"
          value={debugState}
          onChange={setDebugState}
        />
      </ControlPanel>
    </div>
  );
}
