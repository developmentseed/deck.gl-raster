import type { MapboxOverlayProps } from "@deck.gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";

/**
 * Renders deck.gl layers as an overlay on a `react-map-gl` (MapLibre) `<Map>`.
 *
 * Drop inside a `<Map>` element: `<DeckGlOverlay layers={[layer]} interleaved />`.
 */
export function DeckGlOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay(withReusedDevice(props)),
  );
  overlay.setProps(withReusedDevice(props));
  return null;
}

/**
 * Let a new `Deck` reuse a luma.gl device already attached to MapLibre's WebGL
 * context instead of throwing.
 *
 * React `StrictMode` (development only) mounts this component twice, so the
 * overlay creates a `Deck`, finalizes it, and immediately creates another on
 * the same context. Both attach a device concurrently, and without
 * `_reuseDevices` the second attach can throw "WebGL context already attached
 * to device". deck.gl already passes this flag when it creates its own device
 * ({@link https://github.com/visgl/deck.gl/blob/5eded84b438eef83387dc6579c51670389053602/modules/core/src/lib/deck.ts#L1469-L1473 | deck.ts#L1469-L1473}),
 * but not when it attaches to an existing context, as in interleaved mode
 * ({@link https://github.com/visgl/deck.gl/blob/5eded84b438eef83387dc6579c51670389053602/modules/core/src/lib/deck.ts#L434-L440 | deck.ts#L434-L440}).
 */
function withReusedDevice(props: MapboxOverlayProps): MapboxOverlayProps {
  return {
    ...props,
    deviceProps: { _reuseDevices: true, ...props.deviceProps },
  };
}
