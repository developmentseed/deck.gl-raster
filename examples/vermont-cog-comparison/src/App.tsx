import type { MapViewState } from "@deck.gl/core";
import { MapView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import { DeckGL } from "@deck.gl/react";
import { useState } from "react";
import { SwipeHandle } from "./swipe-handle.js";

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -73.218,
  latitude: 44.476,
  zoom: 13,
  pitch: 0,
  bearing: 0,
};

const MAP_VIEW = new MapView({ id: "map", controller: true });

/**
 * Build the shared CARTO dark raster basemap layer. Renders edge-to-edge
 * underneath both COG layers — never clipped by the swipe handle.
 */
function makeBasemapLayer(): TileLayer {
  return new TileLayer({
    id: "basemap",
    data: "https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}.png",
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [
          boundingBox[0][0],
          boundingBox[0][1],
          boundingBox[1][0],
          boundingBox[1][1],
        ],
      });
    },
  });
}

export default function App() {
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [splitFraction, setSplitFraction] = useState(0.5);

  const layers = [makeBasemapLayer()];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <DeckGL
        views={MAP_VIEW}
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => {
          setViewState(vs as unknown as MapViewState);
        }}
        layers={layers}
      />
      <SwipeHandle fraction={splitFraction} onChange={setSplitFraction} />
    </div>
  );
}
