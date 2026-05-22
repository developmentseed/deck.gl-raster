import { NativeSelect, Text } from "@chakra-ui/react";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { DebugState } from "deck.gl-raster-examples-shared";
import {
  ControlPanel,
  DebugControls,
  DeckGlOverlay,
  ExternalLink,
  Field,
} from "deck.gl-raster-examples-shared";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap } from "react-map-gl/maplibre";

const COG_OPTIONS: { title: string; url: string; attribution?: ReactNode }[] = [
  {
    title: "EOxCloudless 2020 RGB",
    url: "https://s2downloads.eox.at/demo/EOxCloudless/2020/rgb_corrected_geodetic/3/0/0.tif",
    attribution: (
      <>
        <a href="https://cloudless.eox.at">
          EOxCloudless - https://cloudless.eox.at
        </a>
        {" (Contains modified Copernicus Sentinel data 2020)"}
      </>
    ),
  },
  {
    title: "Sentinel-2 True Color Image (New York, 2026)",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/18/T/WL/2026/1/S2B_18TWL_20260101_0_L2A/TCI.tif",
  },
  {
    title: "New Zealand 2024-2025 10m RGB",
    url: "https://nz-imagery.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand_2024-2025_10m/rgb/2193/CC11.tiff",
  },
  {
    title: "NAIP Aerial (New York, 2022)",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/m_4007307_sw_18_060_20220803.tif",
  },
  {
    title: "NLCD Land Cover 2023",
    url: "https://ds-wheels.s3.us-east-1.amazonaws.com/Annual_NLCD_LndCov_2023_CU_C1V0.tif",
  },
  {
    title: "Swisstopo National Map 1:1 million",
    url: "https://data.geo.admin.ch/ch.swisstopo.pixelkarte-farbe-pk1000.noscale/swiss-map-raster1000_1000/swiss-map-raster1000_1000_krel_50_2056.tif",
  },
  {
    title: "Anderson Co. Ortho Pan 2ft (2000)",
    url: "https://data.source.coop/giswqs/tn-imagery/imagery/AndersonCo_OrthoPan_2ft_2000.tif",
  },
  {
    title: "Umbra Port of Rotterdam (rotated COG)",
    url: "http://umbra-open-data-catalog.s3.amazonaws.com/sar-data/tasks/Port%20of%20Rotterdam%2C%20Netherlands/00864c2c-0b0f-49ef-b283-997735b27878/2025-07-29-11-17-12_UMBRA-08/2025-07-29-11-17-12_UMBRA-08_GEC.tif",
    attribution: (
      <>
        Umbra Synthetic Aperture Radar (SAR) Open Data accessed from{" "}
        <a href="https://registry.opendata.aws/umbra-open-data">
          https://registry.opendata.aws/umbra-open-data
        </a>
        .
      </>
    ),
  },
  {
    title: "USGS Topographic Map (Kanab Point, AZ, 1962, 1:62,500)",
    url: "https://prd-tnm.s3.amazonaws.com/StagedProducts/Maps/HistoricalTopo/GeoTIFF/AZ/AZ_Kanab%20Point_314712_1962_62500_geo.tif",
    attribution: (
      <>
        <a href="https://www.usgs.gov/programs/national-geospatial-program/historical-topographic-maps-preserving-past">
          USGS Historical Topographic Map program
        </a>
        .
      </>
    ),
  },
];

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [debugState, setDebugState] = useState<DebugState>({
    debug: false,
    debugOpacity: 0.25,
  });

  const selected = COG_OPTIONS[selectedIndex];

  const cogLayer = new COGLayer({
    id: "cog-layer",
    geotiff: selected.url,
    debug: debugState.debug,
    debugOpacity: debugState.debugOpacity,
    onGeoTIFFLoad: (tiff, options) => {
      (window as unknown as { tiff: unknown }).tiff = tiff;
      const { west, south, east, north } = options.geographicBounds;
      mapRef.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 40, duration: 1000 },
      );
    },
    // On a globe the raster mesh is coplanar with MapLibre's basemap sphere and
    // they share the interleaved depth buffer, which z-fights. A depth bias does
    // not help with maplibre's globe depth encoding; instead skip the depth
    // comparison and occlude the far hemisphere with back-face culling. The cull
    // mode depends on the compositing setup — `back` for this MapLibre
    // interleaved globe (a standalone deck.gl _GlobeView may need `front`),
    // which is why the app sets it, not the library. See visgl/deck.gl#9592.
    parameters: { depthCompare: "always", cullMode: "back" },
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
          Renders{" "}
          <ExternalLink href="https://cogeo.org">
            Cloud-Optimized GeoTIFFs
          </ExternalLink>{" "}
          on a 3D globe (MapLibre globe projection, deck.gl interleaved).
        </Text>
        <Field label="Source">
          <NativeSelect.Root>
            <NativeSelect.Field
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {COG_OPTIONS.map((opt, i) => (
                <option key={opt.url} value={i}>
                  {opt.title}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>
        {selected.attribution ? (
          <Text mt="2" fontSize="xs" color="gray.600">
            {selected.attribution}
          </Text>
        ) : null}
        <DebugControls value={debugState} onChange={setDebugState} />
      </ControlPanel>
    </div>
  );
}
