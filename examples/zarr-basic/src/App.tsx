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

interface DatasetConfig {
  name: string;
  description: string;
  url: string;
  variable: string;
  dimensionIndices: Record<string, number>;
  normalization: { vmin: number; vmax: number };
}

const DATASETS: Record<string, DatasetConfig> = {
  "usgs-dem": {
    name: "USGS 10m DEM",
    description: "zarr-conventions for multiscales, CONUS coverage",
    url: "https://carbonplan-share.s3.us-west-2.amazonaws.com/zarr-layer-examples/USGS-CONUS-DEM-10m.zarr",
    variable: "DEM",
    dimensionIndices: {},
    normalization: { vmin: 0, vmax: 3000 },
  },
  "ndpyramid-4d": {
    name: "ndpyramid 4D",
    description: "Monthly temperature/precipitation",
    url: "https://carbonplan-maps.s3.us-west-2.amazonaws.com/v2/demo/4d/tavg-prec-month",
    variable: "climate",
    dimensionIndices: { time: 0, band: 0 },
    normalization: { vmin: -40, vmax: 40 },
  },
  "era5-florence": {
    name: "ERA5 Hurricane Florence",
    description: "0-360° longitude convention, single level",
    url: "https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/hurricanes/era5/florence",
    variable: "surface_pressure",
    dimensionIndices: { time: 0 },
    normalization: { vmin: 100000, vmax: 102500 },
  },
};


export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [selectedDataset, setSelectedDataset] = useState<string>("era5-florence");

  const dataset = DATASETS[selectedDataset];

  const zarr_layer = new ZarrLayer({
    id: `zarr-layer-${selectedDataset}`,
    source: dataset.url,
    variable: dataset.variable,
    dimensionIndices: dataset.dimensionIndices,
    normalization: dataset.normalization,
    colormap: (v) => [
      Math.round(v),
      Math.round(255 - Math.abs(v - 128) * 2),
      Math.round(255 - v),
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
            {dataset.description}
          </p>

          {/* Dataset Selector */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "4px",
              }}
            >
              Dataset
            </label>
            <select
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              {Object.entries(DATASETS).map(([key, config]) => (
                <option key={key} value={key}>
                  {config.name}
                </option>
              ))}
            </select>
          </div>

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
