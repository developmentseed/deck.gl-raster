import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import type { Device, Texture } from "@luma.gl/core";
import { DeckGlOverlay } from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type * as zarr from "zarrita";
import type { NldasTileData } from "./nldas/get-tile-data.js";
import { getTileData } from "./nldas/get-tile-data.js";
import {
  COLORMAP_INDEX_TAIR,
  COLORMAP_REVERSED,
  NLDAS_GEOZARR_ATTRS,
  NODATA_VALUE,
  RESCALE_MAX,
  RESCALE_MIN,
  TIME_DIM,
  TIME_INDEX,
} from "./nldas/metadata.js";
import { makeRenderTile } from "./nldas/render-tile.js";
import { openNldasTair } from "./nldas/store.js";

// Keyless CARTO basemap; light background reads well under a data overlay.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [arr, setArr] = useState<zarr.Array<"float32", zarr.Readable> | null>(
    null,
  );
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  // Open the icechunk store + Tair array once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const opened = await openNldasTair();
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
            id: "nldas-tair",
            node: arr,
            metadata: NLDAS_GEOZARR_ATTRS,
            selection: { [TIME_DIM]: TIME_INDEX },
            getTileData,
            renderTile: makeRenderTile({
              colormapTexture,
              colormapIndex: COLORMAP_INDEX_TAIR,
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
      >
        <DeckGlOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={setDevice}
        />
      </MaplibreMap>
    </div>
  );
}
