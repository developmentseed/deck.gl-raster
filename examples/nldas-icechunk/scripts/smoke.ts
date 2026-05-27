/**
 * Spike: prove that NLDAS-3 Tair chunks (virtual references into another S3
 * prefix) can be read from Node via icechunk-js + zarrita, and print the
 * constants needed for src/nldas/metadata.ts.
 *
 * Run: cd examples/nldas-icechunk && pnpm exec tsx scripts/smoke.ts
 */
import {
  HttpStorage,
  IcechunkStore,
  ReadSession,
  Repository,
} from "icechunk-js";
import * as zarr from "zarrita";

const REPO_URL =
  "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/virtual-zarr-store/NLDAS-3-icechunk";
const BRANCH = "main";
// VCC name (from config.yaml) → public HTTPS prefix for the source objects.
const VIRTUAL_CHUNK_CONTAINERS = new Map([
  [
    "s3://nasa-waterinsight/NLDAS3/forcing/daily/",
    "https://nasa-waterinsight.s3.us-west-2.amazonaws.com/NLDAS3/forcing/daily/",
  ],
]);

async function main() {
  const storage = new HttpStorage(REPO_URL);
  const repo = await Repository.open({ storage });

  // Resolve the main-branch snapshot id, then reopen a session WITH the
  // virtual chunk container map (checkoutBranch can't take it).
  const branchSession = await repo.checkoutBranch(BRANCH);
  const snapshotId = branchSession.getSnapshotId();
  console.log(
    "snapshotId:",
    snapshotId,
    "type:",
    snapshotId?.constructor?.name,
  );

  // ObjectId12 should be a Uint8Array; coerce defensively if not.
  const snapshotBytes =
    snapshotId instanceof Uint8Array
      ? snapshotId
      : new Uint8Array(snapshotId as ArrayLike<number>);
  const session = await ReadSession.open(storage, snapshotBytes, {
    virtualChunkContainers: VIRTUAL_CHUNK_CONTAINERS,
  });

  // Discover node paths (find the Tair array's exact path + coordinate arrays).
  console.log(
    "nodes:",
    session.listNodes().map((n) => n.path),
  );

  const store = await IcechunkStore.open(session);

  // Adjust the path if listNodes shows Tair nested under a group.
  const tair = await zarr.open(store.resolve("/Tair"), { kind: "array" });
  console.log("Tair shape:", tair.shape, "dtype:", tair.dtype);
  console.log("Tair attrs:", tair.attrs);

  // Read coordinate arrays to derive the affine. Names come from listNodes /
  // Tair's dimension metadata; "/time", "/lat", "/lon" are the likely paths.
  const lat = await zarr.open(store.resolve("/lat"), { kind: "array" });
  const lon = await zarr.open(store.resolve("/lon"), { kind: "array" });
  const latVals = (await zarr.get(lat)).data as Float32Array | Float64Array;
  const lonVals = (await zarr.get(lon)).data as Float32Array | Float64Array;
  const dLat = Number(latVals[1]) - Number(latVals[0]);
  const dLon = Number(lonVals[1]) - Number(lonVals[0]);
  console.log(
    "lat[0..1]:",
    latVals[0],
    latVals[1],
    "dLat:",
    dLat,
    "n:",
    latVals.length,
  );
  console.log(
    "lon[0..1]:",
    lonVals[0],
    lonVals[1],
    "dLon:",
    dLon,
    "n:",
    lonVals.length,
  );

  // Pull one Tair chunk through the virtual container (the real test).
  const probe = await zarr.get(tair, [0, zarr.slice(0, 8), zarr.slice(0, 8)]);
  console.log(
    "probe shape:",
    probe.shape,
    "first values:",
    Array.from(probe.data as Float32Array).slice(0, 8),
  );

  // Print a ready-to-paste NLDAS_GEOZARR_ATTRS (origin = cell-center − half pixel).
  const height = latVals.length;
  const width = lonVals.length;
  console.log("\n--- paste into metadata.ts ---");
  console.log(`"spatial:dimensions": [<yDim>, <xDim>],`);
  console.log(
    `"spatial:transform": [${dLon}, 0, ${Number(lonVals[0]) - dLon / 2}, 0, ${dLat}, ${Number(latVals[0]) - dLat / 2}],`,
  );
  console.log(`"spatial:shape": [${height}, ${width}],`);
  console.log(`"proj:code": "EPSG:4326",`);
  console.log(
    `// units: ${tair.attrs.units}  fill: ${tair.attrs._FillValue ?? tair.attrs.missing_value}`,
  );
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
