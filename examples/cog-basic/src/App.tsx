import { useEffect, useState } from "react";
import { Map, useControl } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { DeckProps } from "@deck.gl/core";
import { fromUrl } from "geotiff";
import type { GeoTIFF } from "geotiff";
import { COGLayer } from "@developmentseed/deck.gl-cog";
import "maplibre-gl/dist/maplibre-gl.css";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const COG_URL =
  "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff";

export default function App() {
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadGeoTIFF() {
      try {
        setLoading(true);
        setError(null);

        const tiff = await fromUrl(COG_URL);

        if (mounted) {
          setGeotiff(tiff);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load GeoTIFF");
          setLoading(false);
        }
      }
    }

    loadGeoTIFF();

    return () => {
      mounted = false;
    };
  }, []);

  const layers = geotiff
    ? [
        new COGLayer({
          id: "cog-layer",
          geotiff,
          maxError: 0.125,
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Map
        initialViewState={{
          longitude: 172.6,
          latitude: -43.5,
          zoom: 10,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
      >
        <DeckGLOverlay layers={layers} />
      </Map>

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
        }}
      >
        <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>COGLayer Example</h3>
        <p style={{ margin: "0", fontSize: "14px", color: "#666" }}>
          Displaying RGB imagery from New Zealand (NZTM2000 projection)
        </p>
        <div style={{ marginTop: "12px", fontSize: "12px", color: "#999" }}>
          <div>Max Error: 0.125 pixels</div>
          <div>Source: LINZ</div>
        </div>
      </div>
    </div>
  );
}
