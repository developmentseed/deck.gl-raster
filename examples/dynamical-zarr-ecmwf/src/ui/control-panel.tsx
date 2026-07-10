import {
  IconButton,
  Input,
  NativeSelect,
  Slider,
  Stack,
  Text,
} from "@chakra-ui/react";
import { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import colormapsPngUrl from "@developmentseed/deck.gl-raster/gpu-modules/colormaps.png";
import {
  CollecticonCirclePause,
  CollecticonCirclePlay,
} from "@devseed-ui/collecticons-chakra";
import {
  ColormapPreview,
  ExternalLink,
  Field,
  HelpTooltip,
  RangeSlider,
  ControlPanel as SharedControlPanel,
} from "deck.gl-raster-examples-shared";
import type { ColormapId } from "../ecmwf/colormap-choices.js";
import { COLORMAP_CHOICES } from "../ecmwf/colormap-choices.js";
import {
  dateFromInitTimeIdx,
  ECMWF_INIT_TIME_ORIGIN,
  ECMWF_LEAD_TIME_COUNT,
  ECMWF_LEAD_TIME_HOURS,
  initTimeIdxFromDate,
  isoDateString,
} from "../ecmwf/metadata.js";

/** Total number of rows in the shipped colormap sprite. */
const COLORMAP_ROW_COUNT = Object.keys(COLORMAP_INDEX).length;

/** Bounds for the rescale / filter min-max sliders (°C). */
const TEMP_SLIDER_MIN = -80;
const TEMP_SLIDER_MAX = 60;
const TEMP_SLIDER_STEP = 1;

/** Bounds for the frame-duration slider (ms). */
const FRAME_MS_MIN = 50;
const FRAME_MS_MAX = 300;
const FRAME_MS_STEP = 10;

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  leadTimeIdx: number;
  initTimeIdx: number;
  /** Number of init_time values in the dataset; `0` while the zarr array is still opening. */
  initTimeCount: number;
  isPlaying: boolean;
  colormapId: ColormapId;
  rescaleMin: number;
  rescaleMax: number;
  filterMin: number;
  filterMax: number;
  frameDurationMs: number;
  onLeadTimeIdxChange: (idx: number) => void;
  onInitTimeIdxChange: (idx: number) => void;
  onPlayPauseToggle: () => void;
  onColormapIdChange: (id: ColormapId) => void;
  onRescaleMinChange: (v: number) => void;
  onRescaleMaxChange: (v: number) => void;
  onFilterMinChange: (v: number) => void;
  onFilterMaxChange: (v: number) => void;
  onFrameDurationMsChange: (v: number) => void;
};

/**
 * Overlay panel: forecast-date picker, play/pause + lead-time slider, colormap
 * picker with preview, temperature-range (rescale) and filter-range sliders,
 * and a frame-duration slider.
 */
export function ControlPanel({
  leadTimeIdx,
  initTimeIdx,
  initTimeCount,
  isPlaying,
  colormapId,
  rescaleMin,
  rescaleMax,
  filterMin,
  filterMax,
  frameDurationMs,
  onLeadTimeIdxChange,
  onInitTimeIdxChange,
  onPlayPauseToggle,
  onColormapIdChange,
  onRescaleMinChange,
  onRescaleMaxChange,
  onFilterMinChange,
  onFilterMaxChange,
  onFrameDurationMsChange,
}: ControlPanelProps) {
  const hours = ECMWF_LEAD_TIME_HOURS[leadTimeIdx] ?? 0;
  const selectedChoice =
    COLORMAP_CHOICES.find((c) => c.id === colormapId) ?? COLORMAP_CHOICES[0];

  return (
    <SharedControlPanel
      title="ECMWF IFS ENS — 2 m Temperature"
      sourcePath="examples/dynamical-zarr-ecmwf"
    >
      <Stack gap="3">
        <Field label="Forecast date">
          <Input
            type="date"
            size="sm"
            min={isoDateString(ECMWF_INIT_TIME_ORIGIN)}
            max={
              initTimeCount > 0
                ? isoDateString(dateFromInitTimeIdx(initTimeCount - 1))
                : undefined
            }
            value={isoDateString(dateFromInitTimeIdx(initTimeIdx))}
            disabled={initTimeCount === 0}
            onChange={(e) =>
              onInitTimeIdxChange(
                initTimeIdxFromDate(
                  new Date(`${e.target.value}T00:00:00Z`),
                  Math.max(0, initTimeCount - 1),
                ),
              )
            }
          />
        </Field>

        <Field
          label={
            <Text as="span" display="inline-flex" alignItems="center" gap="1">
              <Text as="span">
                Lead time: +
                <Text
                  as="span"
                  display="inline-block"
                  minW="3ch"
                  textAlign="right"
                >
                  {hours}
                </Text>{" "}
                h
              </Text>
              <HelpTooltip label="Lead time resolution info">
                Forecast steps are 3-hourly from +0 h to +144 h (48 steps), then
                6-hourly from +150 h to +360 h (37 steps). 6 h steps dwell twice
                as long during animation so the simulated-time pacing stays
                constant.
              </HelpTooltip>
            </Text>
          }
        >
          <Stack direction="row" align="center" gap="2" width="full">
            <IconButton
              aria-label={isPlaying ? "Pause" : "Play"}
              size="sm"
              variant="ghost"
              flexShrink={0}
              onClick={onPlayPauseToggle}
            >
              {isPlaying ? (
                <CollecticonCirclePause />
              ) : (
                <CollecticonCirclePlay />
              )}
            </IconButton>
            <Slider.Root
              size="sm"
              flex="1"
              minW="0"
              min={0}
              max={ECMWF_LEAD_TIME_COUNT - 1}
              value={[leadTimeIdx]}
              aria-label={["Lead time step"]}
              onValueChange={(details) => onLeadTimeIdxChange(details.value[0])}
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
          </Stack>
        </Field>

        <Field label="Colormap">
          <NativeSelect.Root size="sm" mb="2">
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
          rowIndex={selectedChoice.colormapIndex}
          reversed={selectedChoice.reversed}
          label={selectedChoice.label}
        />

        <Field
          label={
            <Text as="span">
              Rescale range: {rescaleMin}°C – {rescaleMax}°C
            </Text>
          }
        >
          <RangeSlider
            min={TEMP_SLIDER_MIN}
            max={TEMP_SLIDER_MAX}
            step={TEMP_SLIDER_STEP}
            value={[rescaleMin, rescaleMax]}
            onChange={([nextMin, nextMax]) => {
              if (nextMin !== rescaleMin) {
                onRescaleMinChange(nextMin);
              }
              if (nextMax !== rescaleMax) {
                onRescaleMaxChange(nextMax);
              }
            }}
            thumbLabels={["Rescale min (°C)", "Rescale max (°C)"]}
          />
        </Field>

        <Field
          label={
            <Text as="span">
              Filter range: {filterMin}°C – {filterMax}°C
            </Text>
          }
        >
          <RangeSlider
            min={TEMP_SLIDER_MIN}
            max={TEMP_SLIDER_MAX}
            step={TEMP_SLIDER_STEP}
            value={[filterMin, filterMax]}
            onChange={([nextMin, nextMax]) => {
              if (nextMin !== filterMin) {
                onFilterMinChange(nextMin);
              }
              if (nextMax !== filterMax) {
                onFilterMaxChange(nextMax);
              }
            }}
            thumbLabels={["Filter min (°C)", "Filter max (°C)"]}
          />
        </Field>

        <Field
          label={<Text as="span">3 h step: {frameDurationMs} ms</Text>}
          helperText="6 h steps (after +144 h) dwell twice as long."
        >
          <Slider.Root
            size="sm"
            width="full"
            min={FRAME_MS_MIN}
            max={FRAME_MS_MAX}
            step={FRAME_MS_STEP}
            value={[frameDurationMs]}
            aria-label={["Frame duration (ms)"]}
            onValueChange={(details) =>
              onFrameDurationMsChange(details.value[0])
            }
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

        <Text
          fontSize="xs"
          color="gray.500"
          pt="2"
          borderTopWidth="1px"
          borderColor="gray.200"
        >
          <ExternalLink href="https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/">
            ECMWF IFS ENS Forecast data
          </ExternalLink>{" "}
          processed by dynamical.org from ECMWF Open Data.
        </Text>
      </Stack>
    </SharedControlPanel>
  );
}
