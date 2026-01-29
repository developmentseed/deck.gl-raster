import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// USGS 10m DEM (zarr-conventions v3, CONUS coverage)
const ZARR_URL =
  "https://carbonplan-share.s3.us-west-2.amazonaws.com/zarr-layer-examples/USGS-CONUS-DEM-10m.zarr";
const VARIABLE = "DEM";
const DIMENSION_INDICES = {}

// ndpyramid 4D (monthly temperature/precipitation, ndpyramid-tiled):
// const ZARR_URL = "https://carbonplan-maps.s3.us-west-2.amazonaws.com/v2/demo/4d/tavg-prec-month";
// const VARIABLE = "climate";
// const  DIMENSION_INDICES = { time: 0, band: 0 }

// ERA5 Hurricane Florence (0-360° longitude convention, single level)
// const ZARR_URL = "https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/hurricanes/era5/florence"
// const VARIABLE = "surface_pressure"
// const DIMENSION_INDICES = { time: 0}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);

  const zarr_layer = new ZarrLayer({
    id: "zarr-layer",
    source: ZARR_URL,
    variable: VARIABLE,
    dimensionIndices: DIMENSION_INDICES,
    normalization: { vmin: 0, vmax: 3000 },
    colormap: (v) => [
      Math.round(v),                    // R: increases with elevation
      Math.round(255 - Math.abs(v - 128) * 2), // G: peaks at mid-elevation
      Math.round(255 - v),              // B: decreases with elevation
      255,
    ],
    debug,
    debugOpacity,
    beforeId: "boundary_country_outline",
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -98,
          latitude: 39,
          zoom: 4,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={[zarr_layer]} interleaved />
      </MaplibreMap>

      {/* UI Overlay Container */}
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
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            maxWidth: "300px",
            pointerEvents: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
            ZarrLayer Example
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
            ERA5 Hurricane Florence - {VARIABLE}
          </p>

          {/* Debug Controls */}
          <div
            style={{
              padding: "12px 0",
              borderTop: "1px solid #eee",
              marginTop: "12px",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "14px",
                cursor: "pointer",
                marginBottom: "12px",
              }}
            >
              <input
                type="checkbox"
                checked={debug}
                onChange={(e) => setDebug(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <span>Show Debug Mesh</span>
            </label>

            {debug && (
              <div style={{ marginTop: "8px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    color: "#666",
                    marginBottom: "4px",
                  }}
                >
                  Debug Opacity: {debugOpacity.toFixed(2)}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={debugOpacity}
                    onChange={(e) =>
                      setDebugOpacity(parseFloat(e.target.value))
                    }
                    style={{ width: "100%", cursor: "pointer" }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
