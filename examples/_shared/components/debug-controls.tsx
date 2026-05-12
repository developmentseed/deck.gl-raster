import { Checkbox, NativeSelect, Slider, Stack, Text } from "@chakra-ui/react";
import { Field } from "./field.js";

export interface DebugState {
  /** Whether the tile-debug overlay is rendered. */
  debug: boolean;
  /** Debug overlay opacity, 0–1. */
  debugOpacity: number;
  /**
   * Optional 1–3 label detail level (supported by `MultiCOGLayer`, not plain
   * `COGLayer`). Omit to hide the detail-level selector.
   */
  debugLevel?: 1 | 2 | 3;
}

export interface DebugControlsProps {
  /** Current debug state. */
  value: DebugState;
  /** Called with the next debug state on any change. */
  onChange: (next: DebugState) => void;
  /** Label for the on/off checkbox. Defaults to `"Debug overlay"`. */
  label?: string;
}

const LEVELS: { value: 1 | 2 | 3; label: string }[] = [
  { value: 1, label: "1 — Compact" },
  { value: 2, label: "2 — Detailed" },
  { value: 3, label: "3 — Verbose" },
];

/**
 * Standard controls for a raster layer's tile-debug overlay: a toggle, an
 * opacity slider, and (when `value.debugLevel` is provided) a detail-level
 * selector. Fully controlled.
 */
export function DebugControls({
  value,
  onChange,
  label = "Debug overlay",
}: DebugControlsProps) {
  const { debug, debugOpacity, debugLevel } = value;

  return (
    <Stack gap="3" mt="3" pt="3" borderTopWidth="1px" borderColor="gray.200">
      <Checkbox.Root
        checked={debug}
        onCheckedChange={(details) => {
          onChange({ ...value, debug: details.checked === true });
        }}
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>{label}</Checkbox.Label>
      </Checkbox.Root>

      {debug ? (
        <Stack gap="3">
          {debugLevel !== undefined ? (
            <Field label="Detail level">
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={debugLevel}
                  onChange={(e) => {
                    onChange({
                      ...value,
                      debugLevel: Number(e.target.value) as 1 | 2 | 3,
                    });
                  }}
                >
                  {LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field>
          ) : null}

          <Field
            label={<Text as="span">Opacity: {debugOpacity.toFixed(2)}</Text>}
          >
            <Slider.Root
              size="sm"
              width="full"
              min={0}
              max={1}
              step={0.01}
              value={[debugOpacity]}
              onValueChange={(details) => {
                onChange({ ...value, debugOpacity: details.value[0] });
              }}
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
        </Stack>
      ) : null}
    </Stack>
  );
}
