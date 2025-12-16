import { useEffect, useState, useRef } from "react";
import { Map, useControl, type MapRef } from "react-map-gl/maplibre";
import type { Tileset2DProps } from "@deck.gl/geo-layers/dist/tileset-2d";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { PathLayer } from "@deck.gl/layers";
import type { DeckProps } from "@deck.gl/core";
import { TileLayer, TileLayerProps } from "@deck.gl/geo-layers";
import { fromUrl } from "geotiff";
import type { GeoTIFF } from "geotiff";
import { COGLayer, parseCOGTileMatrixSet } from "@developmentseed/deck.gl-cog";
import {
  RasterTileset2D,
  TileMatrixSet,
} from "@developmentseed/deck.gl-raster";
import proj4 from "proj4";
import "maplibre-gl/dist/maplibre-gl.css";

window.proj4 = proj4;

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

/**
 * Calculate the WGS84 bounding box of a GeoTIFF image
 */
async function getCogBounds(
  tiff: GeoTIFF,
): Promise<[[number, number], [number, number]]> {
  const image = await tiff.getImage();
  const projectedBbox = image.getBoundingBox();
  const geoKeys = image.getGeoKeys();

  // Get the projection code
  const projectionCode =
    geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey || null;

  if (!projectionCode) {
    throw new Error("Could not determine projection from GeoTIFF");
  }

  // Fetch projection definition
  const url = `https://epsg.io/${projectionCode}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch projection data from ${url}`);
  }
  const projDef = await response.json();

  // Reproject to WGS84 (EPSG:4326)
  const converter = proj4(projDef, "EPSG:4326");

  // Reproject all four corners to handle rotation/skew
  const [minX, minY, maxX, maxY] = projectedBbox;
  const corners = [
    converter.forward([minX, minY]), // bottom-left
    converter.forward([maxX, minY]), // bottom-right
    converter.forward([maxX, maxY]), // top-right
    converter.forward([minX, maxY]), // top-left
  ];

  // Find the bounding box that encompasses all reprojected corners
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);

  const west = Math.min(...lons);
  const south = Math.min(...lats);
  const east = Math.max(...lons);
  const north = Math.max(...lats);

  // Return bounds in MapLibre format: [[west, south], [east, north]]
  return [
    [west, south],
    [east, north],
  ];
}

const COG_URL =
  "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff";

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [cogMetadata, setCogMetadata] = useState<TileMatrixSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);

  useEffect(() => {
    let mounted = true;

    async function loadGeoTIFF() {
      try {
        setLoading(true);
        setError(null);

        const tiff = await fromUrl(COG_URL);
        window.tiff = tiff;

        if (mounted) {
          setGeotiff(tiff);

          const m = await parseCOGTileMatrixSet(tiff);
          console.log("COG TileMatrixSet:", m);
          window.m = m;
          setCogMetadata(m);
          // window.cogMetadata = cogMetadata;d

          // Calculate bounds and fit to them
          const bounds = await getCogBounds(tiff);
          if (mapRef.current) {
            mapRef.current.fitBounds(bounds, {
              padding: 40,
              duration: 1000,
            });
          }

          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load GeoTIFF",
          );
          setLoading(false);
        }
      }
    }

    loadGeoTIFF();

    return () => {
      mounted = false;
    };
  }, []);

  const layers =
    geotiff && cogMetadata
      ? [
          // new COGLayer({
          //   id: "cog-layer",
          //   geotiff,
          //   maxError: 0.125,
          //   debug,
          //   debugOpacity,
          // }),
          createTileLayer(cogMetadata, {
            id: "raster-tile-layer",
            data: geotiff,
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay layers={layers} />
      </Map>

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
        {loading && (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "white",
              padding: "20px",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              pointerEvents: "auto",
            }}
          >
            Loading GeoTIFF...
          </div>
        )}

        {error && (
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#ff4444",
              color: "white",
              padding: "12px 24px",
              borderRadius: "4px",
              maxWidth: "80%",
              pointerEvents: "auto",
            }}
          >
            Error: {error}
          </div>
        )}

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
            COGLayer Example
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
            Displaying RGB imagery from New Zealand (NZTM2000 projection)
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
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={debugOpacity}
                  onChange={(e) => setDebugOpacity(parseFloat(e.target.value))}
                  style={{ width: "100%", cursor: "pointer" }}
                />
              </div>
            )}
          </div>

          <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid #eee",
              fontSize: "12px",
              color: "#999",
            }}
          >
            <div>Max Error: 0.125 pixels</div>
            <div>Source: LINZ</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function createTileLayer(metadata: TileMatrixSet, props: TileLayerProps) {
  // Create a factory class that wraps COGTileset2D with the metadata
  class RasterTilesetWrapper extends RasterTileset2D {
    constructor(opts: Tileset2DProps) {
      super(metadata, opts);
    }
  }

  return new TileLayer({
    ...props,
    TilesetClass: RasterTilesetWrapper,
    renderSubLayers: (props) => {
      const { tile } = props;
      console.log("Rendering tile:", tile);

      // Get projected bounds from tile data
      // getTileMetadata returns data that includes projectedBounds
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectedBounds = (tile as any)?.projectedBounds;

      if (!projectedBounds || !metadata) {
        return [];
      }

      // Project bounds from image CRS to WGS84
      const { topLeft, topRight, bottomLeft, bottomRight } = projectedBounds;

      const topLeftWgs84 = metadata.projectToWgs84(topLeft);
      const topRightWgs84 = metadata.projectToWgs84(topRight);
      const bottomRightWgs84 = metadata.projectToWgs84(bottomRight);
      const bottomLeftWgs84 = metadata.projectToWgs84(bottomLeft);

      // Create a closed path around the tile bounds
      const path = [
        topLeftWgs84,
        topRightWgs84,
        bottomRightWgs84,
        bottomLeftWgs84,
        topLeftWgs84, // Close the path
      ];

      console.log("Tile bounds path (WGS84):", path);

      return [
        new PathLayer({
          id: `${tile.id}-bounds`,
          data: [{ path }],
          getPath: (d) => d.path,
          getColor: [255, 0, 0, 255], // Red
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        }),
      ];

      // return null;
    },
  });
}
