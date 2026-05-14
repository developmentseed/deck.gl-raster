import { Checkbox, Code, Slider, Stack, Text } from "@chakra-ui/react";
import {
  ControlPanel,
  ExternalLink,
  Field,
  HelpTooltip,
} from "deck.gl-raster-examples-shared";
import { CategoryFilter } from "./CategoryFilter.js";

interface InfoPanelProps {
  debug: boolean;
  debugOpacity: number;
  meshMaxError: number;
  selected: Set<number>;
  onSelectedChange: (next: Set<number>) => void;
  onDebugChange: (checked: boolean) => void;
  onDebugOpacityChange: (opacity: number) => void;
  onMeshMaxErrorChange: (error: number) => void;
}

const debugOverlayTooltip = `Red squares depict the underlying COG tile structure.

Triangles depict the GPU-based reprojection. Instead of per-pixel reprojection, we generate an adaptive triangular mesh. Each triangle locally approximates the non-linear reprojection function, ensuring minimal distortion.`;

const meshMaxErrorTooltip = `Controls the maximum allowed reprojection error (in source pixels) for the adaptive triangular mesh.

Lower values produce more triangles and higher accuracy at the cost of performance. Higher values use fewer triangles and render faster but with less precise reprojection.`;

export function InfoPanel({
  debug,
  debugOpacity,
  meshMaxError,
  selected,
  onSelectedChange,
  onDebugChange,
  onDebugOpacityChange,
  onMeshMaxErrorChange,
}: InfoPanelProps) {
  return (
    <ControlPanel title="NLCD Land Cover" sourcePath="examples/land-cover">
      <Stack gap="3">
        <Text color="gray.600">
          A <Text as="b">1.3 GB</Text>{" "}
          <ExternalLink href="https://cogeo.org/">
            Cloud-Optimized GeoTIFF
          </ExternalLink>{" "}
          of{" "}
          <ExternalLink href="https://www.usgs.gov/annualnlcd">
            USGS Annual NLCD
          </ExternalLink>{" "}
          data rendered in the browser with no server using{" "}
          <ExternalLink href="https://developmentseed.org/deck.gl-raster/">
            <Code>deck.gl-raster</Code>
          </ExternalLink>
          .
        </Text>

        <CategoryFilter selected={selected} onChange={onSelectedChange} />

        <Stack gap="3" pt="3" borderTopWidth="1px" borderColor="gray.200">
          <Stack direction="row" align="center" gap="1.5">
            <Checkbox.Root
              checked={debug}
              onCheckedChange={(d) => onDebugChange(d.checked === true)}
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>Debug overlay</Checkbox.Label>
            </Checkbox.Root>
            <HelpTooltip label="Debug overlay info">
              {debugOverlayTooltip}
            </HelpTooltip>
          </Stack>

          {debug ? (
            <Field
              label={
                <Text as="span">Debug opacity: {debugOpacity.toFixed(2)}</Text>
              }
            >
              <Slider.Root
                size="sm"
                width="full"
                min={0}
                max={1}
                step={0.01}
                value={[debugOpacity]}
                onValueChange={(d) => onDebugOpacityChange(d.value[0])}
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
          ) : null}

          <Field
            label={
              <Text as="span" display="inline-flex" alignItems="center" gap="1">
                Mesh max error: {meshMaxError.toFixed(3)}
                <HelpTooltip label="Mesh max error info">
                  {meshMaxErrorTooltip}
                </HelpTooltip>
              </Text>
            }
          >
            <Slider.Root
              size="sm"
              width="full"
              min={0.01}
              max={5}
              step={0.01}
              value={[meshMaxError]}
              onValueChange={(d) => onMeshMaxErrorChange(d.value[0])}
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
      </Stack>
    </ControlPanel>
  );
}
