import {
  Box,
  Checkbox,
  Code,
  chakra,
  Link,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { PickingInfo } from "@deck.gl/core";
import type { DeckGLRef } from "@deck.gl/react";
import DeckGL from "@deck.gl/react";
import { LoadingWidget } from "@deck.gl/widgets";
import {
  createColormapTexture,
  decodeColormapSprite,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import type { Device, Texture } from "@luma.gl/core";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  Field,
  loadingWidgetProps,
} from "deck.gl-raster-examples-shared";
import "@deck.gl/widgets/stylesheet.css";
import proj4 from "proj4";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LngLat } from "./context-layers.js";
import {
  COASTLINES_URL,
  geojsonLines,
  renderContextLayers,
} from "./context-layers.js";
import type { ProjectionConverter } from "./custom-projection/index.js";
import {
  CustomProjectionView,
  pixelToWorld,
} from "./custom-projection/index.js";
import type { ElevationTileData } from "./datasets.js";
import {
  DATASETS,
  getElevationTileData,
  makeRenderElevationTile,
} from "./datasets.js";
import type { VelocityTileData } from "./overlays.js";
import {
  getVelocityTileData,
  makeRenderVelocityTile,
  OVERLAYS,
} from "./overlays.js";
import { ProjectedCOGLayer } from "./projected-cog-layer/index.js";
import { PROJECTIONS } from "./projections.js";

/** The world-coordinate CRS of every view: WGS84 longitude/latitude. */
const FROM_CRS = "EPSG:4326";

/**
 * Optional starting state from the URL, e.g.
 * `?projection=antarctic&raster=nasa-antarctic&overlay=itslive-antarctica&center=0,-75&zoom=4`,
 * so that particular views can be bookmarked.
 */
const URL_STATE = (() => {
  const params = new URLSearchParams(window.location.search);
  const projectionId = params.get("projection");
  const rasterId = params.get("raster");
  const overlayId = params.get("overlay");
  const center = params.get("center")?.split(",").map(Number);
  const zoomParam = params.get("zoom");
  const zoom = zoomParam === null ? Number.NaN : Number(zoomParam);
  const hasCamera =
    center?.length === 2 &&
    center.every(Number.isFinite) &&
    Number.isFinite(zoom);
  return {
    projectionId: PROJECTIONS.some((p) => p.id === projectionId)
      ? projectionId!
      : PROJECTIONS[0]!.id,
    rasterId: DATASETS.some((d) => d.id === rasterId)
      ? rasterId!
      : DATASETS[0]!.id,
    overlayId: OVERLAYS.some((o) => o.id === overlayId) ? overlayId : null,
    camera: hasCamera
      ? {
          center: [center[0]!, center[1]!, 0] as [number, number, number],
          zoom,
        }
      : null,
  };
})();

export default function App() {
  const [projectionId, setProjectionId] = useState(URL_STATE.projectionId);
  const [datasetId, setDatasetId] = useState(URL_STATE.rasterId);
  const [overlayId, setOverlayId] = useState<string | null>(
    URL_STATE.overlayId,
  );
  const [showGraticule, setShowGraticule] = useState(true);
  const [showCoastlines, setShowCoastlines] = useState(true);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });
  const [cursor, setCursor] = useState<number[] | null>(null);
  const [coastlines, setCoastlines] = useState<LngLat[][] | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [colormapImage, setColormapImage] = useState<ImageData | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  const preset = PROJECTIONS.find((p) => p.id === projectionId)!;
  // Some sources only work in some projections; fall back rather than draw
  // them broken. The selection is kept, so switching back restores it.
  const datasetOptions = DATASETS.filter(
    (d) => !d.projections || d.projections.includes(preset.id),
  );
  const dataset =
    datasetOptions.find((d) => d.id === datasetId) ?? datasetOptions[0]!;
  const overlayOptions = OVERLAYS.filter((o) =>
    o.projections.includes(preset.id),
  );
  const overlay = overlayOptions.find((o) => o.id === overlayId) ?? null;

  // Dev-only handle for inspecting deck from the browser console.
  const deckRef = useRef<DeckGLRef>(null);
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { deck?: unknown }).deck = deckRef.current?.deck;
    }
  });

  // One converter, view and camera per projection. The view is memoized
  // because deck.gl compares view props (including the converter's functions)
  // to decide whether to rebuild viewports.
  const { converter, view, initialViewState } = useMemo(() => {
    const converter: ProjectionConverter = proj4(FROM_CRS, preset.toCrs);
    return {
      converter,
      // Once deck.gl ships `_CustomProjectionView`, this is the same call
      // with the upstream class; see README.md.
      view: new CustomProjectionView({
        id: "map",
        controller: true,
        projection: converter,
        fromCrs: FROM_CRS,
        toCrs: preset.toCrs,
        fromBounds: preset.fromBounds,
      }),
      // A fresh object resets deck's internal view state on projection change.
      initialViewState:
        preset.id === URL_STATE.projectionId && URL_STATE.camera
          ? { ...URL_STATE.camera }
          : { ...preset.initialViewState },
    };
  }, [preset]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(COASTLINES_URL);
      const lines = geojsonLines(await response.json());
      if (!cancelled) {
        setCoastlines(lines);
      }
    })().catch((error) => console.error("Failed to load coastlines", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Decode the colormap sprite once, then upload it once the device exists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch(colormapsPngUrl);
      const image = await decodeColormapSprite(await response.arrayBuffer());
      if (!cancelled) {
        setColormapImage(image);
      }
    })().catch((error) => console.error("Failed to load colormaps", error));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (device && colormapImage) {
      setColormapTexture(createColormapTexture(device, colormapImage));
    }
  }, [device, colormapImage]);

  const context = useMemo(
    () =>
      renderContextLayers({
        idPrefix: preset.id,
        fromBounds: preset.fromBounds,
        project: (position) => converter.forward(position),
        graticuleStep: preset.graticuleStep,
        coastlines,
        showGraticule,
        showCoastlines,
      }),
    [preset, converter, coastlines, showGraticule, showCoastlines],
  );

  const rasterLayer = useMemo(() => {
    const common = {
      id: `cog-${dataset.id}`,
      geotiff: dataset.url,
      // Upstream's viewport doesn't expose its domain, so the layer gets it
      // explicitly (the shim's viewport would also provide it).
      fromBounds: preset.fromBounds,
      debug: debugState.debug,
      debugOpacity: debugState.debugOpacity,
    };
    if (dataset.kind === "rgb") {
      return new ProjectedCOGLayer(common);
    }
    if (!colormapTexture) {
      return null;
    }
    return new ProjectedCOGLayer<ElevationTileData>({
      ...common,
      getTileData: getElevationTileData,
      renderTile: makeRenderElevationTile(colormapTexture),
      onTileUnload: (tile) => tile.content?.texture.destroy(),
    });
  }, [dataset, preset, colormapTexture, debugState]);

  const overlayLayer = useMemo(() => {
    if (!overlay || !colormapTexture) {
      return null;
    }
    return new ProjectedCOGLayer<VelocityTileData>({
      id: `overlay-${overlay.id}`,
      geotiff: overlay.url,
      fromBounds: preset.fromBounds,
      getTileData: getVelocityTileData,
      renderTile: makeRenderVelocityTile(colormapTexture),
      onTileUnload: (tile) => tile.content?.texture.destroy(),
      opacity: 0.9,
    });
  }, [overlay, preset, colormapTexture]);

  const layers = [
    ...context.below,
    ...(rasterLayer ? [rasterLayer] : []),
    ...(overlayLayer ? [overlayLayer] : []),
    ...context.above,
  ];

  const onHover = (info: PickingInfo) => {
    const { viewport, x, y } = info;
    setCursor(
      viewport && x >= 0 && y >= 0
        ? pixelToWorld(viewport as Parameters<typeof pixelToWorld>[0], [x, y])
        : null,
    );
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#070b14",
      }}
    >
      <DeckGL
        ref={deckRef}
        views={view}
        initialViewState={initialViewState}
        layers={layers}
        widgets={[new LoadingWidget(loadingWidgetProps)]}
        onDeviceInitialized={setDevice}
        onHover={onHover}
      />

      <ControlPanel
        title={
          <>
            Custom Projections{" "}
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
        sourcePath="examples/experimental/custom-projection"
      >
        <Text mb="3" color="gray.600">
          Cloud-Optimized GeoTIFFs reprojected on the GPU into{" "}
          <strong>custom projections</strong>. There's no basemap here because
          Maplibre doesn't support custom projections; everything is drawn by
          deck.gl.
        </Text>

        <Box
          mb="3"
          p="2"
          fontSize="xs"
          color="orange.900"
          bg="orange.50"
          borderLeftWidth="3px"
          borderColor="orange.400"
          borderRadius="sm"
        >
          This is an <strong>experimental preview</strong> of functionality that
          deck.gl-raster will support once deck.gl v10 is released. Until then
          it relies on an interim stand-in for deck.gl's custom projection view
          and may change.
        </Box>

        <Stack gap="3">
          <Field label="Projection">
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={projectionId}
                onChange={(e) => setProjectionId(e.target.value)}
              >
                {PROJECTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.code})
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>
          <Text fontSize="xs" color="gray.600" mt="-1">
            {preset.description}
          </Text>

          <Field label="Raster">
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={dataset.id}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                {datasetOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>
          <Text fontSize="xs" color="gray.600" mt="-1">
            {dataset.description}
          </Text>

          <Field label="Overlay">
            <NativeSelect.Root size="sm">
              <NativeSelect.Field
                value={overlay?.id ?? ""}
                onChange={(e) => setOverlayId(e.target.value || null)}
              >
                <option value="">None</option>
                {overlayOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Field>
          {overlay ? (
            <Text fontSize="xs" color="gray.600" mt="-1">
              {overlay.description}
            </Text>
          ) : null}

          <Stack direction="row" gap="4">
            <Checkbox.Root
              size="sm"
              checked={showGraticule}
              onCheckedChange={(d) => setShowGraticule(d.checked === true)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Graticule</Checkbox.Label>
            </Checkbox.Root>
            <Checkbox.Root
              size="sm"
              checked={showCoastlines}
              onCheckedChange={(d) => setShowCoastlines(d.checked === true)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Coastlines</Checkbox.Label>
            </Checkbox.Root>
          </Stack>

          <Box fontSize="xs" color="gray.600">
            <Text>
              Cursor:{" "}
              <Code fontSize="xs">
                {cursor
                  ? `${cursor[0]!.toFixed(3)}°, ${cursor[1]!.toFixed(3)}°`
                  : "—"}
              </Code>
            </Text>
          </Box>

          <Text fontSize="xs" color="gray.500">
            Raster:{" "}
            <Link href={dataset.attributionUrl} target="_blank">
              {dataset.attribution}
            </Link>
            .{" "}
            {overlay ? (
              <>
                Overlay:{" "}
                <Link href={overlay.attributionUrl} target="_blank">
                  {overlay.attribution}
                </Link>
                .{" "}
              </>
            ) : null}
            Coastlines:{" "}
            <Link href="https://www.naturalearthdata.com/" target="_blank">
              Natural Earth
            </Link>
            .
          </Text>
        </Stack>

        <DebugControls value={debugState} onChange={setDebugState} />
      </ControlPanel>
    </div>
  );
}
