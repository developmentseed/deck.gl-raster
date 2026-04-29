import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { MinimalTileData } from "@developmentseed/deck.gl-raster";
import type { GetTileDataOptions } from "@developmentseed/deck.gl-zarr";
import { ZarrLayer } from "@developmentseed/deck.gl-zarr";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import * as zarr from "zarrita";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

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
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [panelOpen, setPanelOpen] = useState(true);
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
        debug,
        debugOpacity,
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
        <DeckGLOverlay layers={zarrLayer ? [zarrLayer] : []} interleaved />
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
            ZarrLayer — Sentinel-2 TCI
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
                  fontSize: "12px",
                  color: "#666",
                }}
              >
                GeoZarr multiscale, EPSG:32612
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

              <div
                style={{
                  padding: "12px 0",
                  borderTop: "1px solid #eee",
                  marginTop: "4px",
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
