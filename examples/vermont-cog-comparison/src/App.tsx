import type { MapViewState, View } from "@deck.gl/core";
import { MapView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";
import { DeckGL } from "@deck.gl/react";
import {
  LightTheme,
  _SplitterWidget as SplitterWidget,
} from "@deck.gl/widgets";
import "@deck.gl/widgets/stylesheet.css";
import { useState } from "react";

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"] as const;

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -73.218,
  latitude: 44.476,
  zoom: 13,
  pitch: 0,
  bearing: 0,
};

const VIEW_LAYOUT = {
  orientation: "horizontal" as const,
  views: [
    new MapView({ id: "left", controller: true }),
    new MapView({ id: "right", controller: true }),
  ] as [MapView, MapView],
};

/**
 * Build a CARTO dark raster basemap layer for one side.
 *
 * Returns a TileLayer whose id ends with the side name, so `layerFilter`
 * can route it to the matching MapView.
 */
function makeBasemapLayer(side: Side): TileLayer {
  return new TileLayer({
    id: `basemap-${side}`,
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
  const [views, setViews] = useState<View[]>([]);
  const [viewState, setViewState] = useState<Record<Side, MapViewState>>({
    left: INITIAL_VIEW_STATE,
    right: INITIAL_VIEW_STATE,
  });

  const layers = SIDES.map((side) => makeBasemapLayer(side));

  return (
    <DeckGL
      views={views}
      viewState={viewState}
      onViewStateChange={({ viewState: vs }) => {
        const next = vs as unknown as MapViewState;
        setViewState({ left: next, right: next });
      }}
      layers={layers}
      layerFilter={({ layer, viewport }) => layer.id.endsWith(viewport.id)}
      widgets={[
        new SplitterWidget({
          viewLayout: VIEW_LAYOUT,
          onChange: setViews,
          style: LightTheme,
        }),
      ]}
    />
  );
}
