import {
  Box,
  Button,
  Input,
  NativeSelect,
  Slider,
  Stack,
  Text,
} from "@chakra-ui/react";
import {
  CollecticonCirclePause,
  CollecticonCirclePlay,
} from "@devseed-ui/collecticons-chakra";
import {
  ExternalLink,
  Field,
  ControlPanel as SharedControlPanel,
} from "deck.gl-raster-examples-shared";
import { useState } from "react";
import { COMPOSITE_PRESETS } from "./composites.js";
import type { DisasterEvent } from "./events.js";
import { EVENTS } from "./events.js";
import type { Collection, Scene } from "./stac.js";

export type ControlPanelProps = {
  collection: Collection;
  onCollectionChange: (c: Collection) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  cloudCoverMax: number;
  onCloudCoverMaxChange: (v: number) => void;
  presetId: string;
  onPresetIdChange: (id: string) => void;
  onApplyEvent: (event: DisasterEvent) => void;
  onZoomToLocation: (longitude: number, latitude: number) => void;
  onSearch: () => void;
  loading: boolean;
  error: string | null;
  /** Set when the selected scene's imagery failed to load (CORS, 404, etc.). */
  layerError: string | null;
  scenes: Scene[];
  timeIdx: number;
  onTimeIdxChange: (idx: number) => void;
  isPlaying: boolean;
  onPlayPauseToggle: () => void;
};

// Only sentinel-2-l2a is browser-renderable (public `sentinel-cogs` bucket with
// CORS). c1-l2a's bucket has no CORS headers, so its COGs can't be fetched
// in-browser — see the Collection type in stac.ts.
const COLLECTIONS: { id: Collection; label: string }[] = [
  { id: "sentinel-2-l2a", label: "sentinel-2-l2a (dense archive)" },
];

/** Format an ISO timestamp as a short date, e.g. "2022-08-29". */
function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    collection,
    onCollectionChange,
    startDate,
    onStartDateChange,
    endDate,
    onEndDateChange,
    cloudCoverMax,
    onCloudCoverMaxChange,
    presetId,
    onPresetIdChange,
    onApplyEvent,
    onZoomToLocation,
    onSearch,
    loading,
    error,
    layerError,
    scenes,
    timeIdx,
    onTimeIdxChange,
    isPlaying,
    onPlayPauseToggle,
  } = props;

  // Local-only form state for the quick-start picker and lat/lon inputs.
  const [eventId, setEventId] = useState(EVENTS[0].id);
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const preset =
    COMPOSITE_PRESETS.find((p) => p.id === presetId) ?? COMPOSITE_PRESETS[0];
  const scene = scenes[timeIdx];

  return (
    <SharedControlPanel
      title="Sentinel-2 Disaster Time-Lapse"
      sourcePath="examples/sentinel-2-timelapse"
    >
      <Stack gap="3">
        <Text color="gray.600" fontSize="sm">
          Search{" "}
          <ExternalLink href="https://registry.opendata.aws/sentinel-2-l2a-cogs/">
            Sentinel-2
          </ExternalLink>{" "}
          imagery for an event, then step through acquisitions to see change over
          time. Imagery is read directly from Cloud-Optimized GeoTIFFs — no tile
          server.
        </Text>

        {/* Quick-start presets: fly to the event, pre-fill the form, search. */}
        <Field label="Quick start">
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={eventId}
              onChange={(e) => {
                const event = EVENTS.find((ev) => ev.id === e.target.value);
                if (event) {
                  setEventId(event.id);
                  onApplyEvent(event);
                }
              }}
            >
              {EVENTS.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>

        {/* Zoom-to-location: fly the camera to a typed lat/lon. */}
        <Field label="Zoom to location (lat, lon)">
          <Stack direction="row" gap="2">
            <Input
              size="sm"
              type="number"
              placeholder="lat"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <Input
              size="sm"
              type="number"
              placeholder="lon"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              flexShrink={0}
              onClick={() => {
                const latNum = Number(lat);
                const lonNum = Number(lon);
                if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
                  onZoomToLocation(lonNum, latNum);
                }
              }}
            >
              Go
            </Button>
          </Stack>
        </Field>

        <Field label="Collection">
          <NativeSelect.Root size="sm">
            <NativeSelect.Field
              value={collection}
              onChange={(e) => onCollectionChange(e.target.value as Collection)}
            >
              {COLLECTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field>

        <Stack direction="row" gap="2">
          <Field label="Start date">
            <Input
              size="sm"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </Field>
          <Field label="End date">
            <Input
              size="sm"
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
            />
          </Field>
        </Stack>

        <Field label={`Max cloud cover: ${cloudCoverMax}%`}>
          <Slider.Root
            size="sm"
            min={0}
            max={100}
            step={5}
            value={[cloudCoverMax]}
            onValueChange={(d) => onCloudCoverMaxChange(d.value[0])}
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

        <Button size="sm" colorPalette="blue" loading={loading} onClick={onSearch}>
          Search this view
        </Button>

        {error ? (
          <Text color="red.500" fontSize="sm">
            {error}
          </Text>
        ) : (
          <Text color="gray.600" fontSize="sm">
            {loading
              ? "Searching…"
              : scenes.length > 0
                ? `${scenes.length} scenes found`
                : "No scenes — adjust dates, cloud cover, or pan the map."}
          </Text>
        )}

        {/* Imagery (COG) load failure — distinct from a search/API error. */}
        {layerError && (
          <Text color="red.500" fontSize="sm">
            Imagery failed to load: {layerError}
          </Text>
        )}

        {/* Composite picker + time slider only matter once we have scenes. */}
        {scenes.length > 0 && scene && (
          <>
            <Field label="Composite">
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={presetId}
                  onChange={(e) => onPresetIdChange(e.target.value)}
                >
                  {COMPOSITE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field>
            <Text color="gray.500" fontSize="xs">
              {preset.hint}
            </Text>

            {/* Color key: what the dominant colors mean in this composite. */}
            <Stack gap="1">
              {preset.legend.map((entry) => (
                <Stack key={entry.label} direction="row" align="center" gap="2">
                  <Box
                    width="3"
                    height="3"
                    flexShrink={0}
                    borderRadius="sm"
                    borderWidth="1px"
                    borderColor="blackAlpha.300"
                    backgroundColor={entry.color}
                  />
                  <Text color="gray.600" fontSize="xs">
                    {entry.label}
                  </Text>
                </Stack>
              ))}
            </Stack>

            <Field
              label={`${shortDate(scene.datetime)} — ${Math.round(
                scene.cloudCover,
              )}% cloud (${timeIdx + 1}/${scenes.length})`}
            >
              <Stack direction="row" align="center" gap="2" width="full">
                <Button
                  aria-label={isPlaying ? "Pause" : "Play"}
                  size="sm"
                  variant="ghost"
                  flexShrink={0}
                  p="1"
                  onClick={onPlayPauseToggle}
                >
                  {isPlaying ? (
                    <CollecticonCirclePause />
                  ) : (
                    <CollecticonCirclePlay />
                  )}
                </Button>
                <Slider.Root
                  size="sm"
                  flex="1"
                  minW="0"
                  min={0}
                  max={scenes.length - 1}
                  value={[timeIdx]}
                  aria-label={["Acquisition date"]}
                  onValueChange={(d) => onTimeIdxChange(d.value[0])}
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
          </>
        )}
      </Stack>
    </SharedControlPanel>
  );
}
