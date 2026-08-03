import { createReadStream, promises as fsp } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(
  here,
  "../../fixtures/geotiff-test-data/rasterio_generated/fixtures",
);

/**
 * Dev-only middleware that serves files under `examples/cog-basic` at
 * `/__fixtures/<name>` from the vendored geotiff-test-data submodule.
 *
 * Honors HTTP Range requests with 206 + Content-Range so the COGLayer
 * behaves identically to a production COG bucket — important for any
 * fixture used to validate range-read code paths.
 */
function localFixtures(): Plugin {
  return {
    name: "local-fixtures",
    configureServer(server) {
      server.middlewares.use("/__fixtures/", (req, res, next) => {
        const requested = decodeURIComponent(req.url ?? "").replace(/^\/+/, "");
        const filePath = path.resolve(fixturesDir, requested);
        if (
          filePath !== fixturesDir &&
          !filePath.startsWith(fixturesDir + path.sep)
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        fsp
          .stat(filePath)
          .then((stat) => {
            res.setHeader("Content-Type", "image/tiff");
            res.setHeader("Accept-Ranges", "bytes");
            const range = req.headers.range;
            const m = range ? /^bytes=(\d+)-(\d*)$/.exec(String(range)) : null;
            if (m) {
              const start = Number.parseInt(m[1]!, 10);
              const end = m[2] ? Number.parseInt(m[2], 10) : stat.size - 1;
              res.statusCode = 206;
              res.setHeader(
                "Content-Range",
                `bytes ${start}-${end}/${stat.size}`,
              );
              res.setHeader("Content-Length", String(end - start + 1));
              createReadStream(filePath, { start, end }).pipe(res);
              return;
            }
            res.setHeader("Content-Length", String(stat.size));
            createReadStream(filePath).pipe(res);
          })
          .catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localFixtures()],
  base: "/deck.gl-raster/examples/cog-basic/",
  worker: { format: "es" },
  server: {
    port: 3000,
  },
});
