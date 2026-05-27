import { Text } from "@chakra-ui/react";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import {
  ControlPanel,
  DeckGlOverlay,
  ExternalLink,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type * as zarr from "zarrita";
import type { NldasTileData } from "./nldas/get-tile-data.js";
import { getTileData } from "./nldas/get-tile-data.js";
import {
  COLORMAP_REVERSED,
  NLDAS_GEOZARR_ATTRS,
  NODATA_VALUE,
  RESCALE_MAX,
  RESCALE_MIN,
  SURFACE_TEMP_COLORMAP_INDEX,
  TIME_DIM,
  TIME_INDEX,
} from "./nldas/metadata.js";
import { makeRenderTile } from "./nldas/render-tile.js";
import { openSurfaceTemp } from "./nldas/store.js";

// Keyless CARTO basemap; light background reads well under a data overlay.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// [[Min longitude, min latitude], [max longitude, max latitude]]
const DATA_BOUNDS: [[number, number], [number, number]] = [
  [-180, -20],
  [-20, 80],
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  // Open the icechunk store + surface temperature array once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await openSurfaceTemp();
      if (!cancelled) {
        setArr(opened);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Decode the shipped colormap sprite once (no GPU device needed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resp = await fetch(colormapsPngUrl);
      const bytes = await resp.arrayBuffer();
      const image = await decodeColormapSprite(bytes);
      if (!cancelled) {
        setColormapImage(image);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Upload the colormap sprite once both the Device and the decoded image exist.
  useEffect(() => {
    if (!device || !colormapImage) {
      return;
    }
    setColormapTexture(createColormapTexture(device, colormapImage));
  }, [device, colormapImage]);

  const layers =
    arr && colormapTexture
      ? [
          new ZarrLayer<zarr.Readable, "float32", NldasTileData>({
            id: "nldas-surface-temp",
            node: arr,
            metadata: NLDAS_GEOZARR_ATTRS,
            selection: { [TIME_DIM]: TIME_INDEX },
            getTileData,
            renderTile: makeRenderTile({
              colormapTexture,
              colormapIndex: SURFACE_TEMP_COLORMAP_INDEX,
              colormapReversed: COLORMAP_REVERSED,
              noDataValue: NODATA_VALUE,
              rescaleMin: RESCALE_MIN,
              rescaleMax: RESCALE_MAX,
            }),
            // source bucket supports HTTP/2 multiplexing
            maxRequests: 20,
            maxCacheSize: 20,
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: -98, latitude: 39, zoom: 3.5 }}
        mapStyle={BASEMAP_STYLE}
        maxBounds={DATA_BOUNDS}
      >
        <DeckGlOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
      <ControlPanel
        title="NLDAS-3 + icechunk"
        sourcePath="examples/nldas-icechunk"
      >
        <Text mb="3" color="gray.600">
          Reads NASA's NLDAS-3 daily near-surface air temperature directly from
          a public{" "}
          <ExternalLink href="https://icechunk.io">icechunk</ExternalLink>{" "}
          repository in the browser — no server in between. The store is a{" "}
          <em>virtual</em> Zarr: its chunks reference NLDAS-3 source files in
          the same S3 bucket, read with{" "}
          <ExternalLink href="https://github.com/EarthyScience/icechunk-js">
            icechunk-js
          </ExternalLink>{" "}
          + zarrita and rendered by a <code>ZarrLayer</code>.
        </Text>
        <Text fontSize="xs" color="gray.600">
          Showing a single day (2010-07-16), colorized on the GPU with the
          thermal colormap. Ocean / no-data is left transparent.
        </Text>
      </ControlPanel>
    </div>
  );
}
