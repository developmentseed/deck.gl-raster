import { Stack, Switch, Text } from "@chakra-ui/react";
import type { ReadStats } from "../pmtiles/read-stats.js";

/** Props for {@link StatsReadout}. */
export interface StatsReadoutProps {
  /** Reads since the current archive was opened. */
  stats: ReadStats;
  /** Tiles the layer has drawn. */
  tilesDrawn: number;
  /** Tiles fetched and decoded, including neighbors fetched only for halos. */
  tilesDecoded: number;
  /** Whether reads go through the range reader, merged. */
  merge: boolean;
  /** Called when the switch flips. */
  onMergeChange: (merge: boolean) => void;
}

/**
 * The "fast" story in numbers: how many tiles have arrived in how many HTTP
 * requests, with a switch to compare against one request per tile.
 */
export function StatsReadout({
  stats,
  tilesDrawn,
  tilesDecoded,
  merge,
  onMergeChange,
}: StatsReadoutProps) {
  return (
    <Stack gap="1">
      <Switch.Root
        size="sm"
        checked={merge}
        onCheckedChange={(details) => onMergeChange(details.checked)}
      >
        <Switch.HiddenInput />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Switch.Label>Merge requests</Switch.Label>
      </Switch.Root>
      <Text fontSize="sm" color="gray.600">
        Tiles: {tilesDrawn} drawn, {tilesDecoded} decoded
        <br />
        HTTP requests: {stats.requests}
        <br />
        Received: {(stats.bytesReceived / 1e6).toFixed(1)} MB
        {merge ? (
          <>
            <br />
            Reads shared or cached: {stats.sharedReads}
          </>
        ) : null}
      </Text>
    </Stack>
  );
}
