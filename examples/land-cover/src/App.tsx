import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import loadEpsg from "@developmentseed/epsg/all";
import epsgCsvUrl from "@developmentseed/epsg/all.csv.gz?url";
import { parseWkt } from "@developmentseed/proj";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { InfoPanel } from "./components/InfoPanel";
import { UIOverlay } from "./components/UIOverlay";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

/** An example for embedded EPSG code resolution.
 *
 * Since this image is described by a custom Projection in the GeoTIFF keys,
 * this will never actually get called anyways.
 */
async function epsgResolver(epsg: number) {
  const epsgDb = await loadEpsg(epsgCsvUrl);

  const wkt = epsgDb.get(epsg);
  if (!wkt) {
    throw new Error(`EPSG code ${epsg} not found in database`);
  }

  return parseWkt(wkt);
}

const COG_URL =
  "https://s3.us-east-1.amazonaws.com/ds-deck.gl-raster-public/cog/Annual_NLCD_LndCov_2024_CU_C1V1.tif";

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [meshMaxError, setMeshMaxError] = useState(0.125);

  const cog_layer = new COGLayer({
    id: "cog-layer",
    geotiff: COG_URL,
    debug,
    debugOpacity,
    maxError: meshMaxError,
    epsgResolver,
    onGeoTIFFLoad: (tiff, options) => {
      // For debugging
      (window as any).tiff = tiff;
      const { west, south, east, north } = options.geographicBounds;
      mapRef.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: 40,
          duration: 1000,
        },
      );
    },
    // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
    // doesn't know about it.
    beforeId: "aeroway-runway",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={[cog_layer]} interleaved />
      </MaplibreMap>

      <UIOverlay>
        <InfoPanel
          debug={debug}
          debugOpacity={debugOpacity}
          meshMaxError={meshMaxError}
          onDebugChange={setDebug}
          onDebugOpacityChange={setDebugOpacity}
          onMeshMaxErrorChange={setMeshMaxError}
        />
      </UIOverlay>
    </div>
  );
}
