import type { DeckProps } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import {
  COGLayer,
  MosaicTileset2D,
  proj,
} from "@developmentseed/deck.gl-geotiff";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, useControl } from "react-map-gl/maplibre";

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

type STACItem = {
  id: string;
  bbox: [number, number, number, number];
  assets: {
    image: {
      href: string;
    };
  };
};

type STACFeatureCollection = {
  features: STACItem[];
};

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [stacItems, setStacItems] = useState<STACItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch STAC items on mount
  useEffect(() => {
    async function fetchSTACItems() {
      try {
        const params = {
          collections: "naip",
          bbox: [-107.58, 37.82, -104.52, 40.45],
          filter: JSON.stringify({
            op: "=",
            args: [{ property: "naip:state" }, "co"],
          }),
          "filter-lang": "cql2-json",
          datetime: "2023-01-01T00:00:00Z/2023-12-31T23:59:59Z",
          limit: "1000",
        };

        const queryString = new URLSearchParams(params).toString();
        const url = `https://planetarycomputer.microsoft.com/api/stac/v1/search?${queryString}`;

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`STAC API error: ${response.statusText}`);
        }

        const data: STACFeatureCollection = await response.json();
        (window as any).data = data;
        setStacItems(data.features);
      } catch (err) {
        console.error("Error fetching STAC items:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch STAC items",
        );
      } finally {
        setLoading(false);
      }
    }

    fetchSTACItems();
  }, []);

  // Create TileLayer with MosaicTileset2D
  const layers = [];

  if (stacItems.length > 0) {
    // Create a factory class that wraps MosaicTileset2D with the metadata
    class MosaicTileset2DFactory extends MosaicTileset2D<STACItem> {
      constructor(opts: any) {
        super(stacItems, opts);
      }
    }

    const mosaicLayer = new TileLayer({
      id: "mosaic-tile-layer",
      TilesetClass: MosaicTileset2DFactory,
      getTileData: (data: { index: STACItem }) => {
        const { index } = data;
        return index.assets.image.href;
      },
      renderSubLayers: (props: any) => {
        const { data: url } = props;

        if (!url) {
          return null;
        }

        // Render each tile as a COGLayer
        return new COGLayer({
          id: `cog-${url}`,
          geotiff: url,
          geoKeysParser,
          // debug: true,
        });
      },
    });

    layers.push(mosaicLayer);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -106,
          latitude: 39,
          zoom: 7,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        <DeckGLOverlay layers={layers} />
      </MaplibreMap>

      {/* UI Overlay Container */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1000,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            maxWidth: "300px",
            pointerEvents: "auto",
          }}
        >
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>
            NAIP Mosaic Example
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
            {loading && "Loading STAC items..."}
            {error && `Error: ${error}`}
            {!loading && !error && `Loaded ${stacItems.length} NAIP images`}
          </p>
        </div>
      </div>
    </div>
  );
}
