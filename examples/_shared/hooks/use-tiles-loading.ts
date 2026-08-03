import { useCallback, useState } from "react";

/**
 * Return value of {@link useTilesLoading}.
 */
export interface UseTilesLoadingResult {
  /** Whether tiles are currently loading. Pass to `<LoadingIndicator>`. */
  loading: boolean;
  /**
   * Attach to the tile layer's `onViewportLoad` prop. Fires when every tile
   * selected for the current viewport has resolved — the "done" edge.
   */
  onViewportLoad: () => void;
  /**
   * Call when a new load begins — the "started" edge. deck.gl has no native
   * "load started" event, so the caller supplies it, typically from the map's
   * `onMoveStart` (panning/zooming selects new tiles) or a source-switch
   * handler.
   */
  onLoadingStart: () => void;
}

/**
 * Tracks whether map tiles are currently loading, for a loading indicator.
 *
 * Starts in the loading state so the initial tile fetch shows the indicator
 * before the user moves the map. `onLoadingStart` flips it back on for
 * subsequent loads; `onViewportLoad` clears it when the viewport settles.
 */
export function useTilesLoading(): UseTilesLoadingResult {
  const [loading, setLoading] = useState(true);

  const onViewportLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const onLoadingStart = useCallback(() => {
    setLoading(true);
  }, []);

  return { loading, onViewportLoad, onLoadingStart };
}
