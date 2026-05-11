import { Slider } from "@chakra-ui/react";

export interface RangeSliderProps {
  /** Lower bound of the track. */
  min: number;
  /** Upper bound of the track. */
  max: number;
  /** Step granularity. Defaults to `1`. */
  step?: number;
  /** Current `[low, high]` value. */
  value: [number, number];
  /** Called with the next `[low, high]` value on any change. */
  onChange: (value: [number, number]) => void;
  /**
   * Accessible labels for the two thumbs. Defaults to
   * `["Minimum", "Maximum"]`.
   */
  thumbLabels?: [string, string];
  /** Minimum number of steps the two thumbs must stay apart. Defaults to `1`. */
  minStepsBetweenThumbs?: number;
}

/**
 * A dual-thumb range slider — a thin wrapper over Chakra v3's multi-thumb
 * `Slider`. Renders only the control; wrap it in a `Field` whose label carries
 * the current-value text (the same convention `DebugControls` uses for its
 * opacity slider).
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  thumbLabels = ["Minimum", "Maximum"],
  minStepsBetweenThumbs = 1,
}: RangeSliderProps) {
  return (
    <Slider.Root
      size="sm"
      width="full"
      min={min}
      max={max}
      step={step}
      value={value}
      minStepsBetweenThumbs={minStepsBetweenThumbs}
      aria-label={[...thumbLabels]}
      onValueChange={(details) => {
        const [low, high] = details.value;
        onChange([low, high]);
      }}
    >
      <Slider.Control>
        <Slider.Track>
          <Slider.Range />
        </Slider.Track>
        <Slider.Thumb index={0}>
          <Slider.HiddenInput />
        </Slider.Thumb>
        <Slider.Thumb index={1}>
          <Slider.HiddenInput />
        </Slider.Thumb>
      </Slider.Control>
    </Slider.Root>
  );
}
