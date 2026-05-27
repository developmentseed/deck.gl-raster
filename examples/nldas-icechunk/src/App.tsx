import { DeckGlOverlay } from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

// Keyless CARTO basemap; light background reads well under a data overlay.
const BASEMAP_STYLE =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export default function App() {
  const mapRef = useRef<MapRef>(null);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: -98, latitude: 39, zoom: 3.5 }}
        mapStyle={BASEMAP_STYLE}
      >
        <DeckGlOverlay layers={[]} interleaved />
      </MaplibreMap>
    </div>
  );
}
