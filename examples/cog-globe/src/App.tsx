import { Text } from "@chakra-ui/react";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import { ControlPanel, DeckGlOverlay } from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

// EPSG:4326 (geodetic) COG. Exercises the COGLayer path on the globe; the
// identity 4326→4326 reprojection is the strongest faceting stress test for the
// globe grid scaffold. Swap for any global 4326 COG. (The zarr-globe example
// provides genuinely whole-globe coverage.)
const COG_URL =
  "https://s2downloads.eox.at/demo/EOxCloudless/2020/rgb_corrected_geodetic/3/0/0.tif";

export default function App() {
  const mapRef = useRef<MapRef>(null);

  const cogLayer = new COGLayer({
    id: "cog-layer",
    geotiff: COG_URL,
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
          latitude: 20,
          zoom: 1.5,
          pitch: 0,
          bearing: 0,
        }}
        projection="globe"
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay layers={[cogLayer]} interleaved />
      </MaplibreMap>

      <ControlPanel
        title="COGLayer Globe Example"
        sourcePath="examples/cog-globe"
      >
        <Text mb="3" color="gray.600">
          Renders a Cloud-Optimized GeoTIFF on a 3D globe using MapLibre's globe
          projection with deck.gl interleaved rendering.
        </Text>
      </ControlPanel>
    </div>
  );
}
