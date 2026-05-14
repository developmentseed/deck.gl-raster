import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";

/**
 * Renders deck.gl layers as an overlay on a `react-map-gl` (MapLibre) `<Map>`.
 *
 * Drop inside a `<Map>` element: `<DeckGlOverlay layers={[layer]} interleaved />`.
 */
export function DeckGlOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}
