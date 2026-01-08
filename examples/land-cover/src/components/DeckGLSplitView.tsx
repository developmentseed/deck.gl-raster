import { Deck, MapView } from "@deck.gl/core";
import { _SplitterWidget as SplitterWidget } from "@deck.gl/widgets";
import { COGLayer, proj } from "@developmentseed/deck.gl-geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import { useEffect, useRef } from "react";

interface DeckGLSplitViewProps {
  debug: boolean;
  debugOpacity: number;
}

async function geoKeysParser(
  geoKeys: Record<string, any>,
): Promise<proj.ProjectionInfo> {
  const projDefinition = toProj4(geoKeys as any);

  return {
    def: projDefinition.proj4,
    parsed: proj.parseCrs(projDefinition.proj4),
    coordinatesUnits: projDefinition.coordinatesUnits as proj.SupportedCrsUnit,
  };
}

const COG_URL_1985 =
  "https://s3.us-east-1.amazonaws.com/ds-deck.gl-raster-public/cog/Annual_NLCD_LndCov_1985_CU_C1V1.tif";
const COG_URL_2024 =
  "https://s3.us-east-1.amazonaws.com/ds-deck.gl-raster-public/cog/Annual_NLCD_LndCov_2024_CU_C1V1.tif";

export function DeckGLSplitView({ debug, debugOpacity }: DeckGLSplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<Deck | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialViewState = {
      longitude: -98,
      latitude: 38.5,
      zoom: 3.5,
      pitch: 0,
      bearing: 0,
    };

    const cog_layer_1985 = new COGLayer({
      id: "cog-layer-1985",
      geotiff: COG_URL_1985,
      debug,
      debugOpacity,
      geoKeysParser,
      operation: "draw",
    });

    const cog_layer_2024 = new COGLayer({
      id: "cog-layer-2024",
      geotiff: COG_URL_2024,
      debug,
      debugOpacity,
      geoKeysParser,
      operation: "draw",
    });

    const deck = new Deck({
      parent: containerRef.current,
      initialViewState: {
        view1: initialViewState,
        view2: initialViewState,
      },
      controller: true,
      views: [
        new MapView({ id: "left", x: 0, width: "50%", controller: true }),
        new MapView({ id: "right", x: "50%", width: "50%", controller: true }),
      ],
      layers: [
        cog_layer_1985.clone({ operation: "draw" }),
        cog_layer_2024.clone({ operation: "draw" }),
      ],
      layerFilter: ({ layer, viewport }) => {
        if (viewport.id === "view1") {
          return layer.id === "cog-layer-1985";
        }
        if (viewport.id === "view2") {
          return layer.id === "cog-layer-2024";
        }
        return true;
      },
      widgets: [
        new SplitterWidget({
          viewId1: "view1",
          viewId2: "view2",
          orientation: "vertical",
        }),
      ],
    });

    deckRef.current = deck;

    return () => {
      deck.finalize();
      deckRef.current = null;
    };
  }, []);

  // Update layers when debug settings change
  useEffect(() => {
    if (!deckRef.current) return;

    const cog_layer_1985 = new COGLayer({
      id: "cog-layer-1985",
      geotiff: COG_URL_1985,
      debug,
      debugOpacity,
      geoKeysParser,
      operation: "draw",
    });

    const cog_layer_2024 = new COGLayer({
      id: "cog-layer-2024",
      geotiff: COG_URL_2024,
      debug,
      debugOpacity,
      geoKeysParser,
      operation: "draw",
    });

    deckRef.current.setProps({
      layers: [
        cog_layer_1985.clone({ operation: "draw" }),
        cog_layer_2024.clone({ operation: "draw" }),
      ],
    });
  }, [debug, debugOpacity]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "#1a1a1a",
      }}
    />
  );
}
