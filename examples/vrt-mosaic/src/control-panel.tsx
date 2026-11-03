import { Checkbox, NativeSelect, Slider, Text } from "@chakra-ui/react";
import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import {
  ColormapPreview,
  ExternalLink,
  Field,
  RangeSlider,
  ControlPanel as SharedControlPanel,
} from "deck.gl-raster-examples-shared";
import type { ColormapChoice, ColormapId } from "./colormap-choices.js";
import { COLORMAP_CHOICES } from "./colormap-choices.js";

/** Total number of rows in the shipped colormap sprite. */
const COLORMAP_ROW_COUNT = Object.keys(COLORMAP_INDEX).length;

/** Lowest and highest elevation the range slider offers, in meters. */
const ELEVATION_LIMITS: [number, number] = [-100, 4500];

/** How long loading the VRT took, and what it held. */
export type VrtLoadStats = {
  /** Number of files in the VRT. */
  fileCount: number;
  /** Size of the VRT's XML, in bytes. */
  byteLength: number;
  /** Time to fetch the VRT, in milliseconds. */
  fetchMs: number;
  /** Time to parse the VRT, in milliseconds. */
  parseMs: number;
};

export interface ControlPanelProps {
  /** The VRT's load stats, once it has loaded. */
  stats: VrtLoadStats | null;
  /** The VRT's load error message, if any. */
  error: string | null;
  /** Whether to draw each file's footprint. */
  showFootprints: boolean;
  /** Called with the next `showFootprints`. */
  onShowFootprintsChange: (show: boolean) => void;
  /** Active colormap id. */
  colormapId: ColormapId;
  /** Called with the next colormap id. */
  onColormapIdChange: (id: ColormapId) => void;
  /** The resolved colormap choice for the active id. */
  colormapChoice: ColormapChoice;
  /** `[min, max]` elevation mapped to the colormap's ends, in meters. */
  elevationRange: [number, number];
  /** Called with the next elevation range. */
  onElevationRangeChange: (range: [number, number]) => void;
  /** The mosaic's opacity, from 0 to 1. */
  opacity: number;
  /** Called with the next opacity. */
  onOpacityChange: (opacity: number) => void;
}

/**
 * VRT mosaic control panel: what the VRT held and how long it took to load,
 * plus footprint, colormap, elevation-range and opacity controls.
 */
export function ControlPanel({
  stats,
  error,
  showFootprints,
  onShowFootprintsChange,
  colormapId,
  onColormapIdChange,
  colormapChoice,
  elevationRange,
  onElevationRangeChange,
  opacity,
  onOpacityChange,
}: ControlPanelProps) {
  return (
    <SharedControlPanel title="VRT Mosaic" sourcePath="examples/vrt-mosaic">
      <Text mb="2" color="gray.600">
        Reads the{" "}
        <ExternalLink href="https://www.usgs.gov/3d-elevation-program">
          USGS 3DEP
        </ExternalLink>{" "}
        1 arc-second elevation{" "}
        <ExternalLink href="https://gdal.org/en/stable/drivers/raster/vrt.html">
          GDAL VRT
        </ExternalLink>
        , a mosaic of Cloud-Optimized GeoTIFFs, and draws the ones in view
        client-side with a MosaicLayer.
      </Text>
      <Text mb="3" fontSize="xs" color="gray.600">
        {error
          ? `Error: ${error}`
          : stats
            ? `${stats.fileCount.toLocaleString()} files from a ${(
                stats.byteLength / 1e6
              ).toFixed(1)} MB VRT: fetched in ${Math.round(
                stats.fetchMs,
              )} ms, parsed in ${Math.round(stats.parseMs)} ms.`
            : "Loading the VRT…"}
      </Text>

      <Checkbox.Root
        mb="3"
        checked={showFootprints}
        onCheckedChange={(details) =>
          onShowFootprintsChange(details.checked === true)
        }
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>Show each file's footprint</Checkbox.Label>
      </Checkbox.Root>

      <Field label="Colormap">
        <NativeSelect.Root mb="2">
          <NativeSelect.Field
            value={colormapId}
            onChange={(e) => onColormapIdChange(e.target.value as ColormapId)}
          >
            {COLORMAP_CHOICES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field>
      <ColormapPreview
        spriteUrl={colormapsPngUrl}
        rowCount={COLORMAP_ROW_COUNT}
        rowIndex={colormapChoice.colormapIndex}
        label={colormapChoice.label}
      />

      <Field
        label={
          <Text as="span">
            Elevation: {elevationRange[0]} m to {elevationRange[1]} m
          </Text>
        }
      >
        <RangeSlider
          min={ELEVATION_LIMITS[0]}
          max={ELEVATION_LIMITS[1]}
          step={50}
          value={elevationRange}
          onChange={onElevationRangeChange}
          thumbLabels={["Minimum elevation", "Maximum elevation"]}
        />
      </Field>

      <Field label={<Text as="span">Opacity: {opacity.toFixed(2)}</Text>}>
        <Slider.Root
          size="sm"
          width="full"
          min={0}
          max={1}
          step={0.01}
          value={[opacity]}
          aria-label={["Opacity"]}
          onValueChange={(details) => onOpacityChange(details.value[0]!)}
        >
          <Slider.Control>
            <Slider.Track>
              <Slider.Range />
            </Slider.Track>
            <Slider.Thumb index={0}>
              <Slider.HiddenInput />
            </Slider.Thumb>
          </Slider.Control>
        </Slider.Root>
      </Field>
    </SharedControlPanel>
  );
}
