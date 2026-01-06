import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  COGLayer,
  parseColormap,
  proj,
} from "@developmentseed/deck.gl-geotiff";
import type { RasterModule } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  FilterNoDataVal,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Device, Texture } from "@luma.gl/core";
import type {
  GeoTIFF,
  GeoTIFFImage,
  Pool,
  TypedArrayArrayWithDimensions,
} from "geotiff";
import { fromUrl } from "geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";
import { ErrorMessage } from "./components/ErrorMessage";
import { InfoPanel } from "./components/InfoPanel";
import { LoadingSpinner } from "./components/LoadingSpinner";
import { UIOverlay } from "./components/UIOverlay";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
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

const COG_URL =
  "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif";

async function getTileData(
  image: GeoTIFFImage,
  options: {
    device: Device;
    window: [number, number, number, number];
    signal?: AbortSignal;
    pool: Pool;
  },
): Promise<TileDataT> {
  const { device, window, signal, pool } = options;

  const {
    0: data,
    width,
    height,
  } = (await image.readRasters({
    window,
    samples: [0],
    pool,
    signal,
  })) as TypedArrayArrayWithDimensions;

  const texture = device.createTexture({
    format: "r8unorm",
    dimension: "2d",
    width,
    height,
    data,
  });

  return {
    texture,
    height,
    width,
  };
}

type TileDataT = {
  texture: Texture;
  height: number;
  width: number;
};

function renderTile(
  tileData: TileDataT,
  colormapTexture: Texture,
): RasterModule[] {
  const { texture } = tileData;

  // Hard coded NoData value but this ideally would be fetched from COG metadata
  const nodataVal = 250;
  // Since values are 0-1 for unorm textures,
  const noDataScaled = nodataVal / 255.0;

  return [
    {
      module: CreateTexture,
      props: {
        textureName: texture,
      },
    },
    {
      module: FilterNoDataVal,
      props: {
        value: noDataScaled,
      },
    },
    {
      module: Colormap,
      props: {
        colormapTexture: colormapTexture,
      },
    },
  ];
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [geotiff, setGeotiff] = useState<GeoTIFF | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debug, setDebug] = useState(false);
  const [debugOpacity, setDebugOpacity] = useState(0.25);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadGeoTIFF() {
      try {
        setLoading(true);
        setError(null);

        const tiff = await fromUrl(COG_URL);
        // For debugging purposes
        (window as any).tiff = tiff;

        if (mounted) {
          setGeotiff(tiff);

          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error ? err.message : "Failed to load GeoTIFF",
          );
          setLoading(false);
        }
      }
    }

    loadGeoTIFF();

    return () => {
      mounted = false;
    };
  }, []);

  // Once device exists, create global colormap texture
  useEffect(() => {
    async function createColormapTexture() {
      if (device && geotiff) {
        const image = await geotiff.getImage();
        const { data, width, height } = parseColormap(
          image.fileDirectory.ColorMap,
        );
        const colorMapTexture = device.createTexture({
          data,
          format: "rgba8unorm",
          width,
          height,
          sampler: {
            minFilter: "nearest",
            magFilter: "nearest",
            addressModeU: "clamp-to-edge",
            addressModeV: "clamp-to-edge",
          },
        });

        setColormapTexture(colorMapTexture);
      }
    }

    createColormapTexture();
  }, [geotiff, device]);

  const layers =
    geotiff && colormapTexture
      ? [
          new COGLayer<TileDataT>({
            id: "cog-layer",
            geotiff,
            debug,
            debugOpacity,
            geoKeysParser,
            getTileData,
            renderTile: (tileData) => renderTile(tileData, colormapTexture),
            onGeoTIFFLoad: (_tiff, options) => {
              const { west, south, east, north } = options.geographicBounds;
              mapRef.current?.fitBounds(
                [
                  [west, south],
                  [east, north],
                ],
                {
                  padding: 40,
                  duration: 1000,
                },
              );
            },
            beforeId: "aeroway-runway",
          }),
        ]
      : [];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: 0,
          latitude: 0,
          zoom: 3,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay
          layers={layers}
          interleaved
          onDeviceInitialized={(device) => setDevice(device)}
        />
      </MaplibreMap>

      <UIOverlay>
        {loading && <LoadingSpinner />}
        {error && <ErrorMessage message={error} />}
        <InfoPanel
          debug={debug}
          debugOpacity={debugOpacity}
          onDebugChange={setDebug}
          onDebugOpacityChange={setDebugOpacity}
        />
      </UIOverlay>
    </div>
  );
}
