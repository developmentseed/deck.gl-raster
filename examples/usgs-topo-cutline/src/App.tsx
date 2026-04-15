import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { TextureDataT } from "@developmentseed/deck.gl-geotiff";
import { COGLayer, inferRenderPipeline } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import { CutlineBbox } from "@developmentseed/deck.gl-raster/gpu-modules";
import { GeoTIFF } from "@developmentseed/geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// Emigrant Gap, CA — 1955, 1:62,500 scale USGS quad.
// WGS84 bbox from the USGS HTMC metadata CSV (westbc, southbc, eastbc, northbc).
const TOPO_URL =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/CA/CA_Emigrant%20Gap_297419_1955_62500_geo.tif";
const TOPO_BBOX: [number, number, number, number] = [
  -120.75,
  39.25,
  -120.5,
  39.5,
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [cutlineEnabled, setCutlineEnabled] = useState(true);

  // Fetch the GeoTIFF once so we can pass the same instance to both COGLayer
  // and inferRenderPipeline (the latter needs it synchronously to build the
  // default pipeline that we'll wrap).
  useEffect(() => {
    let cancelled = false;
    GeoTIFF.fromUrl(TOPO_URL).then((tiff) => {
      if (!cancelled) {
        setGeotiff(tiff);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The inferred pipeline needs both the GeoTIFF and a luma.gl Device. We
  // don't have a device until the first tile fetch, so we cache the inferred
  // pipeline lazily inside getTileData and reuse it for renderTile.
  const inferredRef = useRef<ReturnType<typeof inferRenderPipeline> | null>(
    null,
  );

  const layer = geotiff
    ? new COGLayer<TextureDataT>({
        id: "usgs-topo",
        geotiff,
        getTileData: async (image, options) => {
          if (!inferredRef.current) {
            inferredRef.current = inferRenderPipeline(geotiff, options.device);
          }
          return inferredRef.current.getTileData(image, options);
        },
        renderTile: (data): RenderTileResult => {
          if (!inferredRef.current) {
            throw new Error("inferredRef must be initialized before renderTile");
          }
          const inferred = inferredRef.current.renderTile(data);
          const basePipeline = inferred.renderPipeline ?? [];
          return {
            ...inferred,
            renderPipeline: cutlineEnabled
              ? [
                  ...basePipeline,
                  { module: CutlineBbox, props: { bbox: TOPO_BBOX } },
                ]
              : basePipeline,
          };
        },
        onGeoTIFFLoad: (_tiff, options) => {
          const { west, south, east, north } = options.geographicBounds;
          mapRef.current?.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 40, duration: 1000 },
          );
        },
        beforeId: "boundary_country_outline",
      })
    : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -120.625,
          latitude: 39.375,
          zoom: 11,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={layer ? [layer] : []} interleaved />
      </MaplibreMap>

      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          background: "white",
          padding: "16px",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          maxWidth: "320px",
          zIndex: 1000,
        }}
      >
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
          USGS Topo Cutline Example
        </h3>
        <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#444" }}>
          Emigrant Gap, CA 1:62,500 quad (1955). Toggle the cutline to see the
          "map collar" of metadata printed around the data area.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={cutlineEnabled}
            onChange={(e) => setCutlineEnabled(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          <span>Discard map collar (CutlineBbox)</span>
        </label>
      </div>
    </div>
  );
}
