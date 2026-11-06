import { Slider } from "@chakra-ui/react";

/** Props for {@link ValueSlider}. */
export interface ValueSliderProps {
  /** Lower bound of the track. */
  min: number;
  /** Upper bound of the track. */
  max: number;
  /** Step granularity. */
  step: number;
  /** Current value. */
  value: number;
  /** Called with the next value on any change. */
  onChange: (value: number) => void;
  /** Accessible label for the thumb. */
  label: string;
}

/**
 * A single-thumb slider, following the same Chakra `Slider` shape the shared
 * `DebugControls` uses for its opacity control. The shared `RangeSlider` is
 * dual-thumb and is the wrong control for a scalar like a sun angle.
 *
 * Renders only the control; wrap it in a `Field` whose label carries the
 * current value.
 */
export function ValueSlider({
  min,
  max,
  step,
  value,
  onChange,
  label,
}: ValueSliderProps) {
  return (
    <Slider.Root
      size="sm"
      width="full"
      min={min}
      max={max}
      step={step}
      value={[value]}
      aria-label={[label]}
      onValueChange={(details) => {
        onChange(details.value[0]!);
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
  );
}
