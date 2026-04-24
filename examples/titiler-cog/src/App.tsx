import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { TilesetDescriptor } from "@developmentseed/deck.gl-raster";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { TileMatrixSet } from "@developmentseed/morecantile";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import type { InfoResponse, TileData } from "./titiler";
import {
  buildDescriptor,
  COG_URL,
  getTileData,
  renderTile,
  TITILER_BASE,
} from "./titiler";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [panelOpen, setPanelOpen] = useState(true);
  const [descriptor, setDescriptor] = useState<TilesetDescriptor | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [infoRes, tmsRes] = await Promise.all([
          fetch(`${TITILER_BASE}/cog/info?url=${encodeURIComponent(COG_URL)}`, {
            signal: controller.signal,
          }),
          fetch(`${TITILER_BASE}/tileMatrixSets/WebMercatorQuad`, {
            signal: controller.signal,
          }),
        ]);
        if (!infoRes.ok) {
          throw new Error(
            `cog/info ${infoRes.status}: ${await infoRes.text()}`,
          );
        }
        if (!tmsRes.ok) {
          throw new Error(
            `tileMatrixSets ${tmsRes.status}: ${await tmsRes.text()}`,
          );
        }
        const info = (await infoRes.json()) as InfoResponse;
        const tms = (await tmsRes.json()) as TileMatrixSet;
        setDescriptor(buildDescriptor(tms));
        const [w, s, e, n] = info.bounds;
        mapRef.current?.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 40, duration: 1000 },
        );
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          return;
        }
        setError((err as Error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  const layers = descriptor
    ? [
        new RasterTileLayer<TileData>({
          id: "titiler-raster",
          tilesetDescriptor: descriptor,
          getTileData,
          renderTile,
          debug,
          debugOpacity,
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 2,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={layers} interleaved />
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
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            width: "320px",
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
            Titiler + RasterTileLayer
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
              {error ? (
                <p
                  style={{
                    margin: "8px 0 12px 0",
                    fontSize: "13px",
                    color: "#b00020",
                  }}
                >
                  Error: {error}
                </p>
              ) : (
                <p
                  style={{
                    margin: "8px 0 12px 0",
                    fontSize: "13px",
                    color: "#666",
                  }}
                >
                  Tiles are fetched as numpy <code>.npy</code> arrays from{" "}
                  <code>titiler.xyz</code>, parsed and uploaded as textures
                  client-side, then rendered via <code>RasterTileLayer</code>.
                </p>
              )}
              <p style={{ margin: "0 0 12px 0", fontSize: "14px" }}>
                <a
                  href="https://developmentseed.org/titiler/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Titiler Documentation ↗
                </a>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
