import { _GlobeView as GlobeView } from "@deck.gl/core";
import { DeckGL } from "@deck.gl/react";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { useState } from "react";

// New Zealand imagery (NZTM2000 projection)
const COG_URL =
  "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff";

// Antarctic sea ice (polar stereographic)
// const COG_URL =
//   "https://data.source.coop/ausantarctic/ghrsst-mur-v2/2020/12/12/20201212090000-JPL-L4_GHRSST-SSTfnd-MUR-GLOB-v02.0-fv04.1_sea_ice_fraction.tif";

const INITIAL_VIEW_STATE = {
  longitude: 170,
  latitude: -42,
  zoom: 3,
};

export default function App() {
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);

  const layers = [
    // Dark background sphere
    new SolidPolygonLayer({
      id: "background",
      data: [
        [
          [-180, 90],
          [0, 90],
          [180, 90],
          [180, -90],
          [0, -90],
          [-180, -90],
        ],
      ],
      getPolygon: (d) => d,
      stroked: false,
      filled: true,
      getFillColor: [10, 20, 40],
    }),
    new COGLayer({
      id: "cog-layer",
      geotiff: COG_URL,
      debug,
      debugOpacity,
    }),
  ];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <DeckGL
        views={new GlobeView()}
        initialViewState={INITIAL_VIEW_STATE}
        controller={true}
        layers={layers}
      />

      {/* UI Controls */}
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
          zIndex: 1000,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
          COGLayer Globe View
        </h3>
        <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
          Displaying COG imagery on a 3D globe
        </p>

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
  );
}
