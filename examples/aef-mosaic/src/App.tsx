import "maplibre-gl/dist/maplibre-gl.css";
import { useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

export default function App() {
  const mapRef = useRef<MapRef>(null);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{ longitude: -122.3, latitude: 37.75, zoom: 13 }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      />
    </div>
  );
}
