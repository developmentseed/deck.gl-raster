import Link from "@docusaurus/Link";
import Heading from "@theme/Heading";
import Layout from "@theme/Layout";
import type { ReactNode } from "react";
import { FaGithub } from "react-icons/fa";

import styles from "./styles.module.css";

type Example = {
  title: string;
  description: ReactNode;
  href: string;
  image: string;
  source: string;
};

const cogExamples: Example[] = [
  {
    title: "RGB GeoTIFF",
    description: (
      <>
        Load and display RGB Cloud-Optimized GeoTIFF imagery with the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>
        .
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-basic/",
    image: "/deck.gl-raster/img/hero-page-nyc-sentinel.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/cog-basic",
  },
  {
    title: "Land Cover",
    description: (
      <>
        Visualize a 1.3 GB USGS annual land cover dataset using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>{" "}
        with a categorical colormap.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/land-cover/",
    image: "/deck.gl-raster/img/land-cover-categories-hero.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/land-cover",
  },
  {
    title: "NAIP Mosaic",
    description: (
      <>
        Stream a client-side mosaic of NAIP aerial imagery COGs using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/MosaicLayer/">
          MosaicLayer
        </Link>
        , sourced from Microsoft Planetary Computer.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/naip-mosaic/",
    image: "/deck.gl-raster/img/naip-mosaic-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/naip-mosaic",
  },
  {
    title: "Globe View",
    description: (
      <>
        Render Cloud-Optimized GeoTIFFs on a 3D globe using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/COGLayer/">
          COGLayer
        </Link>{" "}
        with MapLibre's globe projection.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/cog-globe/",
    image: "/deck.gl-raster/img/cog-globe.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/cog-globe",
  },
  {
    title: "Sentinel-2 Multi-Band",
    description: (
      <>
        Render split-band, mixed-resolution COGs using{" "}
        <Link to="/deck.gl-raster/api/deck-gl-geotiff/classes/MultiCOGLayer/">
          MultiCOGLayer
        </Link>
        . The GPU handles cross-resolution resampling.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/sentinel-2/",
    image: "/deck.gl-raster/img/sentinel-2-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/sentinel-2",
  },
  {
    title: "Before/After Comparison",
    description: <>Use a slider to compare Vermont state imagery over time.</>,
    href: "https://developmentseed.org/deck.gl-raster/examples/vermont-cog-comparison/",
    image: "/deck.gl-raster/img/vermont-swipe-example.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/vermont-cog-comparison",
  },
];

const zarrExamples: Example[] = [
  {
    title: "ECMWF Temperature Forecast",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to animate over 4-dimensional numerical data.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/dynamical-zarr-ecmwf/",
    image: "/deck.gl-raster/img/dynamical-zarr-ecmwf.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/dynamical-zarr-ecmwf",
  },
  {
    title: "AEF Mosaic Embeddings",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to visualize embeddings data.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/aef-mosaic/",
    image: "/deck.gl-raster/img/aef-mosaic.gif",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/aef-mosaic",
  },
  {
    title: "NLDAS Icechunk",
    description: (
      <>
        Use the{" "}
        <Link to="/deck.gl-raster/api/deck-gl-zarr/classes/ZarrLayer/">
          ZarrLayer
        </Link>{" "}
        to read from an <Link to="https://icechunk.io/">Icechunk</Link>{" "}
        repository.
        <br />
        The store is{" "}
        <Link to="https://icechunk.io/en/stable/guides/virtual/">
          <em>virtualized</em>
        </Link>
        , so tile requests read directly from source NetCDF files.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/nldas-icechunk/",
    image: "/deck.gl-raster/img/nldas-3-icechunk.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/nldas-icechunk",
  },
];

/**
 * Examples published to show what deck.gl-raster makes possible, before their
 * architecture has been reviewed and endorsed.
 *
 * Their sources live under `examples/experimental/`, but their `href` omits
 * that segment — the published URL must not change when an example graduates,
 * so promotion is a pure `git mv`.
 */
const experimentalExamples: Example[] = [
  {
    title: "Custom Projections",
    description: (
      <>
        Render COGs in polar stereographic, Equal Earth, and other map
        projections. A preview of deck.gl v10's custom projection support.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/custom-projection/",
    image: "/deck.gl-raster/img/custom-projection-antarctica-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/custom-projection",
  },
  {
    title: "GeoArrow Overlay",
    description: (
      <>
        3.4 million GeoArrow points, streamed from Parquet with parquet-wasm,
        over a global imagery COG.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/geoarrow-overlay/",
    image: "/deck.gl-raster/img/geoarrow-overlay-example-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/experimental/geoarrow-overlay",
  },
];

/**
 * Animated explanations of how deck.gl-raster works internally. Their code is
 * unreviewed and not meant as a pattern to copy.
 *
 * Their sources live under `examples/explainers/`, but their `href` omits that
 * segment, like the experimental examples.
 */
const explainerExamples: Example[] = [
  {
    title: "Reprojection Explainer",
    description: (
      <>
        A step-by-step animation of how deck.gl-raster reprojects a raster on
        the GPU: cutting it into triangles, refining them where the distortion
        is largest, and stretching the image inside each one.
      </>
    ),
    href: "https://developmentseed.org/deck.gl-raster/examples/reprojection-explainer/",
    image: "/deck.gl-raster/img/reprojection-explainer-examples-card.jpg",
    source:
      "https://github.com/developmentseed/deck.gl-raster/tree/main/examples/explainers/reprojection-explainer",
  },
];

function ExampleCard({
  title,
  description,
  href,
  image,
  source,
}: Example): ReactNode {
  return (
    <div className={styles.card}>
      <Link href={href} target="_blank" rel="noopener noreferrer">
        <img src={image} alt={title} className={styles.cardImage} />
      </Link>
      <div className={styles.cardBody}>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
      <div className={styles.cardFooter}>
        <Link
          className="button button--primary button--sm"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Example ↗
        </Link>
        <Link
          className="button button--secondary button--sm"
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35em",
          }}
        >
          Source
          <FaGithub />
        </Link>
      </div>
    </div>
  );
}

export default function Examples(): ReactNode {
  return (
    <Layout
      title="Examples"
      description="Interactive examples for deck.gl-raster"
    >
      <main className={styles.main}>
        <div className="container">
          <Heading as="h1">Examples</Heading>
          <p className={styles.intro}>
            Interactive demos built with deck.gl-raster. Each example opens as a
            standalone application.
          </p>
          <Heading as="h2">COG Examples</Heading>
          <div className={styles.grid}>
            {cogExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Zarr Examples</Heading>
          <div className={styles.grid}>
            {zarrExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Experimental Examples</Heading>
          <p className={styles.intro}>
            These demonstrate what deck.gl-raster makes possible, but their
            architecture has not been reviewed and endorsed. Treat them as
            demonstrations rather than patterns to copy.
          </p>
          <div className={styles.grid}>
            {experimentalExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
          <Heading as="h2">Explainers</Heading>
          <p className={styles.intro}>
            Animated explanations of how deck.gl-raster works under the hood.
          </p>
          <div className={styles.grid}>
            {explainerExamples.map((ex) => (
              <ExampleCard key={ex.title} {...ex} />
            ))}
          </div>
        </div>
      </main>
    </Layout>
  );
}
