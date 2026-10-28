import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

/** Placeholder until the hillshade app lands: a map at the Matterhorn. */
export default function App() {
  return (
    <MaplibreMap
      initialViewState={{ longitude: 7.6586, latitude: 45.9763, zoom: 12 }}
      mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    />
  );
}
