import { NativeSelect, Slider, Stack, Text } from "@chakra-ui/react";
import {
  ExternalLink,
  Field,
  HelpTooltip,
  RangeSlider,
  ControlPanel as SharedControlPanel,
} from "deck.gl-raster-examples-shared";
import { NUM_BANDS, NUM_YEARS, YEAR_ORIGIN } from "../aef/constants.js";
import type { Location } from "../aef/locations.js";
import { LOCATIONS } from "../aef/locations.js";

const RESCALE_MIN_BOUND = -1;
const RESCALE_MAX_BOUND = 1;
const RESCALE_STEP = 0.01;

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  locationId: string;
  yearIdx: number;
  bandLabels: readonly string[] | null;
  rBandIdx: number;
  gBandIdx: number;
  bBandIdx: number;
  rescaleMin: number;
  rescaleMax: number;
  onLocationChange: (location: Location) => void;
  onYearIdxChange: (idx: number) => void;
  onRBandIdxChange: (idx: number) => void;
  onGBandIdxChange: (idx: number) => void;
  onBBandIdxChange: (idx: number) => void;
  onRescaleMinChange: (v: number) => void;
  onRescaleMaxChange: (v: number) => void;
};

/**
 * Overlay control panel: location picker, year picker, three band dropdowns
 * (R/G/B), and a shared rescale-range slider.
 */
export function ControlPanel({
  locationId,
  yearIdx,
  bandLabels,
  rBandIdx,
  gBandIdx,
  bBandIdx,
  rescaleMin,
  rescaleMax,
  onLocationChange,
  onYearIdxChange,
  onRBandIdxChange,
  onGBandIdxChange,
  onBBandIdxChange,
  onRescaleMinChange,
  onRescaleMaxChange,
}: ControlPanelProps) {
  const handleLocationSelect = (id: string) => {
    const next = LOCATIONS.find((l) => l.id === id);
    if (next) {
      onLocationChange(next);
    }
  };

  return (
    <SharedControlPanel
      title="AlphaEarth Foundations Mosaic"
      sourcePath="examples/aef-mosaic"
    >
      <Stack gap="3">
        <Field label="Location">
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={locationId}
              onChange={(e) => handleLocationSelect(e.target.value)}
            >
              {LOCATIONS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>

        <Field label="Year">
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={yearIdx}
              onChange={(e) => onYearIdxChange(Number(e.target.value))}
            >
              {Array.from({ length: NUM_YEARS }, (_, i) => {
                const year = YEAR_ORIGIN + i;
                return (
                  <option key={year} value={i}>
                    {year}
                  </option>
                );
              })}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>

        <BandSlider
          label="Red band"
          value={rBandIdx}
          labels={bandLabels}
          onChange={onRBandIdxChange}
        />
        <BandSlider
          label="Green band"
          value={gBandIdx}
          labels={bandLabels}
          onChange={onGBandIdxChange}
        />
        <BandSlider
          label="Blue band"
          value={bBandIdx}
          labels={bandLabels}
          onChange={onBBandIdxChange}
        />

        <Field
          label={
            <Text as="span" display="inline-flex" alignItems="center" gap="1">
              Rescale range: {rescaleMin.toFixed(2)} – {rescaleMax.toFixed(2)}
              <HelpTooltip label="Rescale range info">
                Maps dequantized band values (roughly −1…1 after (v/127.5)² ·
                sign(v)) onto the 0…1 display range before RGB assembly. Values
                below the lower bound clamp to 0; above the upper bound clamp to
                1. Narrower = higher contrast; wider = more headroom at the
                extremes. The same range is applied to all three channels.
              </HelpTooltip>
            </Text>
          }
        >
          <RangeSlider
            min={RESCALE_MIN_BOUND}
            max={RESCALE_MAX_BOUND}
            step={RESCALE_STEP}
            value={[rescaleMin, rescaleMax]}
            onChange={([nextMin, nextMax]) => {
              if (nextMin !== rescaleMin) {
                onRescaleMinChange(nextMin);
              }
              if (nextMax !== rescaleMax) {
                onRescaleMaxChange(nextMax);
              }
            }}
            thumbLabels={["Rescale min", "Rescale max"]}
          />
        </Field>

        <Text
          fontSize="xs"
          color="gray.500"
          pt="2"
          borderTopWidth="1px"
          borderColor="gray.200"
        >
          <ExternalLink href="https://source.coop/tge-labs/aef-mosaic">
            AlphaEarth Foundations GeoZarr Mosaic
          </ExternalLink>{" "}
          — annual 10 m embeddings, 2017–2025.
        </Text>
      </Stack>
    </SharedControlPanel>
  );
}

type BandSliderProps = {
  label: string;
  value: number;
  labels: readonly string[] | null;
  onChange: (idx: number) => void;
};

function BandSlider({ label, value, labels, onChange }: BandSliderProps) {
  const bandLabel = labels?.[value] ?? `Band ${value}`;
  return (
    <Field
      label={
        <Text as="span">
          {label}: {bandLabel}
        </Text>
      }
    >
      <Slider.Root
        size="sm"
        width="full"
        min={0}
        max={NUM_BANDS - 1}
        step={1}
        value={[value]}
        aria-label={[label]}
        onValueChange={(details) => onChange(details.value[0])}
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
  );
}
