import { Stack, Switch, Text } from "@chakra-ui/react";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import type { PMTilesSource } from "../pmtiles/pmtiles-source.js";
import type { ReadStats } from "../pmtiles/read-stats.js";
import type { BorderCache } from "../terrain/border-cache.js";

/** How often the readout refreshes, in milliseconds. */
const INTERVAL = 250;

/** No reads yet. */
const NO_STATS: ReadStats = { requests: 0, bytesReceived: 0, sharedReads: 0 };

/** Props for {@link StatsReadout}. */
export interface StatsReadoutProps {
  /** The open archive, whose byte source counts its reads. */
  source: PMTilesSource | null;
  /** The archive's border cache, which counts tiles fetched and decoded. */
  cache: BorderCache | null;
  /** Tiles the layer has drawn since the archive opened. */
  tilesDrawn: RefObject<number>;
  /** Whether reads go through the range reader, merged. */
  merge: boolean;
  /** Called when the switch flips. */
  onMergeChange: (merge: boolean) => void;
}

/**
 * The "fast" story in numbers: how many tiles have arrived in how many HTTP
 * requests, with a switch to compare against one request per tile.
 *
 * It polls the counts itself, so its refreshes re-render only the readout,
 * not the app and its layer.
 */
export function StatsReadout({
  source,
  cache,
  tilesDrawn,
  merge,
  onMergeChange,
}: StatsReadoutProps) {
  const [readout, setReadout] = useState({
    stats: NO_STATS,
    tilesDrawn: 0,
    tilesDecoded: 0,
  });
  useEffect(() => {
    if (!source || !cache) {
      setReadout({ stats: NO_STATS, tilesDrawn: 0, tilesDecoded: 0 });
      return;
    }
    const timer = setInterval(() => {
      const next = {
        stats: source.byteSource.readStats(),
        tilesDrawn: tilesDrawn.current,
        tilesDecoded: cache.stats.loads,
      };
      setReadout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [source, cache, tilesDrawn]);

  const { stats } = readout;
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
        Tiles: {readout.tilesDrawn} drawn, {readout.tilesDecoded} decoded
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
