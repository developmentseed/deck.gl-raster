import { Code, chakra, Stack, Text } from "@chakra-ui/react";
import { LoadingWidget } from "@deck.gl/widgets";
import { RasterTileLayer } from "@developmentseed/deck.gl-raster";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";
import type { TileData, TitilerSource } from "./titiler.js";
import {
  getTileData,
  loadTitilerSource,
  renderTile,
  TITILER_URL,
} from "./titiler.js";

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [source, setSource] = useState<TitilerSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });

  useEffect(() => {
    const controller = new AbortController();
    loadTitilerSource({ signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) {
          return;
        }
        setSource(loaded);
        const [west, south, east, north] = loaded.bounds;
        mapRef.current?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 1000 },
        );
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setError(String(err));
        }
      });
    return () => controller.abort();
  }, []);

  const layers = source
    ? [
        new RasterTileLayer<TileData>({
          id: "titiler-tiles",
          tilesetDescriptor: source.descriptor,
          getTileData,
          renderTile,
          // Past titiler's `maxzoom`, stretch the finest tiles instead of
          // fetching more. We don't pass its `minzoom`: `RasterTileLayer`
          // renders nothing below `minZoom`, but titiler can still serve
          // coarser tiles, from the COG's smallest overview.
          maxZoom: source.maxZoom,
          // We created the tile's textures in `getTileData`, so we free them.
          onTileUnload: (tile) => {
            tile.content?.texture.destroy();
            tile.content?.mask?.destroy();
          },
          debug: debugState.debug,
          debugOpacity: debugState.debugOpacity,
          // @ts-expect-error beforeId is injected by @deck.gl/mapbox; LayerProps
          // doesn't know about it.
          beforeId: "boundary_country_outline",
        }),
      ]
    : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -74.3,
          latitude: 41,
          zoom: 7,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGlOverlay
          layers={layers}
          widgets={[new LoadingWidget(loadingWidgetProps)]}
          interleaved
        />
      </MaplibreMap>

      <ControlPanel
        title={
          <>
            Titiler Tiles{" "}
            <chakra.span
              fontSize="2xs"
              fontWeight="bold"
              letterSpacing="wide"
              textTransform="uppercase"
              color="orange.800"
              bg="orange.100"
              borderWidth="1px"
              borderColor="orange.300"
              borderRadius="sm"
              px="1.5"
              py="0.5"
              verticalAlign="middle"
            >
              Experimental
            </chakra.span>
          </>
        }
        sourcePath="examples/experimental/titiler-cog"
      >
        <Stack gap="3">
          <Text color="gray.600">
            Tiles come from a{" "}
            <ExternalLink href="https://developmentseed.org/titiler/">
              titiler
            </ExternalLink>{" "}
            server as raw NumPy <Code>.npy</Code> arrays instead of images. Each
            one is decoded in the browser, uploaded to the GPU, and drawn by{" "}
            <Code>RasterTileLayer</Code>.
          </Text>

          <Text fontSize="sm" color="gray.600">
            Server:{" "}
            <ExternalLink href={`${TITILER_URL}/api.html`}>
              titiler.xyz
            </ExternalLink>
            <br />
            Dataset: Sentinel-2 true color (New York, January 2026)
            <br />
            Tiles:{" "}
            {error
              ? "failed to load"
              : source
                ? `${source.dataType ?? "unknown dtype"}, ${source.bandCount ?? "?"} bands + mask, up to zoom ${source.maxZoom}`
                : "loading…"}
          </Text>

          {error ? (
            <Text fontSize="sm" color="red.600">
              Failed to load titiler metadata: {error}
            </Text>
          ) : null}

          <DebugControls value={debugState} onChange={setDebugState} />
        </Stack>
      </ControlPanel>
    </div>
  );
}
