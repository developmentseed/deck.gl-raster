import {
  Button,
  chakra,
  HStack,
  NativeSelect,
  SegmentGroup,
  Slider,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { COLORMAP_INDEX } from "@developmentseed/deck.gl-raster/gpu-modules";
import {
  ExternalLink,
  Field,
  HelpTooltip,
  RangeSlider,
  ControlPanel as SharedControlPanel,
} from "deck.gl-raster-examples-shared";
import type { ReactNode } from "react";
import { NUM_BANDS, NUM_YEARS, YEAR_ORIGIN } from "../aef/constants.js";
import type { Location } from "../aef/locations.js";
import { LOCATIONS } from "../aef/locations.js";
import type { RgbSettings } from "../aef/render-tile.js";
import type { AnalysisStatus } from "../analysis/tile-analysis.js";
import { MAX_CLUSTERS } from "../gpu/cluster-overlay.js";
import type { InputPath } from "../onnx/model-runner.js";

/** What the map shows. */
export type Mode = "rgb" | "similarity" | "clusters" | "classifier";

/** A clicked pixel and its embedding. */
export type LabeledPoint = {
  /** Clicked longitude. */
  longitude: number;
  /** Clicked latitude. */
  latitude: number;
  /** The pixel's dequantized 64-band vector. */
  vector: Float32Array;
  /** 1 for a positive example, 0 for a negative one. */
  label: 0 | 1;
};

/** The result of fitting k-means. */
export type ClusterFit = {
  /** `k` row-major unit centroids of 64 values. */
  centroids: Float32Array;
  /** Number of clusters. */
  k: number;
  /** Number of pixels the fit used. */
  sampleCount: number;
  /** Time to sample and fit, in milliseconds. */
  ms: number;
};

type ColormapName = keyof typeof COLORMAP_INDEX;

const COLORMAPS: readonly ColormapName[] = [
  "magma",
  "viridis",
  "inferno",
  "plasma",
  "cividis",
  "turbo",
];

const MODES: { value: Mode; label: string }[] = [
  { value: "rgb", label: "RGB" },
  { value: "similarity", label: "Similarity" },
  { value: "clusters", label: "Clusters" },
  { value: "classifier", label: "Classifier" },
];

/** The ways a tile's int8 embeddings can reach the model. */
const INPUT_PATHS: {
  value: InputPath;
  label: string;
  /** What the option costs, shown under the select. */
  description: string;
}[] = [
  {
    value: "int8",
    label: "Raw int8, converted by the model",
    description:
      "Sends the stored bytes, 4 MB per tile, on every run. The model converts them to float, and that one step runs on the CPU. Uses no extra memory.",
  },
  {
    value: "float32",
    label: "float32, converted in JavaScript",
    description:
      "JavaScript converts each tile to float first, then sends 16 MB per tile on every run. The whole model runs on the GPU, but the larger upload makes this the slowest.",
  },
  {
    value: "gpu",
    label: "float32, kept on the GPU",
    description:
      "Converts each tile once and leaves the float copy on the GPU, so a run uploads nothing. The fastest per run, at 16 MB of GPU memory per tile.",
  },
];

/**
 * Props for {@link ControlPanel}.
 */
export type ControlPanelProps = {
  locationId: string;
  yearIdx: number;
  bandLabels: readonly string[] | null;
  rgb: RgbSettings;
  mode: Mode;
  inputPath: InputPath;
  colormapName: ColormapName;
  opacity: number;
  notice: string | null;
  query: LabeledPoint | null;
  similarityRange: [number, number];
  similarityThreshold: number;
  clusterCount: number;
  clusterFit: ClusterFit | null;
  points: readonly LabeledPoint[];
  nextLabel: 0 | 1;
  probabilityThreshold: number;
  status: AnalysisStatus | null;
  onLocationChange: (location: Location) => void;
  onYearIdxChange: (idx: number) => void;
  onRgbChange: (rgb: RgbSettings) => void;
  onModeChange: (mode: Mode) => void;
  onInputPathChange: (inputPath: InputPath) => void;
  onColormapNameChange: (name: ColormapName) => void;
  onOpacityChange: (value: number) => void;
  onSimilarityRangeChange: (range: [number, number]) => void;
  onSimilarityThresholdChange: (value: number) => void;
  onClusterCountChange: (k: number) => void;
  onRefitClusters: () => void;
  onNextLabelChange: (label: 0 | 1) => void;
  onClearPoints: () => void;
  onProbabilityThresholdChange: (value: number) => void;
};

/**
 * Overlay control panel: location and year, the mode and its settings, and
 * the ONNX Runtime input path and timings.
 */
export function ControlPanel(props: ControlPanelProps) {
  const { mode, onModeChange } = props;
  return (
    <SharedControlPanel
      title={
        <>
          ONNX Embeddings{" "}
          <chakra.span
            fontSize="2xs"
            fontWeight="bold"
            letterSpacing="wide"
            textTransform="uppercase"
            color="orange.800"
            bg="orange.100"
            borderWidth="1px"
            borderColor="orange.300"
            borderRadius="sm"
            px="1.5"
            py="0.5"
            verticalAlign="middle"
          >
            Experimental
          </chakra.span>
        </>
      }
      sourcePath="examples/experimental/onnx-embeddings"
    >
      <Stack gap="3">
        <Text color="gray.600">
          Runs small{" "}
          <ExternalLink href="https://onnxruntime.ai/docs/tutorials/web/">
            ONNX Runtime Web
          </ExternalLink>{" "}
          models on WebGPU over every loaded tile of 64-band AlphaEarth
          embeddings.
        </Text>

        <LocationAndYear {...props} />

        <Field
          label={
            <LabelWithHelp label="Mode">
              {"What is drawn over the basemap.\n\n" +
                "• RGB: three of the 64 embedding bands as red, green and blue.\n" +
                "• Similarity: how close each pixel is to one you click.\n" +
                "• Clusters: pixels grouped by how alike they are.\n" +
                "• Classifier: a model trained on the points you click."}
            </LabelWithHelp>
          }
        >
          <SegmentGroup.Root
            size="sm"
            value={mode}
            onValueChange={(details) => {
              if (details.value) {
                onModeChange(details.value as Mode);
              }
            }}
          >
            <SegmentGroup.Indicator />
            <SegmentGroup.Items items={MODES} />
          </SegmentGroup.Root>
        </Field>

        {mode === "similarity" && <SimilarityControls {...props} />}
        {mode === "clusters" && <ClusterControls {...props} />}
        {mode === "classifier" && <ClassifierControls {...props} />}
        {props.notice && (
          <Text fontSize="sm" color="orange.700">
            {props.notice}
          </Text>
        )}

        {mode !== "rgb" && <EngineControls {...props} />}

        {mode === "rgb" && <RgbControls {...props} />}

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

function LocationAndYear({
  locationId,
  yearIdx,
  onLocationChange,
  onYearIdxChange,
}: ControlPanelProps) {
  return (
    <HStack gap="2" align="end">
      <Field label="Location">
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={locationId}
            onChange={(e) => {
              const next = LOCATIONS.find((l) => l.id === e.target.value);
              if (next) {
                onLocationChange(next);
              }
            }}
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
        <NativeSelect.Root size="sm" width="24">
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
    </HStack>
  );
}

function SimilarityControls({
  query,
  similarityRange,
  similarityThreshold,
  onSimilarityRangeChange,
  onSimilarityThresholdChange,
  ...rest
}: ControlPanelProps) {
  return (
    <Stack gap="3">
      <Text fontSize="sm" color="gray.600">
        {query
          ? `Query pixel: ${query.latitude.toFixed(5)}, ${query.longitude.toFixed(5)}. Click another to search again.`
          : "Click a pixel. Every pixel on screen gets its cosine similarity to it."}
      </Text>
      <ValueSlider
        label={`Threshold: ${similarityThreshold.toFixed(2)}`}
        help="Pixels less similar than this are not drawn. Similarity runs from -1 (opposite) to 1 (identical)."
        min={-1}
        max={1}
        step={0.01}
        value={similarityThreshold}
        onChange={onSimilarityThresholdChange}
      />
      <Field
        label={
          <LabelWithHelp
            label={`Color range: ${similarityRange[0].toFixed(2)} – ${similarityRange[1].toFixed(2)}`}
          >
            The similarity values that map to the two ends of the colormap.
            Narrow it to bring out differences among the most similar pixels.
          </LabelWithHelp>
        }
      >
        <RangeSlider
          min={-1}
          max={1}
          step={0.01}
          value={similarityRange}
          onChange={onSimilarityRangeChange}
          thumbLabels={["Range min", "Range max"]}
        />
      </Field>
      <ColormapAndOpacity {...rest} />
    </Stack>
  );
}

function ClusterControls({
  clusterCount,
  clusterFit,
  opacity,
  onClusterCountChange,
  onRefitClusters,
  onOpacityChange,
}: ControlPanelProps) {
  return (
    <Stack gap="3">
      <Text fontSize="sm" color="gray.600">
        k-means in JavaScript on pixels sampled from the loaded tiles; the model
        assigns every pixel to its nearest centroid.
      </Text>
      <ValueSlider
        label={`Clusters: ${clusterCount}`}
        help="How many groups to split the pixels into. The groups are fitted on the tiles loaded now, so press the fit button again after moving the map."
        min={2}
        max={MAX_CLUSTERS}
        step={1}
        value={clusterCount}
        onChange={onClusterCountChange}
      />
      <HStack justify="space-between">
        <Text fontSize="xs" color="gray.500">
          {clusterFit
            ? `Fit on ${clusterFit.sampleCount.toLocaleString()} pixels in ${clusterFit.ms.toFixed(0)} ms`
            : "Waiting for tiles"}
        </Text>
        <Button size="xs" variant="outline" onClick={onRefitClusters}>
          Fit on loaded tiles
        </Button>
      </HStack>
      <ValueSlider
        label={`Opacity: ${opacity.toFixed(2)}`}
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        onChange={onOpacityChange}
      />
    </Stack>
  );
}

function ClassifierControls({
  points,
  nextLabel,
  probabilityThreshold,
  onNextLabelChange,
  onClearPoints,
  onProbabilityThresholdChange,
  ...rest
}: ControlPanelProps) {
  const positives = points.filter((point) => point.label === 1).length;
  const negatives = points.length - positives;
  return (
    <Stack gap="3">
      <Text fontSize="sm" color="gray.600">
        Click examples of what you are looking for, and of what you are not (or
        shift-click). A logistic regression fit in JavaScript runs on every
        pixel.
      </Text>
      <HStack justify="space-between">
        <SegmentGroup.Root
          size="xs"
          value={nextLabel === 1 ? "positive" : "negative"}
          onValueChange={(details) =>
            onNextLabelChange(details.value === "negative" ? 0 : 1)
          }
        >
          <SegmentGroup.Indicator />
          <SegmentGroup.Items
            items={[
              { value: "positive", label: "Positive" },
              { value: "negative", label: "Negative" },
            ]}
          />
        </SegmentGroup.Root>
        <Button
          size="xs"
          variant="outline"
          onClick={onClearPoints}
          disabled={points.length === 0}
        >
          Clear
        </Button>
      </HStack>
      <Text fontSize="xs" color="gray.500">
        {positives} positive, {negatives} negative
        {positives === 0 || negatives === 0
          ? " — needs at least one of each"
          : ""}
      </Text>
      <ValueSlider
        label={`Probability threshold: ${probabilityThreshold.toFixed(2)}`}
        help="Pixels the classifier rates below this are not drawn. 0.5 means more likely a match than not."
        min={0}
        max={1}
        step={0.01}
        value={probabilityThreshold}
        onChange={onProbabilityThresholdChange}
      />
      <ColormapAndOpacity {...rest} />
    </Stack>
  );
}

function ColormapAndOpacity({
  colormapName,
  opacity,
  onColormapNameChange,
  onOpacityChange,
}: Pick<
  ControlPanelProps,
  "colormapName" | "opacity" | "onColormapNameChange" | "onOpacityChange"
>) {
  return (
    <HStack gap="2" align="end">
      <Field label="Colormap">
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={colormapName}
            onChange={(e) =>
              onColormapNameChange(e.target.value as ColormapName)
            }
          >
            {COLORMAPS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field>
      <ValueSlider
        label={`Opacity: ${opacity.toFixed(2)}`}
        min={0}
        max={1}
        step={0.05}
        value={opacity}
        onChange={onOpacityChange}
      />
    </HStack>
  );
}

function EngineControls({
  inputPath,
  status,
  onInputPathChange,
}: ControlPanelProps) {
  const lastPass = status?.lastPass;
  const tileCount = status?.tileCount ?? 0;
  return (
    <Stack
      gap="2"
      pt="2"
      borderTopWidth="1px"
      borderColor="gray.200"
      fontSize="xs"
    >
      <Field
        label={
          <LabelWithHelp label="Model input">
            {"The embeddings are stored as int8 and the models compute in float32. This picks where that conversion happens.\n\n" +
              INPUT_PATHS.map(
                ({ label, description }) => `• ${label}: ${description}`,
              ).join("\n\n")}
          </LabelWithHelp>
        }
        helperText={
          INPUT_PATHS.find(({ value }) => value === inputPath)?.description
        }
      >
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={inputPath}
            onChange={(e) => onInputPathChange(e.target.value as InputPath)}
          >
            {INPUT_PATHS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field>
      <Text color="gray.600" data-testid="engine-status">
        {status?.busy ? "Running… " : ""}
        {lastPass
          ? `Last pass: ${lastPass.model} on ${lastPass.tiles} tiles in ${lastPass.ms.toFixed(0)} ms` +
            (lastPass.tiles > 0
              ? ` (${(lastPass.runMs / lastPass.tiles).toFixed(1)} ms per tile)`
              : "")
          : "No pass yet"}
      </Text>
      <Text color="gray.500">
        {tileCount} tiles loaded: {megabytes(status?.embeddingBytes)} MB of int8
        embeddings on the CPU
        {status?.gpuBytes
          ? `, ${megabytes(status.gpuBytes)} MB of float32 on the GPU`
          : ""}
        {status?.firstSessionMs != null
          ? `; ONNX Runtime ready in ${status.firstSessionMs.toFixed(0)} ms`
          : ""}
      </Text>
      {status?.error && <Text color="red.600">{status.error}</Text>}
    </Stack>
  );
}

function RgbControls({ rgb, bandLabels, onRgbChange }: ControlPanelProps) {
  return (
    <Stack gap="2" pt="2" borderTopWidth="1px" borderColor="gray.200">
      <Text fontSize="sm" fontWeight="semibold">
        RGB composite
      </Text>
      <BandSlider
        label="Red band"
        value={rgb.rBandIdx}
        labels={bandLabels}
        onChange={(rBandIdx) => onRgbChange({ ...rgb, rBandIdx })}
      />
      <BandSlider
        label="Green band"
        value={rgb.gBandIdx}
        labels={bandLabels}
        onChange={(gBandIdx) => onRgbChange({ ...rgb, gBandIdx })}
      />
      <BandSlider
        label="Blue band"
        value={rgb.bBandIdx}
        labels={bandLabels}
        onChange={(bBandIdx) => onRgbChange({ ...rgb, bBandIdx })}
      />
      <Field
        label={`Rescale range: ${rgb.rescaleMin.toFixed(2)} – ${rgb.rescaleMax.toFixed(2)}`}
      >
        <RangeSlider
          min={-1}
          max={1}
          step={0.01}
          value={[rgb.rescaleMin, rgb.rescaleMax]}
          onChange={([rescaleMin, rescaleMax]) =>
            onRgbChange({ ...rgb, rescaleMin, rescaleMax })
          }
          thumbLabels={["Rescale min", "Rescale max"]}
        />
      </Field>
    </Stack>
  );
}

/** A field label with a "?" tooltip beside it. */
function LabelWithHelp({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Text as="span" display="inline-flex" alignItems="center" gap="1">
      {label}
      <HelpTooltip label={`About ${label.split(":")[0]}`}>
        {children}
      </HelpTooltip>
    </Text>
  );
}

function megabytes(bytes: number | undefined): string {
  return ((bytes ?? 0) / 2 ** 20).toFixed(0);
}

type ValueSliderProps = {
  label: string;
  /** Explanation shown in a tooltip beside the label. */
  help?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
};

function ValueSlider({
  label,
  help,
  min,
  max,
  step,
  value,
  onChange,
}: ValueSliderProps) {
  return (
    <Field
      label={help ? <LabelWithHelp label={label}>{help}</LabelWithHelp> : label}
    >
      <Slider.Root
        size="sm"
        width="full"
        min={min}
        max={max}
        step={step}
        value={[value]}
        aria-label={[label]}
        onValueChange={(details) => onChange(details.value[0]!)}
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

type BandSliderProps = {
  label: string;
  value: number;
  labels: readonly string[] | null;
  onChange: (idx: number) => void;
};

function BandSlider({ label, value, labels, onChange }: BandSliderProps) {
  const bandLabel = labels?.[value] ?? `Band ${value}`;
  return (
    <ValueSlider
      label={`${label}: ${bandLabel}`}
      min={0}
      max={NUM_BANDS - 1}
      step={1}
      value={value}
      onChange={onChange}
    />
  );
}
