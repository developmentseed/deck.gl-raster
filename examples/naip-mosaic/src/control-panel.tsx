import { NativeSelect, Text } from "@chakra-ui/react";
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

/** Available NAIP render compositions. */
export type RenderMode = "trueColor" | "falseColor" | "ndvi";

/** Render-mode dropdown options, in display order. */
export const RENDER_MODE_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: "trueColor", label: "True Color" },
  { value: "falseColor", label: "False Color Infrared" },
  { value: "ndvi", label: "NDVI" },
];

export interface ControlPanelProps {
  /** Whether the STAC item list is still loading. */
  loading: boolean;
  /** STAC fetch error message, if any. */
  error: string | null;
  /** Number of STAC items in the mosaic. */
  stacItemCount: number;
  /** Active render mode. */
  renderMode: RenderMode;
  /** Called with the next render mode. */
  onRenderModeChange: (mode: RenderMode) => void;
  /** Active colormap id (NDVI mode only). */
  colormapId: ColormapId;
  /** Called with the next colormap id. */
  onColormapIdChange: (id: ColormapId) => void;
  /** The resolved colormap choice for the active id. */
  colormapChoice: ColormapChoice;
  /** Active NDVI `[min, max]` filter range. */
  ndviRange: [number, number];
  /** Called with the next NDVI `[min, max]` range. */
  onNdviRangeChange: (range: [number, number]) => void;
}

/**
 * NAIP mosaic control panel: render-mode picker plus, in NDVI mode, a colormap
 * picker with preview and an NDVI-range filter slider.
 */
export function ControlPanel({
  loading,
  error,
  stacItemCount,
  renderMode,
  onRenderModeChange,
  colormapId,
  onColormapIdChange,
  colormapChoice,
  ndviRange,
  onNdviRangeChange,
}: ControlPanelProps) {
  return (
    <SharedControlPanel title="NAIP Mosaic" sourcePath="examples/naip-mosaic">
      <Text mb="3" color="gray.600">
        {loading
          ? "Loading STAC items… "
          : error
            ? `Error: ${error} `
            : `Fetched ${stacItemCount} `}
        <ExternalLink href="https://stacspec.org/en">STAC</ExternalLink> Items
        from{" "}
        <ExternalLink href="https://planetarycomputer.microsoft.com">
          Microsoft Planetary Computer
        </ExternalLink>
        's{" "}
        <ExternalLink href="https://planetarycomputer.microsoft.com/dataset/naip">
          NAIP dataset
        </ExternalLink>
        , rendered client-side with no server involved.
      </Text>

      <Field label="Render mode">
        <NativeSelect.Root>
          <NativeSelect.Field
            value={renderMode}
            onChange={(e) => onRenderModeChange(e.target.value as RenderMode)}
          >
            {RENDER_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field>

      {renderMode === "ndvi" ? (
        <>
          <Field label="Colormap">
            <NativeSelect.Root mb="2">
              <NativeSelect.Field
                value={colormapId}
                onChange={(e) =>
                  onColormapIdChange(e.target.value as ColormapId)
                }
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
            reversed={colormapChoice.reversed}
            label={colormapChoice.label}
          />
          <Field
            label={
              <Text as="span">
                NDVI range: {ndviRange[0].toFixed(2)} –{" "}
                {ndviRange[1].toFixed(2)}
              </Text>
            }
            helperText={
              <Text as="span" display="flex" justifyContent="space-between">
                <span>-1</span>
                <span>+1</span>
              </Text>
            }
          >
            <RangeSlider
              min={-1}
              max={1}
              step={0.01}
              value={ndviRange}
              onChange={onNdviRangeChange}
              thumbLabels={["NDVI minimum", "NDVI maximum"]}
            />
          </Field>
        </>
      ) : null}
    </SharedControlPanel>
  );
}
