import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const COG_OPTIONS: { title: string; url: string; attribution?: ReactNode }[] = [
  {
    title: "Sentinel-2 True Color Image (New York, 2026)",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
  },
  {
    title: "New Zealand 2024-2025 10m RGB",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
  },
  {
    title: "NAIP Aerial (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
  },
  {
    title: "NLCD Land Cover 2023",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
  },
  {
    title: "EOxCloudless 2020 RGB",
    url: "https://s2downloads.eox.at/demo/EOxCloudless/2020/rgb_corrected_geodetic/3/0/0.tif",
    attribution: (
      <>
        <a href="https://cloudless.eox.at">
          EOxCloudless - https://cloudless.eox.at
        </a>
        {" (Contains modified Copernicus Sentinel data 2020)"}
      </>
    ),
  },
  // {
  //   title: "Fields of the World — Denmark S2",
  //   url: "https://data.source.coop/kerner-lab/fields-of-the-world/denmark/s2_images/window_a/g22_00002_10.tif",
  // },
  // {
  //   title: "GHRSST Sea Ice Fraction (2020-12-12)",
  //   url: "https://data.source.coop/ausantarctic/ghrsst-mur-v2/2020/12/12/20201212090000-JPL-L4_GHRSST-SSTfnd-MUR-GLOB-v02.0-fv04.1_sea_ice_fraction.tif",
  // },
  // {
  //   title: "Sentinel-2 RGB — Riyadh",
  //   url: "https://data.source.coop/tabaqat/riyadh-sentinel-rgb/Sentinel-2_Satellite_RGB_Riyadh.tif",
  // },
  {
    title: "Anderson Co. Ortho Pan 2ft (2000)",
    url: "https://data.source.coop/giswqs/tn-imagery/imagery/AndersonCo_OrthoPan_2ft_2000.tif",
  },
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(true);

  const cog_layer = new COGLayer({
    id: "cog-layer",
    geotiff: COG_OPTIONS[selectedIndex].url,
    debug,
    debugOpacity,
    onGeoTIFFLoad: (tiff, options) => {
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
    beforeId: "boundary_country_outline",
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
            width: "300px",
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            style={{
              all: "unset",
              width: "100%",
              margin: 0,
              fontSize: "16px",
              fontWeight: "bold",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              userSelect: "none",
            }}
            onClick={() => setPanelOpen((o) => !o)}
          >
            COGLayer Example
            <span
              style={{
                fontSize: "12px",
                transition: "transform 0.2s",
                transform: panelOpen ? "rotate(0deg)" : "rotate(-90deg)",
              }}
            >
              ▼
            </span>
          </button>
          {panelOpen && (
            <>
              <p
                style={{
                  margin: "8px 0 12px 0",
                  fontSize: "13px",
                  color: "#666",
                }}
              >
                Renders Cloud-Optimized GeoTIFFs directly from cloud storage,
                with no server in between.
              </p>
              <p style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
                <a
                  href="https://developmentseed.org/deck.gl-raster/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  deck.gl-raster Documentation ↗
                </a>
              </p>
              <select
                value={selectedIndex}
                onChange={(e) => setSelectedIndex(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "4px",
                  cursor: "pointer",
                }}
              >
                {COG_OPTIONS.map((opt, i) => (
                  <option key={opt.url} value={i}>
                    {opt.title}
                  </option>
                ))}
              </select>

              {/* Attribution */}
              {COG_OPTIONS[selectedIndex].attribution && (
                <p
                  style={{
                    margin: "8px 0 0 0",
                    fontSize: "11px",
                    color: "#666",
                  }}
                >
                  {COG_OPTIONS[selectedIndex].attribution}
                </p>
              )}

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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
