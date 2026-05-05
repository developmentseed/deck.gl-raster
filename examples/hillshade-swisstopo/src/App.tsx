import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import loadEPSG from "@developmentseed/epsg/all";
import { parseWkt } from "@developmentseed/proj";
import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { HillshadeTileData } from "./hillshade.js";
import {
  getFloatDemTileData,
  renderDemElevationColor,
  renderSwissHillshade,
} from "./hillshade.js";
import type { RenderMode } from "./ui/control-panel.js";
import { ControlPanel } from "./ui/control-panel.js";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const MATTERHORN_DEM =
  "https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2024_2616-1092/swissalti3d_2024_2616-1092_2_2056_5728.tif";

async function localEpsgResolver(epsg: number) {
  const definitions = await loadEPSG();
  const wkt = definitions.get(epsg);
  if (!wkt) {
    throw new Error(`Missing EPSG definition ${epsg}`);
  }
  return parseWkt(wkt);
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("hillshade");
  const [azimuth, setAzimuth] = useState(315);
  const [altitude, setAltitude] = useState(42);
  const [zFactor, setZFactor] = useState(1.65);
  const [tintStrength, setTintStrength] = useState(0.52);
  const [shadowStrength, setShadowStrength] = useState(0.78);
  const [contourStrength, setContourStrength] = useState(0.28);

  const layer = useMemo(
    () =>
      new COGLayer<HillshadeTileData>({
        id: "swisstopo-hillshade",
        geotiff: MATTERHORN_DEM,
        epsgResolver: localEpsgResolver,
        getTileData: getFloatDemTileData,
        renderTile: (tileData) => {
          const elevationRange = {
            elevationMin: 3000,
            elevationMax: 4200,
          };

          if (renderMode === "dem") {
            return renderDemElevationColor(tileData, elevationRange);
          }

          return renderSwissHillshade(tileData, {
            pixelSizeMeters: 2,
            azimuth,
            altitude,
            zFactor,
            ...elevationRange,
            tintStrength,
            shadowStrength,
            contourStrength,
          });
        },
        tileSize: 256,
        maxZoom: 18,
        onGeoTIFFLoad: (_tiff, options) => {
          const { west, south, east, north } = options.geographicBounds;
          mapRef.current?.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            {
              padding: 96,
              duration: 900,
            },
          );
        },
      }),
    [
      altitude,
      azimuth,
      contourStrength,
      renderMode,
      shadowStrength,
      tintStrength,
      zFactor,
    ],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: 7.6525,
          latitude: 45.985,
          zoom: 13.2,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json"
      >
        <DeckGLOverlay layers={[layer]} interleaved />
      </MaplibreMap>

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1000,
        }}
      >
        <ControlPanel
          renderMode={renderMode}
          azimuth={azimuth}
          altitude={altitude}
          zFactor={zFactor}
          tintStrength={tintStrength}
          shadowStrength={shadowStrength}
          contourStrength={contourStrength}
          onRenderModeChange={setRenderMode}
          onAzimuthChange={setAzimuth}
          onAltitudeChange={setAltitude}
          onZFactorChange={setZFactor}
          onTintStrengthChange={setTintStrength}
          onShadowStrengthChange={setShadowStrength}
          onContourStrengthChange={setContourStrength}
        />
      </div>
    </div>
  );
}
