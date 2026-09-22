import type { MapLibreOverlayProps } from "@deck.gl/maplibre";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { useControl } from "react-map-gl/maplibre";

/**
 * Renders deck.gl layers as an overlay on a `react-map-gl` (MapLibre) `<Map>`.
 *
 * Drop inside a `<Map>` element: `<DeckGlOverlay layers={[layer]} interleaved />`.
 */
export function DeckGlOverlay(props: MapLibreOverlayProps) {
  const overlay = useControl<MapLibreOverlay>(() => new MapLibreOverlay(props));
  overlay.setProps(props);
  return null;
}
