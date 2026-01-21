import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer, proj } from "@developmentseed/deck.gl-geotiff";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRef } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export interface COGMapProps {
  url: string;
  initialViewState?: {
    longitude?: number;
    latitude?: number;
    zoom?: number;
  };
  fitBoundsOnLoad?: boolean;
  mapStyle?: string;
}

export default function COGMap({
  url,
  initialViewState = { longitude: 0, latitude: 0, zoom: 2 },
  fitBoundsOnLoad = true,
  mapStyle = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
}: COGMapProps) {
  const mapRef = useRef<MapRef>(null);

  const cogLayer = new COGLayer({
    id: "cog-layer",
    geotiff: url,
    onGeoTIFFLoad: (_tiff, options) => {
      if (fitBoundsOnLoad && mapRef.current) {
        const { west, south, east, north } = options.geographicBounds;
        mapRef.current.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 1000 },
        );
      }
    },
  });

  return (
    <MaplibreMap
      ref={mapRef}
      initialViewState={{
        longitude: initialViewState.longitude ?? 0,
        latitude: initialViewState.latitude ?? 0,
        zoom: initialViewState.zoom ?? 2,
        pitch: 0,
        bearing: 0,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={mapStyle}
    >
      <DeckGLOverlay layers={[cogLayer]} interleaved />
    </MaplibreMap>
  );
}
